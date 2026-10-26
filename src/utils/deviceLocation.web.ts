import type { DevicePosition, LocationFailure, LocationResult, LocationWatch } from './deviceLocation';

export type { DevicePosition, LocationFailure, LocationResult, LocationWatch } from './deviceLocation';

/**
 * Browser geolocation, used directly instead of expo-location's web shim.
 * The shim asks with `maximumAge: Infinity` and no timeout (so a phone without
 * a quick fix waits forever, or gets a stale position), and it throws on
 * browsers without `navigator.permissions` — Safari versions and the in-app
 * browsers of WhatsApp, Instagram and others. The browser's own prompt is the
 * permission request here, which works everywhere geolocation does.
 */

/** A quick answer first (Wi-Fi/cell, or a fix from the last minute)… */
const QUICK = { enableHighAccuracy: false, maximumAge: 60_000, timeout: 8_000 };
/** …then a precise one if that failed for lack of a fix. */
const PRECISE = { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 };
/** Navigation: fresh high-accuracy fixes; the browser retries after each timeout. */
const WATCH = { enableHighAccuracy: true, maximumAge: 1_000, timeout: 20_000 };

const fromBrowser = (position: GeolocationPosition): DevicePosition => ({
  latitude: position.coords.latitude,
  longitude: position.coords.longitude,
  accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
  heading: position.coords.heading ?? null,
  speed: position.coords.speed ?? null,
  timestamp: position.timestamp || Date.now(),
});

const failureOf = (error: GeolocationPositionError): LocationFailure =>
  error.code === error.PERMISSION_DENIED ? 'denied' : error.code === error.TIMEOUT ? 'timeout' : 'unavailable';

function geolocation(): Geolocation | undefined {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return undefined;
  // Browsers only share location with secure (https) pages.
  if (typeof window !== 'undefined' && window.isSecureContext === false) return undefined;
  return navigator.geolocation;
}

function once(geo: Geolocation, options: PositionOptions): Promise<LocationResult> {
  return new Promise((resolve) => {
    geo.getCurrentPosition(
      (position) => resolve({ ok: true, position: fromBrowser(position) }),
      (error) => resolve({ ok: false, error: failureOf(error) }),
      options,
    );
  });
}

export async function getCurrentLocation(): Promise<LocationResult> {
  const geo = geolocation();
  if (!geo) return { ok: false, error: 'unavailable' };
  const quick = await once(geo, QUICK);
  if (quick.ok || quick.error === 'denied') return quick;
  return once(geo, PRECISE);
}

export async function watchLocation(
  onPosition: (position: DevicePosition) => void,
  onError: (error: LocationFailure) => void,
): Promise<LocationWatch | undefined> {
  const geo = geolocation();
  if (!geo) {
    onError('unavailable');
    return undefined;
  }
  const id = geo.watchPosition(
    (position) => onPosition(fromBrowser(position)),
    (error) => {
      // A timeout is a slow fix, not a failure: the watch keeps trying and the
      // session's own signal-loss logic decides what to tell the driver.
      if (error.code !== error.TIMEOUT) onError(failureOf(error));
    },
    WATCH,
  );
  return { remove: () => geo.clearWatch(id) };
}
