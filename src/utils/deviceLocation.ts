import * as Location from 'expo-location';

/**
 * Device location for the map and navigation. iOS/Android use expo-location;
 * the web build has its own implementation in `deviceLocation.web.ts`, because
 * expo-location's web shim waits forever without a fix and fails outright on
 * browsers without the Permissions API (several mobile and in-app browsers).
 */

export interface DevicePosition {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  timestamp: number;
}

export type LocationFailure = 'denied' | 'unavailable' | 'timeout';

export type LocationResult = { ok: true; position: DevicePosition } | { ok: false; error: LocationFailure };

export interface LocationWatch {
  remove(): void;
}

const fromExpo = (position: Location.LocationObject): DevicePosition => ({
  latitude: position.coords.latitude,
  longitude: position.coords.longitude,
  accuracy: position.coords.accuracy ?? null,
  heading: position.coords.heading ?? null,
  speed: position.coords.speed ?? null,
  timestamp: position.timestamp || Date.now(),
});

const failureOf = (error: unknown): LocationFailure =>
  /denied|permission/i.test(String((error as Error)?.message ?? error)) ? 'denied' : 'unavailable';

/** One position, asking for permission first when needed. */
export async function getCurrentLocation(): Promise<LocationResult> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return { ok: false, error: 'denied' };
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { ok: true, position: fromExpo(position) };
  } catch (error) {
    return { ok: false, error: failureOf(error) };
  }
}

/** Continuous high-accuracy positions for navigation. */
export async function watchLocation(
  onPosition: (position: DevicePosition) => void,
  onError: (error: LocationFailure) => void,
): Promise<LocationWatch | undefined> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      onError('denied');
      return undefined;
    }
    return await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
      (position) => onPosition(fromExpo(position)),
      (reason) => onError(failureOf(reason)),
    );
  } catch (error) {
    onError(failureOf(error));
    return undefined;
  }
}
