import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { db } from '../src/database/client';
import { redis } from '../src/database/redis';
import * as auth from '../src/modules/auth/service';
import { emailProvider } from '../src/providers/email';
import { generateText } from '../src/providers/gemini';
import { routingService } from '../src/modules/routing/service';
import { summarizeRoute, summaryIsGrounded, type RouteSummaryInput } from '../src/modules/routing/summary';

const originalKey = env.GEMINI_API_KEY;
afterEach(() => {
  env.GEMINI_API_KEY = originalKey;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type LngLat = [number, number];
/** A minimal OSRM reply: one route along `line`, a depart and an arrive step. */
const osrmReply = (line: LngLat[], distance: number, duration: number) => ({
  ok: true,
  status: 200,
  json: async () => ({
    code: 'Ok',
    routes: [{
      distance,
      duration,
      geometry: { coordinates: line },
      legs: [{ steps: [
        { distance, duration, name: 'Main St', geometry: { coordinates: line }, maneuver: { type: 'depart', location: line[0], bearing_after: 90 } },
        { distance: 0, duration: 0, name: '', geometry: { coordinates: [line[line.length - 1]] }, maneuver: { type: 'arrive', modifier: 'right', location: line[line.length - 1] } },
      ] }],
    }],
  }),
});

const FROM = { latitude: 31.9038, longitude: 35.2044 };
const TO = { latitude: 31.9006, longitude: 35.2087 };

describe('walking routes', () => {
  it('asks the foot-profile server, identifies itself, and skips car-only steps', async () => {
    const fetchMock = vi.fn().mockResolvedValue(osrmReply([[35.2044, 31.9038], [35.2087, 31.9006]], 666, 533));
    vi.stubGlobal('fetch', fetchMock);
    const route = await routingService.getRoute(FROM, { latitude: 31.90061, longitude: 35.20871 }, {
      profile: 'walking', snapDestination: true, originBearing: 120, steps: true, mode: 'fastest',
    });

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    // No car-road snapping and no traffic lookup: only the one foot request.
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain(`${env.OSRM_FOOT_BASE_URL}/route/v1/${env.OSRM_FOOT_PROFILE}/`);
    // A walker can turn on the spot, so no heading constraint is sent.
    expect(urls[0]).not.toContain('bearings=');
    expect(fetchMock.mock.calls[0]![1].headers['User-Agent']).toBe(env.ROUTING_USER_AGENT);
    expect(route).toMatchObject({ source: 'osrm', profile: 'walking', distanceMeters: 666, durationSeconds: 533 });
    expect(route.steps?.map((step) => step.type)).toEqual(['depart', 'arrive']);
    expect(route.trafficSummary).toBeUndefined();
  });

  it('keeps driving on the car server and caches the two profiles separately', async () => {
    const fetchMock = vi.fn().mockResolvedValue(osrmReply([[35.2, 31.95], [35.21, 31.95]], 900, 120));
    vi.stubGlobal('fetch', fetchMock);
    const from = { latitude: 31.95, longitude: 35.2 };
    const to = { latitude: 31.95, longitude: 35.21 };
    const driving = await routingService.getRoute(from, to, { mode: 'fastest' });
    const walking = await routingService.getRoute(from, to, { profile: 'walking', mode: 'fastest' });
    const routeUrls = fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('/route/v1/'));
    expect(routeUrls[0]).toContain(`${env.OSRM_BASE_URL}/route/v1/driving/`);
    expect(routeUrls[1]).toContain(`/route/v1/${env.OSRM_FOOT_PROFILE}/`);
    expect(driving.profile).toBe('driving');
    expect(walking.profile).toBe('walking');
  });

  it('falls back to a non-navigable straight line at walking pace when the router is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const route = await routingService.getRoute({ latitude: 31.7, longitude: 35.1 }, { latitude: 31.71, longitude: 35.1 }, { profile: 'walking', mode: 'fastest', steps: true });
    expect(route.source).toBe('straight-line');
    expect(route.steps).toBeUndefined();
    // ~1112 m at 1.35 m/s.
    expect(route.durationSeconds).toBeGreaterThan(780);
    expect(route.durationSeconds).toBeLessThan(860);
  });
});

