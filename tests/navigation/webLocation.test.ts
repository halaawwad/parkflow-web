import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCurrentLocation, watchLocation } from '@/utils/deviceLocation.web';

const ERR = { PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 };
const error = (code: number) => ({ code, message: 'x', ...ERR });
const position = { coords: { latitude: 31.9, longitude: 35.2, accuracy: 12, heading: null, speed: null }, timestamp: 1 };

function stubGeolocation(geo: Partial<Geolocation>, secure = true) {
  vi.stubGlobal('navigator', { geolocation: geo });
  vi.stubGlobal('window', { isSecureContext: secure });
}

afterEach(() => vi.unstubAllGlobals());

describe('web location', () => {
  it('answers quickly when a recent or coarse fix is available', async () => {
    const calls: PositionOptions[] = [];
    stubGeolocation({ getCurrentPosition: (ok, _err, options) => { calls.push(options!); ok(position as GeolocationPosition); } });
    expect(await getCurrentLocation()).toMatchObject({ ok: true, position: { latitude: 31.9, longitude: 35.2, accuracy: 12 } });
    expect(calls).toHaveLength(1);
    // Never the shim's "any age, wait forever".
    expect(calls[0]!.timeout).toBeGreaterThan(0);
    expect(calls[0]!.maximumAge).not.toBe(Infinity);
  });

  it('retries with high accuracy when the quick attempt times out', async () => {
    const calls: PositionOptions[] = [];
    stubGeolocation({
      getCurrentPosition: (ok, err, options) => {
        calls.push(options!);
        if (calls.length === 1) err!(error(ERR.TIMEOUT) as GeolocationPositionError);
        else ok(position as GeolocationPosition);
      },
    });
    expect((await getCurrentLocation()).ok).toBe(true);
    expect(calls.map((c) => c.enableHighAccuracy)).toEqual([false, true]);
  });

  it('reports a refusal as denied without asking twice', async () => {
    const get = vi.fn((_ok: PositionCallback, err?: PositionErrorCallback | null) => err!(error(ERR.PERMISSION_DENIED) as GeolocationPositionError));
    stubGeolocation({ getCurrentPosition: get });
    expect(await getCurrentLocation()).toEqual({ ok: false, error: 'denied' });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('needs no Permissions API, and refuses plainly on insecure pages', async () => {
    stubGeolocation({ getCurrentPosition: (ok) => ok(position as GeolocationPosition) });
    expect((await getCurrentLocation()).ok).toBe(true);
    stubGeolocation({ getCurrentPosition: (ok) => ok(position as GeolocationPosition) }, false);
    expect(await getCurrentLocation()).toEqual({ ok: false, error: 'unavailable' });
  });

  it('keeps watching through slow fixes during navigation and reports real failures', async () => {
    let fail!: PositionErrorCallback;
    let next!: PositionCallback;
    const clear = vi.fn();
    stubGeolocation({
      watchPosition: (ok, err) => {
        next = ok;
        fail = err!;
        return 7;
      },
      clearWatch: clear,
    });
    const fixes: number[] = [];
    const errors: string[] = [];
    const watch = await watchLocation((p) => fixes.push(p.latitude), (e) => errors.push(e));
    next(position as GeolocationPosition);
    fail(error(ERR.TIMEOUT) as GeolocationPositionError);
    fail(error(ERR.PERMISSION_DENIED) as GeolocationPositionError);
    expect(fixes).toEqual([31.9]);
    expect(errors).toEqual(['denied']);
    watch!.remove();
    expect(clear).toHaveBeenCalledWith(7);
  });
});
