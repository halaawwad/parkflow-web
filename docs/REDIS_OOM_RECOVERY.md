# Redis OOM diagnosis and approved recovery

The approved one-time recovery removed 3,500 eligible completed maintenance jobs
in 35 batches of 100. Measured memory fell from 26,419,672 to 23,571,048 bytes;
unauthenticated `/api/v1/auth/me` recovered from 500 to 401. The temporary single-IP
allowlist was removed and the original empty allowlist was verified. Commands
below describe future inspection/recovery and are not authorization to repeat writes.
Run commands
from the backend directory in an authenticated Render Shell, using its existing
`REDIS_URL`. Never paste or print that variable. Production writes and deployment
require separate approval.

## Evidence and scope

- Render logs supplied by the operator report Redis `OOM command not allowed when
  used memory > maxmemory` in BullMQ commands. The current API request's underlying
  `Request failed` exception is still needed for direct correlation.
- `/api/v1` runs the shared Redis rate limiter before route authentication. Its
  Lua counter writes fail under OOM with `noeviction`, producing a generic 500.
  `/health` bypasses Redis and `/ready` only sends `PING` (plus PostgreSQL SELECT).
  Isolated integration tests reproduce ready=200, protected API=500 and an OOM
  exception, and restore 401/429 when Redis writes work.
- Maintenance schedules generate approximately 86,400 outbox plus 2,880 maintenance
  jobs/day. Previously neither completed nor failed history was bounded. Recovery
  inspection found 27,873 completed jobs (27,872 older than one hour), with Redis
  at 100.78% of its 26,214,400-byte limit. Removing completed history freed a net
  2,848,624 bytes and restored the API, confirming this history contributed to OOM.
- Push history already has a 1,000-job bound per terminal state. Rate keys have
  60-second or 600-second expiry; OTP challenges expire after 300 seconds and
  cooldowns after 60 seconds. Auth refresh sessions are in PostgreSQL.

## Read-only production inspection

This prints memory metrics, terminal/pending counts, stream lengths and a limited
rate-key TTL sample. It does not read job payloads, OTP values, tokens or IP keys.
The sample is not a total count of rate keys. Repeat measurements to assess growth.

```bash
node <<'NODE'
const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 10000 });
redis.on('error', () => {});
(async () => {
  try {
    const wanted = /^(used_memory|used_memory_human|used_memory_peak|used_memory_dataset|maxmemory|maxmemory_human|maxmemory_policy|mem_not_counted_for_evict|evicted_keys|expired_keys|total_error_replies):/;
    for (const section of ['memory', 'stats']) {
      console.log((await redis.info(section)).split(/\r?\n/).filter(line => wanted.test(line)).join('\n'));
    }
    for (const name of ['parkflow-maintenance', 'parkflow-push']) {
      const prefix = 'bull:' + name + ':';
      const counts = {};
      for (const state of ['completed', 'failed', 'delayed', 'prioritized', 'waiting-children']) counts[state] = await redis.zcard(prefix + state);
      for (const state of ['wait', 'active', 'paused']) counts[state] = await redis.llen(prefix + state);
      counts.events = await redis.xlen(prefix + 'events');
      const ids = await redis.zrange(prefix + 'completed', 0, 49);
      const sizes = await Promise.all(ids.map(id => redis.memory('USAGE', prefix + id)));
      console.log(name, { ...counts, sampledCompletedHashes: ids.length, sampledHashBytes: sizes.reduce((sum, n) => sum + (Number(n) || 0), 0) });
    }
    let cursor = '0', pages = 0, sampled = 0, persistent = 0, longestTtlMs = -2;
    do {
      const result = await redis.scan(cursor, 'MATCH', 'rate:*', 'COUNT', 100);
      cursor = result[0]; pages++;
      for (const key of result[1].slice(0, 50 - sampled)) {
        const ttl = await redis.pttl(key);
        sampled++; if (ttl === -1) persistent++;
        longestTtlMs = Math.max(longestTtlMs, ttl);
      }
    } while (cursor !== '0' && pages < 100 && sampled < 50);
    console.log('rate-key sample', { sampled, persistent, longestTtlMs });
  } finally { await redis.quit(); }
})().catch(() => { console.error('Inspection failed; inspect Render logs securely.'); process.exitCode = 1; });
NODE
```

If `MEMORY USAGE` is restricted by the provider, use its memory chart and the queue
counts. No persistent rate keys are expected. A large terminal count supports the
history-growth diagnosis; waiting/delayed/active counts represent work to preserve.

