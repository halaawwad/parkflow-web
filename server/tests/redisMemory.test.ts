import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Queue, Worker } from 'bullmq';
import type Redis from 'ioredis';
import { redis, redisConnection } from '../src/database/redis';
import { createRedisMemoryMonitor } from '../src/jobs/redisMemory';

let client: Redis;
let queue: Queue;
let monitor: ReturnType<typeof createRedisMemoryMonitor>;
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const info = (percent: number, max = 10000000) => `used_memory:${Math.round(max * percent / 100)}\r\nmaxmemory:${max}\r\nmaxmemory_policy:noeviction\r\n`;

beforeEach(async () => {
  vi.restoreAllMocks();
  Object.values(log).forEach(fn => fn.mockClear());
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(process.env.REDIS_URL!).hostname);
  await redis.flushdb(); // Disposable isolated Redis DB 15, never production.
  client = redis.duplicate({ commandTimeout: 5000, maxRetriesPerRequest: 1 });
  queue = new Queue('parkflow-maintenance', { connection: client, skipMetasUpdate: true });
  await queue.waitUntilReady();
  monitor = createRedisMemoryMonitor(client, queue, log);
});
afterEach(async () => { await monitor.stop(); await queue.close(); client.disconnect(); vi.useRealTimers(); });

async function completed(count = 1, age = 7200000) {
  const jobs = await queue.addBulk(Array.from({ length: count }, () => ({ name: 'outbox', data: {}, opts: { removeOnComplete: false } })));
  const worker = new Worker(queue.name, async () => {}, { connection: redisConnection(), concurrency: 20 });
  try {
    await expect.poll(() => queue.getCompletedCount(), { timeout: 10000 }).toBe(count);
  } finally { await worker.close(); }
  const pipeline = client.pipeline();
  jobs.forEach((job, index) => {
    const finishedOn = Date.now() - age + index * 1000;
    pipeline.hset(queue.toKey(job.id!), 'finishedOn', finishedOn);
    pipeline.zadd(queue.toKey('completed'), finishedOn, job.id!);
  });
  await pipeline.exec();
  return jobs;
}

