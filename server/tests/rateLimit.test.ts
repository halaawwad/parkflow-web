import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { redis } from '../src/database/redis';
import { logger } from '../src/config/logger';

const app = createApp();
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.spyOn(logger, 'error').mockImplementation(() => undefined);
  await redis.flushdb();
});

describe('shared Redis rate limiter request flow', () => {
  it('reaches authentication for protected routes when Redis commands succeed', async () => {
    for (const path of ['/auth/me', '/notifications', '/admin/summary']) {
      const result = await request(app).get('/api/v1' + path);
      expect(result.status).toBe(401);
      expect(result.body.error.code).toBe('UNAUTHORIZED');
      expect(result.headers['x-request-id']).toBeTruthy();
    }
    expect((await request(app).get('/health')).status).toBe(200);
    expect((await request(app).get('/ready')).status).toBe(200);
  });

  it('keeps the global 300-request quota enabled and returns 429 rather than bypassing authentication', async () => {
    for (let i = 0; i < 300; i++) {
      expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
    }
    const limited = await request(app).get('/api/v1/auth/me');
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeTruthy();
    expect((await request(app).get('/health')).status).toBe(200);
  });

  it('preserves the separate OTP request quota without sending any verification emails', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await request(app).post('/api/v1/auth/request-otp').send({ email: 'invalid' })).status).toBe(400);
    }
    const limited = await request(app).post('/api/v1/auth/request-otp').send({ email: 'invalid' });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });

  it('recovers loaded Lua scripts after an isolated Redis script-cache reset', async () => {
    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
    await redis.script('FLUSH');
    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
  });

  it('reproduces ready=200 and API=500 when an isolated limiter key has an invalid counter', async () => {
    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
    const keys = await redis.keys('rate:api:*');
    expect(keys).toHaveLength(1);
    await redis.set(keys[0], 'invalid-test-counter', 'PX', 60000);
    expect((await request(app).get('/ready')).status).toBe(200);
    const result = await request(app).get('/api/v1/auth/me');
    expect(result.status).toBe(500);
    expect(result.body.error.code).toBe('INTERNAL_ERROR');
    const logged = vi.mocked(logger.error).mock.calls.at(-1)?.[0] as { err: Error; requestId: string };
    expect(logged.err.message).toMatch(/integer|WRONGTYPE/i);
    expect(logged.requestId).toBe(result.headers['x-request-id']);
    expect(JSON.stringify(result.body)).not.toContain('invalid-test-counter');
  });

  it('reproduces ready=200 and API=500 when isolated Redis rejects writes under noeviction', async () => {
    // Only the disposable Redis container may have its memory limit changed.
    expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(process.env.REDIS_URL!).hostname);
    const previousMemory = await redis.config('GET', 'maxmemory') as string[];
    const previousPolicy = await redis.config('GET', 'maxmemory-policy') as string[];
    try {
      await redis.config('SET', 'maxmemory-policy', 'noeviction');
      await redis.config('SET', 'maxmemory', '1');
      expect((await request(app).get('/ready')).status).toBe(200);
      const result = await request(app).get('/api/v1/auth/me');
      expect(result.status).toBe(500);
      const logged = vi.mocked(logger.error).mock.calls.at(-1)?.[0] as { err: Error };
      expect(logged.err.message).toMatch(/OOM|memory/i);
      expect(result.body.error.code).toBe('INTERNAL_ERROR');
    } finally {
      await redis.config('SET', 'maxmemory', previousMemory[1]);
      await redis.config('SET', 'maxmemory-policy', previousPolicy[1]);
    }
  });
});