## Recovery proposal — requires approval, do not run yet

1. Keep `noeviction`, authentication, OTP limits and global rate limiting enabled.
   Never use FLUSHDB, FLUSHALL, queue obliterate/drain, raw key-pattern deletion,
   or eviction policies. Do not restart/delete the free datastore: it is volatile.
2. Approve only removing **completed maintenance history older than one hour** in
   bounded batches of at most 100. This is a Redis production write. Preserve all
   failed, waiting, active, delayed and retrying jobs, OTP keys and session data.
   Run the following one-batch command only after approval; inspect memory and
   queue counts between batches. Do not run an unbounded loop.

```bash
node <<'NODE'
const Redis = require('ioredis');
const { Queue } = require('bullmq');
const connection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 });
connection.on('error', () => {});
const queue = new Queue('parkflow-maintenance', { connection });
(async () => {
  try { console.log('Completed history removed:', (await queue.clean(3600000, 100, 'completed')).length); }
  finally { await queue.close(); await connection.quit(); }
})().catch(() => { console.error('Cleanup failed: stop and obtain provider memory headroom; do not flush or delete other keys.'); process.exitCode = 1; });
NODE
```

3. Cleanup can itself fail under OOM. If so, stop and obtain extra memory through
   Render support/a provider-confirmed data-preserving capacity change. Do not
   assume a free-to-paid change preserves existing in-memory data.
4. After reducing the backlog of terminal history, obtain deployment approval for
   `server/src/jobs/queues.ts` (API and worker use the same backend release).
   New scheduler jobs retain at most 100 completed jobs/up to one hour and 100
   failed jobs/up to one day. Age pruning is lazy, triggered by terminal jobs;
   it is not a periodic expiry timer. Stage bounded cleanup before the first
   post-deployment completion to avoid a huge single automatic history prune.
5. Verify memory has headroom, workers progress, pending work remains, unauthenticated
   `/api/v1/auth/me`, `/notifications` and `/admin/summary` return 401, and exceeding
   configured quotas returns 429. Test OTP normally. The 75-second client timeout
   and absolute 24-hour session implementation are unchanged by this fix.

## Automatic management (local change; not deployed)

- Both producers are bounded: maintenance retains at most 100 completed jobs/up
  to one hour and 100 failed jobs/up to one day. Push retains its existing 1,000
  completed/1,000 failed history and retry/deduplication settings unchanged.
- `jobs/redisMemory.ts` samples INFO memory on a worker-local unref timer once per
  minute after the preceding run finishes. It creates no recurring BullMQ jobs.
- At 75% or higher, only the maintenance completed history older than one hour
  can be cleaned. Each run performs at most five batches of at most 100, with a
  15-second run budget. Memory is rechecked after every batch; cleanup stops below
  75%. No eligible history or other memory consumers cause a warning, not broader
  deletion. BullMQ's normal count/age retention also prunes on job completion.
- Parent/dependency/deduplication relationships, locks, malformed metadata and
  conflicting pending/failed state cause cleanup to stop. A timestamp gap before
  uninspected candidates prevents a concurrently shortened prefix from expanding
  cleanup into an unchecked batch; dense timestamp boundaries are left untouched.
- An owned 120-second Redis lease excludes other monitor instances; local checks
  coalesce and shutdown stops the timer before closing Redis. The lease key alone
  is conditionally released. Monitoring has a separate bounded-timeout connection
  so it does not change worker, API, authentication or session retry behavior.
- Failures log a sanitized reason and counts, never raw errors, job data or Redis
  credentials. If OOM prevents acquiring the lease, automatic cleanup stops safely
  and logs `REDIS_OOM`; follow the approved recovery procedure instead of bypassing
  the lock or security middleware.

Deployment requires approval for a backend release containing both the worker and
queue changes. No new environment variables, schema changes, Redis restart, public
Redis access or changes to `noeviction` are required. The existing Render `start:all`
entrypoint already starts the worker. Monitor logs `Redis memory usage` and `Redis
maintenance history cleaned`, and verify 401 for unauthenticated protected routes.
Review existing legacy history before rollout: BullMQ's first new completion can
apply the count cap to the old backlog in one script; use the approved bounded
manual recovery procedure first if the remaining backlog is large.

References: [BullMQ retention](https://docs.bullmq.io/guide/queues/auto-removal-of-jobs),
[BullMQ production policy](https://docs.bullmq.io/guide/going-to-production),
[Render free datastore limitations](https://render.com/docs/free).
