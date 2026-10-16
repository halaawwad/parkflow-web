import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app';
import { db } from '../src/database/client';
import { redis } from '../src/database/redis';
import * as auth from '../src/modules/auth/service';
import { emailProvider } from '../src/providers/email';
import { env } from '../src/config/env';

const app = createApp();
const DAY = 24 * 60 * 60 * 1000;
async function login(email = 'remembered@session.example', device = 'test-browser') {
  const challenge = await auth.requestOtp({ email });
  const code = vi.mocked(emailProvider.sendOtp).mock.calls.at(-1)![1];
  return auth.verifyOtp({ challengeId: challenge.challengeId, code }, { device });
}
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.spyOn(emailProvider, 'sendOtp').mockResolvedValue();
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe('TRUNCATE ' + tables.map(t => '"' + t.tablename.replace(/"/g, '""') + '"').join(',') + ' CASCADE');
  await redis.flushdb();
});

describe('absolute remembered session lifetime', () => {
  it('issues tokens through OTP with an absolute deadline no later than 24 hours', async () => {
    const before = Date.now();
    const account = await login();
    const deadline = Date.parse(account.session.rememberedUntil);
    expect(deadline).toBeGreaterThan(before + DAY - 2000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + DAY);
    const refresh = jwt.decode(account.session.refreshToken) as jwt.JwtPayload;
    expect(refresh.exp! * 1000).toBe(deadline);
    expect(Date.parse(account.session.expiresAt)).toBeLessThanOrEqual(deadline);
    const record = await db.refreshToken.findUniqueOrThrow({ where: { id: refresh.jti! } });
    expect(record.expiresAt.getTime()).toBe(deadline);
  });

  it('refreshes expired access tokens without extending the original deadline', async () => {
    const account = await login();
    const first = jwt.decode(account.session.refreshToken) as jwt.JwtPayload;
    const deadline = Date.parse(account.session.rememberedUntil);
    const clock = vi.spyOn(Date, 'now');
    clock.mockReturnValue(deadline - 2 * 3600000);
    await expect(auth.authenticate(account.session.accessToken)).rejects.toMatchObject({ status: 401 });
    const next = await auth.refresh(account.session.refreshToken, { device: 'test-browser' });
    expect(next.rememberedUntil).toBe(account.session.rememberedUntil);
    expect((jwt.decode(next.refreshToken) as jwt.JwtPayload).familyId).toBe(first.familyId);
    await expect(auth.authenticate(next.accessToken)).resolves.toMatchObject({ userId: account.user.id });
    clock.mockReturnValue(deadline - 5000);
    const final = await auth.refresh(next.refreshToken, {});
    expect(final.rememberedUntil).toBe(account.session.rememberedUntil);
    expect(Date.parse(final.expiresAt)).toBe(deadline);
    clock.mockReturnValue(deadline);
    await expect(auth.authenticate(final.accessToken)).rejects.toMatchObject({ status: 401 });
    await expect(auth.refresh(final.refreshToken, {})).rejects.toMatchObject({ status: 401 });
  });

  it('rejects legacy 30-day tokens when their original family login is over 24 hours old', async () => {
    const account = await login();
    const refresh = jwt.decode(account.session.refreshToken) as jwt.JwtPayload;
    const legacyRefresh = jwt.sign({ sub: account.user.id, jti: refresh.jti, familyId: refresh.familyId, kind: 'refresh' }, env.JWT_REFRESH_SECRET,
      { algorithm: 'HS256', expiresIn: 30 * 86400, issuer: 'parkflow', audience: 'parkflow-refresh' });
    const legacyAccess = jwt.sign({ sub: account.user.id, sid: refresh.jti, kind: 'access' }, env.JWT_ACCESS_SECRET,
      { algorithm: 'HS256', expiresIn: 2 * 86400, issuer: 'parkflow', audience: 'parkflow-api' });
    await db.refreshToken.update({ where: { id: refresh.jti! }, data: {
      tokenHash: auth.digest(legacyRefresh), createdAt: new Date(Date.now() - DAY - 1000), expiresAt: new Date(Date.now() + 30 * DAY),
    } });
    await expect(auth.authenticate(legacyAccess)).rejects.toMatchObject({ status: 401 });
    await expect(auth.refresh(legacyRefresh, {})).rejects.toMatchObject({ status: 401 });
  });

  it('caps even an unusually long access TTL at the 24-hour boundary', async () => {
    const previous = env.ACCESS_TOKEN_TTL;
    try {
      env.ACCESS_TOKEN_TTL = 2 * 86400;
      const account = await login();
      expect(account.session.expiresAt).toBe(account.session.rememberedUntil);
      expect((jwt.decode(account.session.accessToken) as jwt.JwtPayload).exp! * 1000).toBe(Date.parse(account.session.rememberedUntil));
    } finally { env.ACCESS_TOKEN_TTL = previous; }
  });

  it('revokes the entire browser session family on logout after rotation', async () => {
    const account = await login();
    const next = await auth.refresh(account.session.refreshToken, {});
    const claims = auth.verifyAccess(next.accessToken);
    await auth.logout(account.user.id, claims.sid);
    await expect(auth.authenticate(next.accessToken)).rejects.toMatchObject({ status: 401 });
    await expect(auth.refresh(next.refreshToken, {})).rejects.toMatchObject({ status: 401 });
    expect(await db.refreshToken.count({ where: { userId: account.user.id, revokedAt: null } })).toBe(0);
  });

  it('rejects administratively revoked or suspended sessions before the deadline', async () => {
    const account = await login();
    const claims = auth.verifyAccess(account.session.accessToken);
    await db.refreshToken.update({ where: { id: claims.sid }, data: { revokedAt: new Date() } });
    await expect(auth.authenticate(account.session.accessToken)).rejects.toMatchObject({ status: 401 });
    await expect(auth.refresh(account.session.refreshToken, {})).rejects.toMatchObject({ status: 401 });
    await redis.del('otp:email:cooldown:remembered@session.example');
    const again = await login();
    await db.user.update({ where: { id: again.user.id }, data: { status: 'SUSPENDED' } });
    await expect(auth.authenticate(again.session.accessToken)).rejects.toMatchObject({ status: 401 });
    await expect(auth.refresh(again.session.refreshToken, {})).rejects.toMatchObject({ status: 401 });
  });

  it('requires OTP on a new device; an email and matching user agent grant no session', async () => {
    const first = await login();
    expect((await request(app).get('/api/v1/auth/me').set('User-Agent', 'test-browser')).status).toBe(401);
    await redis.del('otp:email:cooldown:remembered@session.example');
    const challenge = await request(app).post('/api/v1/auth/request-otp').send({ email: first.user.email });
    expect(challenge.status).toBe(200); expect(challenge.body).not.toHaveProperty('session');
    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
    const code = vi.mocked(emailProvider.sendOtp).mock.calls.at(-1)![1];
    const second = await auth.verifyOtp({ challengeId: challenge.body.challengeId, code }, { device: 'second-browser' });
    expect((jwt.decode(second.session.refreshToken) as jwt.JwtPayload).familyId)
      .not.toBe((jwt.decode(first.session.refreshToken) as jwt.JwtPayload).familyId);
    await auth.logout(first.user.id, auth.verifyAccess(first.session.accessToken).sid);
    await expect(auth.authenticate(second.session.accessToken)).resolves.toMatchObject({ userId: first.user.id });
  });

  it('rechecks database roles for ADMIN, PARKING_OPERATOR and USER on every authenticated request', async () => {
    const account = await login();
    for (const role of ['ADMIN', 'PARKING_OPERATOR', 'USER'] as const) {
      await db.user.update({ where: { id: account.user.id }, data: { role } });
      await expect(auth.authenticate(account.session.accessToken)).resolves.toMatchObject({ role });
      const result = await request(app).get('/api/v1/admin/summary').auth(account.session.accessToken, { type: 'bearer' });
      expect(result.status).toBe(role === 'ADMIN' ? 200 : 403);
    }
  });
});
