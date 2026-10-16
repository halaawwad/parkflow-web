import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() }));
vi.mock('@/services/storage', () => ({ secureStorage: storage, STORAGE_KEYS: { authSession: 'sp.auth.session' } }));
vi.mock('@/store/preferencesStore', () => ({ usePreferencesStore: { getState: () => ({ locale: 'en' }) } }));

const user = { id: 'test-user', fullName: 'Test User', locale: 'en' as const,
  createdAt: '2026-10-16T00:00:00Z', updatedAt: '2026-10-16T00:00:00Z' };
const session = () => ({ userId: user.id, accessToken: 'fixture-access', refreshToken: 'fixture-refresh', expiresAt: new Date(Date.now() + 3600000).toISOString() });
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const denied = () => response({ error: { code: 'UNAUTHORIZED', message: 'Session has ended' } }, 401);
let client: typeof import('../src/services/http/apiClient');
let auth: (typeof import('../src/store/authStore'))['useAuthStore'];
let connection: (typeof import('../src/store/apiConnectionStore'))['useApiConnectionStore'];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); vi.stubGlobal('__DEV__', false);
  vi.stubEnv('EXPO_PUBLIC_API_BASE_URL', 'https://api.example.invalid/api/v1');
  storage.getItem.mockReset(); storage.setItem.mockReset().mockResolvedValue(undefined); storage.removeItem.mockReset().mockResolvedValue(undefined);
  fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  client = await import('../src/services/http/apiClient');
  auth = (await import('../src/store/authStore')).useAuthStore;
  connection = (await import('../src/store/apiConnectionStore')).useApiConnectionStore;
  auth.setState({ session: session(), user, hydrated: true });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function slowFetch(delay: number) {
  return (_url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => resolve(response([])), delay);
    init.signal!.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); });
  });
}

