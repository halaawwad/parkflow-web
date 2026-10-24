import type { GeoPoint, RouteResult, RouteStep } from '@/types';
import { buildNavigationRoute, type NavigationRoute } from '@/utils/navigation/maneuvers';
import { bearingAtDistance, pointAtDistance } from '@/utils/navigation/geometry';
import type { LocationFix } from '@/utils/navigation/session';
import manara from './fixtures/ramallah-manara-route.json';
import second from './fixtures/ramallah-second-route.json';
// Real pedestrian routes from the OSRM foot profile (routing.openstreetmap.de), Ramallah, recorded for these tests.
import walkHospital from './fixtures/ramallah-walk-hospital-route.json';
import walkManara from './fixtures/ramallah-walk-manara-route.json';

type LngLat = [number, number];
interface OsrmJson {
  routes: {
    distance: number;
    duration: number;
    geometry: { coordinates: LngLat[] };
    legs: {
      steps: {
        distance: number;
        duration: number;
        name?: string;
        ref?: string;
        geometry: { coordinates: LngLat[] };
        maneuver: { type: string; modifier?: string; exit?: number; location: LngLat; bearing_before?: number; bearing_after?: number };
      }[];
    }[];
  }[];
}

const toPoint = ([longitude, latitude]: LngLat): GeoPoint => ({ latitude, longitude });

/** Same mapping the backend applies to an OSRM response (server/src/modules/routing/service.ts). */
export function routeResultFromOsrm(json: OsrmJson): RouteResult {
  const route = json.routes[0]!;
  const steps: RouteStep[] = route.legs.flatMap((leg, legIndex) =>
    leg.steps.map((step) => ({
      type: step.maneuver.type,
      modifier: step.maneuver.modifier,
      exit: step.maneuver.exit,
      location: toPoint(step.maneuver.location),
      bearingBefore: step.maneuver.bearing_before ?? 0,
      bearingAfter: step.maneuver.bearing_after ?? 0,
      name: step.name ?? '',
      ref: step.ref || undefined,
      distanceMeters: step.distance,
      durationSeconds: step.duration,
      geometry: step.geometry.coordinates.map(toPoint),
      leg: legIndex,
    })),
  );
  return {
    coordinates: route.geometry.coordinates.map(toPoint),
    distanceMeters: route.distance,
    durationSeconds: route.duration,
    steps,
    penaltySeconds: 0,
    closuresOnRoute: [],
    rejected: [],
    alternatives: [],
    source: 'osrm',
  };
}

export const fixtures = {
  manara: routeResultFromOsrm(manara as unknown as OsrmJson),
  second: routeResultFromOsrm(second as unknown as OsrmJson),
  walkHospital: { ...routeResultFromOsrm(walkHospital as unknown as OsrmJson), profile: 'walking' as const },
  walkManara: { ...routeResultFromOsrm(walkManara as unknown as OsrmJson), profile: 'walking' as const },
};

export function navRoute(result: RouteResult): NavigationRoute {
  return buildNavigationRoute(result)!;
}

/** Offsets a point sideways (perpendicular to `bearing`) by `meters`. */
export function offset(point: GeoPoint, bearing: number, meters: number): GeoPoint {
  const rad = ((bearing + 90) * Math.PI) / 180;
  return {
    latitude: point.latitude + (Math.cos(rad) * meters) / 111_320,
    longitude: point.longitude + (Math.sin(rad) * meters) / (111_320 * Math.cos((point.latitude * Math.PI) / 180)),
  };
}

export function fixAt(route: NavigationRoute, along: number, t: number, overrides: Partial<LocationFix> = {}): LocationFix {
  return {
    point: pointAtDistance(route.line, route.cumulative, along),
    accuracy: 8,
    heading: bearingAtDistance(route.line, route.cumulative, along),
    speed: 10,
    timestamp: t,
    ...overrides,
  };
}