describe('Redis memory maintenance', () => {
  it('only samples memory below 75%, with no cleanup or lock writes', async () => {
    vi.spyOn(client, 'info').mockResolvedValue(info(74.99));
    const clean = vi.spyOn(queue, 'clean');
    const set = vi.spyOn(client, 'set');
    await monitor.check();
    expect(clean).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(expect.objectContaining({ memoryPercent: 74.99 }), 'Redis memory usage');
  });

  it('cleans at exactly 75%, then stops below the threshold', async () => {
    await completed();
    vi.spyOn(client, 'info').mockResolvedValueOnce(info(75)).mockResolvedValue(info(70));
    const clean = vi.spyOn(queue, 'clean');
    await monitor.check();
    expect(clean).toHaveBeenCalledTimes(1);
    expect(clean).toHaveBeenCalledWith(expect.any(Number), 1, 'completed');
    expect(clean.mock.calls[0][0]).toBeGreaterThanOrEqual(3600000);
    expect(await queue.getCompletedCount()).toBe(0);
    expect(await client.exists(queue.toKey('memory-cleanup-lock'))).toBe(0);
    expect(log.info).toHaveBeenCalledWith(expect.objectContaining({ cleaned: 1, memoryPercent: 70 }), 'Redis maintenance history cleaned');
  });

  it('preserves young completed, waiting, delayed, active, failed, OTP, rate and other queue data', async () => {
    const [old, young] = await completed(2);
    const recent = Date.now() - 1000;
    await client.hset(queue.toKey(young.id!), 'finishedOn', recent);
    await client.zadd(queue.toKey('completed'), recent, young.id!);
    const waiting = await queue.add('waiting', {});
    const delayed = await queue.add('delayed', {}, { delay: 3600000 });
    // Sentinel keys model other states; cleanup must not access or delete them.
    await client.lpush(queue.toKey('active'), 'active-sentinel');
    await client.zadd(queue.toKey('failed'), Date.now(), 'failed-sentinel');
    await client.set('otp:sentinel', 'private-test-value', 'EX', 300);
    await client.set('rate:api:sentinel', '7', 'EX', 60);
    await client.hset('bull:parkflow-push:sentinel', 'name', 'deliver');
    vi.spyOn(client, 'info').mockResolvedValueOnce(info(80)).mockResolvedValue(info(70));
    await monitor.check();
    expect(await queue.getJob(old.id!)).toBeUndefined();
    expect(await young.getState()).toBe('completed');
    expect(await waiting.getState()).toBe('waiting');
    expect(await delayed.getState()).toBe('delayed');
    expect(await client.lrange(queue.toKey('active'), 0, -1)).toEqual(['active-sentinel']);
    expect(await client.zcard(queue.toKey('failed'))).toBe(1);
    expect(await client.get('otp:sentinel')).toBe('private-test-value');
    expect(await client.pttl('otp:sentinel')).toBeGreaterThan(0);
    expect(await client.get('rate:api:sentinel')).toBe('7');
    expect(await client.hget('bull:parkflow-push:sentinel', 'name')).toBe('deliver');
  });

  it.each(['parent', 'children', 'lock', 'pending'])('stops before cleanup for %s relationships', async risk => {
    const [job] = await completed();
    if (risk === 'parent') await client.hset(queue.toKey(job.id!), 'parentKey', 'bull:parent:pending');
    if (risk === 'children') await client.sadd(queue.toKey(job.id!) + ':dependencies', 'bull:child:pending');
    if (risk === 'lock') await client.set(queue.toKey(job.id!) + ':lock', 'worker');
    if (risk === 'pending') await client.lpush(queue.toKey('active'), job.id!);
    vi.spyOn(client, 'info').mockResolvedValue(info(90));
    const clean = vi.spyOn(queue, 'clean');
    await monitor.check();
    expect(clean).not.toHaveBeenCalled();
    expect(await queue.getJob(job.id!)).toBeDefined();
    expect(log.error).toHaveBeenCalledWith({ cleaned: 0, reason: 'UNSAFE_COMPLETED_JOB' }, 'Redis memory maintenance failed');
  });

  it('limits each run to five batches of at most 100 and logs remaining pressure', async () => {
    await completed(600);
    vi.spyOn(client, 'info').mockResolvedValue(info(90));
    const clean = vi.spyOn(queue, 'clean');
    await monitor.check();
    expect(clean).toHaveBeenCalledTimes(5);
    for (const [age, limit, state] of clean.mock.calls) {
      expect(age).toBeGreaterThanOrEqual(3600000);
      expect(limit).toBeLessThanOrEqual(100);
      expect(state).toBe('completed');
    }
    expect(await queue.getCompletedCount()).toBeGreaterThanOrEqual(100);
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ memoryPercent: 90 }), 'Redis memory remains high; pending work and other data left untouched');
  });

  it('coalesces overlapping local checks and respects another instance lock', async () => {
    await completed();
    vi.spyOn(client, 'info').mockResolvedValue(info(90));
    await client.set(queue.toKey('memory-cleanup-lock'), 'other-instance', 'PX', 120000);
    const clean = vi.spyOn(queue, 'clean');
    const first = monitor.check();
    expect(monitor.check()).toBe(first);
    await first;
    expect(clean).not.toHaveBeenCalled();
    expect(await client.get(queue.toKey('memory-cleanup-lock'))).toBe('other-instance');
  });

  it('excludes a second monitor while the first cleanup is in flight', async () => {
    await completed();
    vi.spyOn(client, 'info').mockResolvedValue(info(90));
    let release!: (ids: string[]) => void;
    const clean = vi.spyOn(queue, 'clean').mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const other = createRedisMemoryMonitor(client, queue, log);
    const first = monitor.check();
    try {
      await expect.poll(() => clean.mock.calls.length).toBe(1);
      await other.check();
      expect(clean).toHaveBeenCalledTimes(1);
    } finally { release([]); await first; await other.stop(); }
  });

  it('does not expand a checked batch when many old jobs share a boundary timestamp', async () => {
    const jobs = await completed(101);
    const timestamp = Date.now() - 7200000;
    const pipeline = client.pipeline();
    for (const job of jobs) {
      pipeline.hset(queue.toKey(job.id!), 'finishedOn', timestamp);
      pipeline.zadd(queue.toKey('completed'), timestamp, job.id!);
    }
    await pipeline.exec();
    vi.spyOn(client, 'info').mockResolvedValue(info(90));
    const clean = vi.spyOn(queue, 'clean');
    await monitor.check();
    expect(clean).not.toHaveBeenCalled();
    expect(await queue.getCompletedCount()).toBe(101);
  });

  it('refuses cleanup under an unexpected eviction policy', async () => {
    vi.spyOn(client, 'info').mockResolvedValue(info(90).replace('noeviction', 'allkeys-lru'));
    const clean = vi.spyOn(queue, 'clean');
    await monitor.check();
    expect(clean).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith({ cleaned: 0, reason: 'UNEXPECTED_MEMORY_POLICY' }, 'Redis memory maintenance failed');
  });

  it('stops on OOM cleanup errors, releases its lock, and logs no secrets', async () => {
    await completed();
    vi.spyOn(client, 'info').mockResolvedValue(info(101));
    const clean = vi.spyOn(queue, 'clean').mockRejectedValue(new Error('OOM redis://private-password@private-host'));
    await expect(monitor.check()).resolves.toBeUndefined();
    expect(clean).toHaveBeenCalledTimes(1);
    expect(await queue.getCompletedCount()).toBe(1);
    expect(await client.exists(queue.toKey('memory-cleanup-lock'))).toBe(0);
    expect(log.error).toHaveBeenCalledWith({ cleaned: 0, reason: 'REDIS_OOM' }, 'Redis memory maintenance failed');
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('private-password');
  });

  it('fails safely if OOM prevents lock acquisition', async () => {
    vi.spyOn(client, 'info').mockResolvedValue(info(101));
    vi.spyOn(client, 'set').mockRejectedValue(new Error('OOM'));
    const clean = vi.spyOn(queue, 'clean');
    await monitor.check();
    expect(clean).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith({ cleaned: 0, reason: 'REDIS_OOM' }, 'Redis memory maintenance failed');
  });

  it('recovers on a later tick after an INFO/network failure', async () => {
    const sample = vi.spyOn(client, 'info').mockRejectedValueOnce(new Error('private connection failure')).mockResolvedValue(info(50));
    await monitor.check();
    await monitor.check();
    expect(sample).toHaveBeenCalledTimes(2);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith(expect.objectContaining({ memoryPercent: 50 }), 'Redis memory usage');
  });

  it('does not clean if maxmemory is unlimited or metrics are invalid', async () => {
    vi.spyOn(client, 'info').mockResolvedValueOnce(info(0, 0)).mockResolvedValue('used_memory:invalid\r\nmaxmemory:100\r\n');
    const clean = vi.spyOn(queue, 'clean');
    await monitor.check();
    await monitor.check();
    expect(clean).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith({ cleaned: 0, reason: 'INVALID_MEMORY_METRICS' }, 'Redis memory maintenance failed');
  });

  it('uses an unref timer and stops without registering any BullMQ jobs', async () => {
    vi.useFakeTimers();
    vi.spyOn(client, 'info').mockResolvedValue(info(50));
    monitor.start();
    await monitor.check();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(60000);
    expect(client.info).toHaveBeenCalledTimes(2);
    await monitor.stop();
    await vi.advanceTimersByTimeAsync(120000);
    expect(client.info).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
    expect(await queue.getJobCounts('wait', 'delayed', 'completed')).toMatchObject({ wait: 0, delayed: 0, completed: 0 });
  });
});