const summaryInput: RouteSummaryInput = {
  profile: 'walking',
  locale: 'en',
  destinationName: 'Al-Manara Square',
  distanceMeters: 666,
  durationSeconds: 533,
  steps: [
    { instruction: 'Head out on Hospital Street', distanceMeters: 120 },
    { instruction: 'Turn right onto Al-Yarmouk', distanceMeters: 300 },
    { instruction: 'Arrive at your destination, on the right', distanceMeters: 0 },
  ],
};
const geminiText = (text: string) => ({ ok: true, status: 200, headers: new Headers(), json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) });

describe('Gemini route summary', () => {
  it('reports not configured without a key and never calls the provider', async () => {
    env.GEMINI_API_KEY = undefined;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(summarizeRoute(summaryInput)).rejects.toMatchObject({ status: 503, code: 'AI_NOT_CONFIGURED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the key only in the header and returns a grounded summary', async () => {
    env.GEMINI_API_KEY = 'test-key-not-real';
    const fetchMock = vi.fn().mockResolvedValue(geminiText('A short **walk** of about 9 min: head out on Hospital Street, then turn right onto Al-Yarmouk.'));
    vi.stubGlobal('fetch', fetchMock);
    const result = await summarizeRoute(summaryInput);
    expect(result.summary).toBe('A short walk of about 9 min: head out on Hospital Street, then turn right onto Al-Yarmouk.');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain(`/models/${env.GEMINI_MODEL}:generateContent`);
    expect(String(url)).not.toContain('test-key-not-real');
    expect(init.headers['x-goog-api-key']).toBe('test-key-not-real');
    const sent = JSON.parse(init.body);
    expect(sent.systemInstruction.parts[0].text).toContain('Never invent');
    expect(sent.contents[0].parts[0].text).toContain('2. Turn right onto Al-Yarmouk (300 m)');
  });

  it('drops a reply that cites a distance the route does not contain', async () => {
    env.GEMINI_API_KEY = 'test-key-not-real';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(geminiText('Walk 850 m along the main road.')));
    await expect(summarizeRoute({ ...summaryInput, destinationName: 'Ungrounded test' })).resolves.toEqual({ summary: null, source: 'gemini' });
    expect(summaryIsGrounded('حوالي ٩ دقائق سيرًا', summaryInput)).toBe(true);
    expect(summaryIsGrounded('حوالي ١٥ دقيقة', summaryInput)).toBe(false);
  });

  it('retries a rate-limited request, then gives up with a safe error', async () => {
    env.GEMINI_API_KEY = 'test-key-not-real';
    const limited = { ok: false, status: 429, headers: new Headers({ 'retry-after': '1' }), json: async () => ({ error: { message: 'quota for key test-key-not-real' } }) };
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValueOnce(limited).mockResolvedValueOnce(geminiText('ok'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(generateText({ system: 's', prompt: 'p', sleep })).resolves.toBe('ok');
    expect(sleep).toHaveBeenCalledWith(1000);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(limited));
    const error = await generateText({ system: 's', prompt: 'p', sleep, retries: 1 }).catch((e: Error) => e);
    expect(error).toMatchObject({ status: 503, code: 'AI_UNAVAILABLE' });
    expect(String((error as Error).message)).not.toContain('test-key-not-real');
  });
});

describe('routing API', () => {
  it('validates the travel profile and the summary payload', async () => {
    vi.spyOn(emailProvider, 'sendOtp').mockResolvedValue();
    await redis.del('otp:resend:walker@example.com').catch(() => undefined);
    const challenge = await auth.requestOtp({ email: `walker-${Date.now()}@example.com` });
    const code = vi.mocked(emailProvider.sendOtp).mock.calls.at(-1)![1];
    const session = (await auth.verifyOtp({ challengeId: challenge.challengeId, code }, {})).session;
    const app = createApp();
    const bad = await request(app).post('/api/v1/routes/plan').auth(session.accessToken, { type: 'bearer' })
      .send({ origin: FROM, destination: TO, profile: 'flying' });
    expect(bad.status).toBe(400);
    const tooLong = await request(app).post('/api/v1/routes/summary').auth(session.accessToken, { type: 'bearer' })
      .send({ ...summaryInput, steps: Array.from({ length: 61 }, () => summaryInput.steps[0]) });
    expect(tooLong.status).toBe(400);
    expect((await request(app).post('/api/v1/routes/summary').send(summaryInput)).status).toBe(401);
    await db.user.deleteMany({ where: { email: { startsWith: 'walker-' } } }).catch(() => undefined);
  });
});
