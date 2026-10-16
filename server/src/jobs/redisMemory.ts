import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { Queue } from 'bullmq';
import type { Logger } from 'pino';
import { redisConnection } from '../database/redis';
import { logger } from '../config/logger';

const INTERVAL_MS = 60000;
const LOCK_MS = 120000;
const RUN_MS = 15000;
const HOUR_MS = 3600000;
const CLOCK_MARGIN_MS = 5000;
const MAX_BATCHES = 5;
const BATCH_SIZE = 100;
const UNLOCK = "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0";
type CleanupQueue = Pick<Queue, 'name' | 'toKey' | 'clean'>;
type MemoryLogger = Pick<Logger, 'info' | 'warn' | 'error'>;

/** Only terminal maintenance history is eligible; no queue state is changed to obtain access. */
export function createRedisMemoryMonitor(client: Redis, queue: CleanupQueue, log: MemoryLogger, now = Date.now) {
  if (queue.name !== 'parkflow-maintenance') throw new Error('Unexpected cleanup queue');
  const lockKey = queue.toKey('memory-cleanup-lock');
  let running: Promise<void> | undefined;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  async function memory() {
    const text = await client.info('memory');
    const read = (name: string) => Number(text.match(new RegExp(`^${name}:(\\d+)\\r?$`, 'm'))?.[1] ?? NaN);
    const usedMemory = read('used_memory'), maxmemory = read('maxmemory');
    if (!Number.isSafeInteger(usedMemory) || !Number.isSafeInteger(maxmemory)) throw new Error('INVALID_MEMORY_METRICS');
    return { usedMemory, maxmemory, memoryPercent: maxmemory ? usedMemory / maxmemory * 100 : null,
      noeviction: /^maxmemory_policy:noeviction\r?$/m.test(text) };
  }

  async function eligibleBatch() {
    const ageCutoff = now() - HOUR_MS - CLOCK_MARGIN_MS;
    const rows = await client.zrangebyscore(queue.toKey('completed'), '0', ageCutoff,
      'WITHSCORES', 'LIMIT', 0, BATCH_SIZE + 1);
    const entries = Array.from({ length: rows.length / 2 }, (_, index) => ({ id: rows[index * 2], score: Number(rows[index * 2 + 1]) }));
    // Leave a timestamp gap before any uninspected job. Concurrent retention can
    // remove checked jobs, but must not make clean() select an unchecked prefix.
    const cutoff = entries.length > BATCH_SIZE ? entries[BATCH_SIZE].score - 2 * CLOCK_MARGIN_MS : ageCutoff;
    const ids = entries.slice(0, BATCH_SIZE).filter(entry => entry.score <= cutoff).map(entry => entry.id);
    if (!ids.length) return { ids, cutoff };
    const pipeline = client.pipeline();
    for (const id of ids) {
      const key = queue.toKey(id);
      pipeline.hmget(key, 'name', 'parentKey', 'parent', 'deid', 'finishedOn', 'opts');
      pipeline.exists(...['dependencies', 'processed', 'failed', 'unsuccessful', 'lock'].map(suffix => `${key}:${suffix}`));
      for (const state of ['active', 'wait', 'paused']) pipeline.lpos(queue.toKey(state), id);
      for (const state of ['failed', 'delayed', 'prioritized', 'waiting-children']) pipeline.zscore(queue.toKey(state), id);
    }
    const replies = await pipeline.exec();
    if (!replies || replies.some(([error]) => error)) throw new Error('DEPENDENCY_INSPECTION_FAILED');
    for (let index = 0; index < ids.length; index++) {
      const values = replies.slice(index * 9, index * 9 + 9).map(([, value]) => value);
      const [name, parentKey, parent, deid, finishedOn, opts] = values[0] as (string | null)[];
      const options = JSON.parse(opts || '{}');
      if (!['outbox', 'maintenance'].includes(name || '') || parentKey || parent || deid
        || options.parent || options.deduplication || options.debounce
        || !finishedOn || Number(finishedOn) > cutoff || !Number.isFinite(Number(finishedOn))
        || values[1] !== 0 || values.slice(2).some(value => value !== null)) {
        throw new Error('UNSAFE_COMPLETED_JOB');
      }
    }
    return { ids, cutoff };
  }

  async function run() {
    let token: string | undefined;
    let cleaned = 0;
    try {
      let metrics = await memory();
      log.info(metrics, 'Redis memory usage');
      if (metrics.memoryPercent === null || metrics.memoryPercent < 75 || stopped) return;
      if (!metrics.noeviction) throw new Error('UNEXPECTED_MEMORY_POLICY');
      const owner = randomUUID();
      if (await client.set(lockKey, owner, 'PX', LOCK_MS, 'NX') !== 'OK') return;
      token = owner;
      const deadline = now() + RUN_MS;
      for (let batch = 0; batch < MAX_BATCHES && !stopped && now() < deadline; batch++) {
        const { ids, cutoff } = await eligibleBatch();
        if (!ids.length) { log.warn({ ...metrics, cleaned }, 'Redis pressure: no safe old completed maintenance batch'); break; }
        if (stopped || now() >= deadline || await client.get(lockKey) !== token
          || await client.pttl(lockKey) < LOCK_MS / 2) break;
        const removed = await queue.clean(now() - cutoff + CLOCK_MARGIN_MS, ids.length, 'completed');
        cleaned += removed.length;
        if (removed.length > BATCH_SIZE || removed.some(id => !ids.includes(id))) throw new Error('CLEANUP_CANDIDATES_CHANGED');
        metrics = await memory();
        log.info({ ...metrics, batch: batch + 1, batchCleaned: removed.length, cleaned }, 'Redis maintenance history cleaned');
        if (metrics.memoryPercent === null || metrics.memoryPercent < 75 || !removed.length) break;
      }
      if (metrics.memoryPercent !== null && metrics.memoryPercent >= 75) {
        log.warn({ ...metrics, cleaned }, 'Redis memory remains high; pending work and other data left untouched');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const known = ['INVALID_MEMORY_METRICS', 'DEPENDENCY_INSPECTION_FAILED', 'UNSAFE_COMPLETED_JOB', 'UNEXPECTED_MEMORY_POLICY', 'CLEANUP_CANDIDATES_CHANGED'];
      // Redis errors may include connection details; never log the raw error or job payload.
      log.error({ cleaned, reason: known.includes(message) ? message : /OOM/.test(message) ? 'REDIS_OOM' : 'REDIS_COMMAND_FAILED' }, 'Redis memory maintenance failed');
    } finally {
      if (token) {
        try { await client.eval(UNLOCK, 1, lockKey, token); }
        catch { log.error({ cleaned }, 'Redis cleanup lock release failed; lease will expire'); }
      }
    }
  }

  function check(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (!running) running = run().finally(() => { running = undefined; });
    return running;
  }
  return {
    check,
    start() {
      if (timer || running || stopped) return;
      const tick = async () => {
        await check();
        if (!stopped) { timer = setTimeout(() => { timer = undefined; void tick(); }, INTERVAL_MS); timer.unref(); }
      };
      void tick();
    },
    async stop() { stopped = true; if (timer) clearTimeout(timer); await running; },
  };
}

export function startRedisMemoryMonitor() {
  // Isolate bounded monitoring timeouts from workers' required indefinite retries.
  const client = new Redis({ ...redisConnection(), maxRetriesPerRequest: 1, commandTimeout: 5000, connectTimeout: 5000, enableOfflineQueue: false });
  client.on('error', () => {}); // The next monitoring tick reports a sanitized failure.
  const queue = new Queue('parkflow-maintenance', { connection: client, skipMetasUpdate: true });
  queue.on('error', () => {});
  const monitor = createRedisMemoryMonitor(client, queue, logger);
  monitor.start();
  return async () => { await monitor.stop(); await queue.close(); client.disconnect(); };
}
