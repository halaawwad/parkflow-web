import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Worker } from 'bullmq';
import { redis, redisConnection } from '../src/database/redis';
import { maintenanceQueue, pushQueue } from '../src/jobs/queues';

beforeEach(async () => { await redis.flushdb(); }); // Isolated test Redis only.

afterAll(async () => {
  await maintenanceQueue.close();
  await pushQueue.close();
});

describe('maintenance queue retention', () => {
  it('bounds terminal history while preserving delayed and waiting jobs', async () => {
    const worker = new Worker(maintenanceQueue.name, async job => {
      if (job.name === 'fail') throw new Error('isolated retention test');
    }, { connection: redisConnection(), concurrency: 20 });
    try {
      await maintenanceQueue.add('pending-delayed', {}, { jobId: 'keep-delayed', delay: 3600000 });
      await maintenanceQueue.addBulk(Array.from({ length: 105 }, () => ({ name: 'complete', data: {} })));
      await maintenanceQueue.addBulk(Array.from({ length: 105 }, () => ({ name: 'fail', data: {} })));
      await expect.poll(async () => (await maintenanceQueue.getJobCounts('waiting', 'active')),
        { timeout: 10000 }).toMatchObject({ waiting: 0, active: 0 });
      expect(await maintenanceQueue.getCompletedCount()).toBe(100);
      expect(await maintenanceQueue.getFailedCount()).toBe(100);
      await worker.pause();
      await maintenanceQueue.add('pending-waiting', {}, { jobId: 'keep-waiting' });
      expect(await (await maintenanceQueue.getJob('keep-delayed'))?.getState()).toBe('delayed');
      expect(await (await maintenanceQueue.getJob('keep-waiting'))?.getState()).toBe('waiting');
    } finally {
      await worker.close();
    }
  });

  it('applies retention to both scheduler templates without changing retry settings', async () => {
    const outbox = await maintenanceQueue.upsertJobScheduler('outbox-test', { every: 1000 }, { name: 'outbox' });
    const maintenance = await maintenanceQueue.upsertJobScheduler('maintenance-test', { every: 30000 }, {
      name: 'maintenance', opts: { attempts: 5, backoff: { type: 'exponential', delay: 5000 } },
    });
    for (const job of [outbox, maintenance]) {
      expect(job.opts.removeOnComplete).toEqual({ age: 3600, count: 100 });
      expect(job.opts.removeOnFail).toEqual({ age: 86400, count: 100 });
    }
    expect(maintenance.opts.attempts).toBe(5);
    expect(maintenance.opts.backoff).toEqual({ type: 'exponential', delay: 5000 });
  });

  it('keeps the push producer bounded without changing its retries or deduplication ID', async () => {
    const job = await pushQueue.add('deliver', { notificationId: 'test-notification' }, { jobId: 'outbox-event-test' });
    expect(job.opts.removeOnComplete).toBe(1000);
    expect(job.opts.removeOnFail).toBe(1000);
    expect(job.opts.attempts).toBe(8);
    expect(job.opts.backoff).toEqual({ type: 'exponential', delay: 5000 });
    expect((await pushQueue.add('deliver', { notificationId: 'test-notification' }, { jobId: 'outbox-event-test' })).id).toBe(job.id);
  });

  it('prunes completed jobs older than one hour even when fewer than 100 are retained', async () => {
    const worker = new Worker(maintenanceQueue.name, async () => {}, { connection: redisConnection() });
    try {
      const old = await maintenanceQueue.add('outbox', {});
      await expect.poll(() => old.getState()).toBe('completed');
      await worker.pause();
      const finishedOn = Date.now() - 7200000;
      await redis.hset(maintenanceQueue.toKey(old.id!), 'finishedOn', finishedOn);
      await redis.zadd(maintenanceQueue.toKey('completed'), finishedOn, old.id!);
      const fresh = await maintenanceQueue.add('outbox', {});
      worker.resume();
      await expect.poll(() => fresh.getState()).toBe('completed');
      expect(await maintenanceQueue.getJob(old.id!)).toBeUndefined();
      expect(await maintenanceQueue.getCompletedCount()).toBe(1);
    } finally { await worker.close(); }
  });
});