describe('Render cold starts and session preservation', () => {
  it('recovers an expired remembered session after an outage and a 52-second refresh without extending its deadline', async () => {
    const saved = { ...session(), expiresAt: new Date(Date.now() - 1000).toISOString(), rememberedUntil: new Date(Date.now() + 23 * 3600000).toISOString() };
    await auth.getState().signIn(saved, user);
    fetchMock.mockRejectedValueOnce(new TypeError('Temporary network interruption'));
    await expect(client.api('/notifications')).rejects.toMatchObject({ code: 'network' });
    expect(auth.getState().session).toEqual(saved);
    const next = { ...saved, accessToken: 'recovered-access', refreshToken: 'recovered-refresh', expiresAt: new Date(Date.now() + 900000).toISOString() };
    fetchMock.mockImplementation((url: string, init: RequestInit) => url.endsWith('/auth/refresh')
      ? new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(response(next)), 52000);
        init.signal!.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); });
      }) : Promise.resolve(response([])));
    const recovered = client.api('/notifications');
    await vi.advanceTimersByTimeAsync(8000);
    expect(connection.getState().slowRequests).toBe(1);
    await vi.advanceTimersByTimeAsync(44000);
    await expect(recovered).resolves.toEqual([]);
    expect(auth.getState()).toMatchObject({ session: next, user });
    expect(JSON.parse(storage.setItem.mock.calls.at(-1)![1]).session.rememberedUntil).toBe(saved.rememberedUntil);
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(connection.getState().slowRequests).toBe(0);
  });

  it('requires login if the server confirms the absolute deadline expired during a slow refresh', async () => {
    const deadline = new Date(Date.now() + 10000).toISOString();
    auth.setState({ session: { ...session(), expiresAt: new Date(Date.now() - 1000).toISOString(), rememberedUntil: deadline } });
    fetchMock.mockImplementation(() => new Promise<Response>(resolve => setTimeout(() => resolve(denied()), 52000)));
    const pending = client.api('/notifications');
    const rejection = expect(pending).rejects.toMatchObject({ code: 'unauthorized' });
    await vi.advanceTimersByTimeAsync(52000); await rejection;
    expect(auth.getState().session).toBeUndefined();
    expect(storage.removeItem).toHaveBeenCalledOnce();
    expect(connection.getState().slowRequests).toBe(0);
  });

  it('restores the same persisted session on a page refresh without another OTP', async () => {
    const saved = { ...session(), rememberedUntil: new Date(Date.now() + 86400000).toISOString() };
    await auth.getState().signIn(saved, user);
    storage.getItem.mockResolvedValue(storage.setItem.mock.calls.at(-1)![1]);
    auth.setState({ session: undefined, user: undefined, hydrated: false });
    fetchMock.mockResolvedValue(response(user));
    await auth.getState().hydrate();
    expect(auth.getState()).toMatchObject({ session: saved, user, hydrated: true });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['https://api.example.invalid/api/v1/auth/me']);
  });

  it('restores after a browser restart and refreshes expired access without extending rememberedUntil', async () => {
    const saved = { ...session(), expiresAt: new Date(Date.now() + 900000).toISOString(), rememberedUntil: new Date(Date.now() + 86400000).toISOString() };
    await auth.getState().signIn(saved, user);
    const persisted = storage.setItem.mock.calls.at(-1)![1];
    await vi.advanceTimersByTimeAsync(2 * 3600000);
    vi.resetModules(); auth = (await import('../src/store/authStore')).useAuthStore;
    storage.getItem.mockResolvedValue(persisted);
    const next = { ...saved, accessToken: 'restarted-access', refreshToken: 'restarted-refresh', expiresAt: new Date(Date.now() + 900000).toISOString() };
    fetchMock.mockImplementation(async (url: string) => response(url.endsWith('/auth/refresh') ? next : user));
    await auth.getState().hydrate();
    expect(auth.getState()).toMatchObject({ session: next, user, hydrated: true });
    expect(fetchMock.mock.calls.some(([url]) => url.includes('otp'))).toBe(false);
  });

  it('waits for the absolute boundary before the final refresh and clears only after server rejection', async () => {
    const deadline = new Date(Date.now() + 10000).toISOString();
    const final = { ...session(), expiresAt: deadline, rememberedUntil: deadline };
    auth.setState({ session: final });
    expect(client.sessionRefreshDelay(final)).toBe(10000);
    fetchMock.mockResolvedValue(denied());
    await vi.advanceTimersByTimeAsync(10000);
    await expect(client.api('/notifications')).rejects.toMatchObject({ code: 'unauthorized' });
    expect(auth.getState().session).toBeUndefined();
  });

  it('does not accept a refresh response that extends a known absolute deadline', async () => {
    const rememberedUntil = new Date(Date.now() + 86400000).toISOString();
    auth.setState({ session: { ...session(), rememberedUntil } });
    fetchMock.mockResolvedValue(response({ ...session(), rememberedUntil: new Date(Date.now() + 2 * 86400000).toISOString() }));
    await expect(client.refreshSession()).rejects.toMatchObject({ code: 'network' });
    expect(auth.getState().session?.rememberedUntil).toBe(rememberedUntil);
  });

  it('removes local session storage on explicit logout so reopening cannot restore it', async () => {
    fetchMock.mockResolvedValue(response({ ok: true }));
    const { httpAuthService } = await import('../src/services/http/authService');
    await httpAuthService.signOut();
    expect(storage.removeItem).toHaveBeenCalledWith('sp.auth.session');
    expect(auth.getState().session).toBeUndefined();
    storage.getItem.mockResolvedValue(null); fetchMock.mockClear();
    await auth.getState().hydrate();
    expect(auth.getState().session).toBeUndefined(); expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires normal login on a browser with no stored tokens', async () => {
    auth.setState({ session: undefined, user: undefined, hydrated: false });
    storage.getItem.mockResolvedValue(null);
    await auth.getState().hydrate();
    expect(auth.getState()).toMatchObject({ hydrated: true, session: undefined, user: undefined });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('waits through a 52-second cold start, shows feedback, and keeps the session', async () => {
    fetchMock.mockImplementation(slowFetch(52000));
    const pending = client.api('/notifications');
    await vi.advanceTimersByTimeAsync(8000);
    expect(connection.getState().slowRequests).toBe(1);
    await vi.advanceTimersByTimeAsync(44000);
    await expect(pending).resolves.toEqual([]);
    expect(connection.getState().slowRequests).toBe(0);
    expect(auth.getState().user).toEqual(user);
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('times out after 75 seconds without signing out or replaying a mutation', async () => {
    fetchMock.mockImplementation(slowFetch(90000));
    const pending = client.api('/parking/sessions', { method: 'POST', body: {} });
    const rejection = expect(pending).rejects.toMatchObject({ code: 'network' });
    await vi.advanceTimersByTimeAsync(75000); await rejection;
    expect(connection.getState().slowRequests).toBe(0);
    expect(auth.getState().session?.refreshToken).toBe('fixture-refresh');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses a bounded warm timeout and restores cold-start tolerance after inactivity', async () => {
    fetchMock.mockResolvedValueOnce(response([])); await client.api('/notifications');
    fetchMock.mockImplementation(slowFetch(52000));
    const pending = client.api('/notifications');
    const rejection = expect(pending).rejects.toMatchObject({ code: 'network' });
    await vi.advanceTimersByTimeAsync(20000); await rejection;
    await vi.advanceTimersByTimeAsync(5 * 60000);
    const afterIdle = client.api('/notifications');
    await vi.advanceTimersByTimeAsync(52000); await expect(afterIdle).resolves.toEqual([]);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it.each([503, 429])('preserves an expired session on refresh HTTP %s and does not retry refresh', async status => {
    auth.setState({ session: { ...session(), expiresAt: new Date(Date.now() - 1000).toISOString() } });
    fetchMock.mockResolvedValue(response({ error: { code: status === 429 ? 'RATE_LIMITED' : 'UNAVAILABLE' } }, status));
    await expect(client.api('/notifications')).rejects.toBeDefined();
    expect(auth.getState().session?.refreshToken).toBe('fixture-refresh');
    expect(auth.getState().user).toEqual(user);
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves an expired session when refresh loses network connectivity', async () => {
    auth.setState({ session: { ...session(), expiresAt: new Date(Date.now() - 1000).toISOString() } });
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(client.api('/notifications')).rejects.toMatchObject({ code: 'network' });
    expect(auth.getState().user).toEqual(user); expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('refreshes an expired token once for concurrent requests and uses the renewed session', async () => {
    auth.setState({ session: { ...session(), expiresAt: new Date(Date.now() - 1000).toISOString() } });
    const next = { ...session(), accessToken: 'renewed-access', refreshToken: 'renewed-refresh' };
    fetchMock.mockImplementation(async (url: string) => url.endsWith('/auth/refresh') ? response(next) : response([]));
    await Promise.all([client.api('/notifications'), client.api('/notifications')]);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/auth/refresh'))).toHaveLength(1);
    expect(auth.getState().session?.refreshToken).toBe('renewed-refresh');
    expect(fetchMock.mock.calls.at(-1)?.[1].headers.Authorization).toBe('Bearer renewed-access');
  });

  it('signs out only when refresh returns a confirmed backend UNAUTHORIZED rejection', async () => {
    fetchMock.mockResolvedValue(denied());
    await expect(client.refreshSession()).rejects.toMatchObject({ code: 'unauthorized' });
    expect(auth.getState().session).toBeUndefined(); expect(storage.removeItem).toHaveBeenCalledOnce();
  });

  it.each(['proxy-401', 'invalid-session', 'success-error'])('keeps the session for an unconfirmed auth failure: %s', async kind => {
    fetchMock.mockResolvedValue(kind === 'proxy-401' ? new Response('<html>Unavailable</html>', { status: 401 })
      : kind === 'invalid-session' ? response(null) : response({ error: { code: 'UNAUTHORIZED' } }));
    await expect(client.refreshSession()).rejects.toBeDefined();
    expect(auth.getState().session?.refreshToken).toBe('fixture-refresh');
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it.each([true, false])('an old refresh cannot overwrite or sign out a newer login (rejected=%s)', async rejected => {
    let finish!: (value: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
    const pending = client.refreshSession();
    const rejection = expect(pending).rejects.toBeDefined();
    const newer = { ...session(), accessToken: 'new-login-access', refreshToken: 'new-login-refresh' };
    await auth.getState().signIn(newer, user);
    finish(rejected ? denied() : response({ ...session(), refreshToken: 'old-renewed-token' })); await rejection;
    expect(auth.getState().session).toEqual(newer); expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('hydrates the cached identity immediately and preserves it after a malformed auth/me response', async () => {
    const saved = session(); storage.getItem.mockResolvedValue(JSON.stringify({ session: saved, user }));
    fetchMock.mockResolvedValue(response(null));
    const hydrate = auth.getState().hydrate(); await hydrate;
    expect(auth.getState()).toMatchObject({ hydrated: true, session: saved, user });
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('keeps cached identity during auth/me cold-start validation', async () => {
    storage.getItem.mockResolvedValue(JSON.stringify({ session: session(), user }));
    fetchMock.mockImplementation(slowFetch(52000));
    const pending = auth.getState().hydrate(); await vi.advanceTimersByTimeAsync(0);
    expect(auth.getState()).toMatchObject({ hydrated: true, user });
    await vi.advanceTimersByTimeAsync(52000); await pending;
    expect(auth.getState().user).toEqual(user);
  });

  it('keeps OTP errors and rate limits in the existing flow without retrying or signing out', async () => {
    fetchMock.mockResolvedValue(response({ error: { code: 'OTP_INVALID', message: 'Invalid code' } }, 401));
    await expect(client.api('/auth/verify-otp', { method: 'POST', public: true, body: { challengeId: 'fixture', code: '000000' } })).rejects.toMatchObject({ message: 'Invalid code', details: { status: 401, serverCode: 'OTP_INVALID' } });
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('clears a matching session if the API still rejects it after a successful refresh', async () => {
    fetchMock.mockResolvedValueOnce(denied()).mockResolvedValueOnce(response({ ...session(), refreshToken: 'renewed' })).mockResolvedValueOnce(denied());
    await expect(client.api('/notifications')).rejects.toMatchObject({ code: 'unauthorized' });
    expect(auth.getState().session).toBeUndefined();
  });
});
