import type { GeoPoint } from '@/types';
import { distanceMeters } from '@/utils/geo';
import { bearingAtDistance, projectOntoLine } from './geometry';
import { nextManeuverIndex, remainingSeconds, type NavigationRoute } from './maneuvers';

export interface RouteProgress {
  /** Distance driven along the route, metres. */
  along: number;
  /** GPS position snapped onto the route. */
  snapped: GeoPoint;
  /** How far the raw GPS position is from the route, metres. */
  offRoute: number;
  /** Direction of the route at the snapped position. */
  routeBearing: number;
  nextIndex: number;
  distanceToNext: number;
  remainingMeters: number;
  remainingSeconds: number;
  /** Straight-line distance to the destination. */
  directToDestination: number;
}

/** How far behind the last snapped position a new fix may land (GPS jitter). */
const BACK_TOLERANCE = 30;

/**
 * Snaps a GPS fix to the route. The search starts in a window just ahead of the
 * previous position so a road the route uses twice snaps to the right pass;
 * the whole route is searched only when the window finds nothing close, which
 * covers a GPS gap where the car skipped well ahead.
 */
export function computeProgress(
  route: NavigationRoute,
  point: GeoPoint,
  previousAlong: number | undefined,
  lookAheadMeters: number,
  onRouteMeters: number,
): RouteProgress {
  const from = previousAlong === undefined ? 0 : Math.max(0, previousAlong - BACK_TOLERANCE);
  const to = previousAlong === undefined ? Infinity : previousAlong + Math.max(150, lookAheadMeters);
  let hit = projectOntoLine(point, route.line, route.cumulative, from, to)!;
  if (previousAlong !== undefined && hit.distance > onRouteMeters) {
    const global = projectOntoLine(point, route.line, route.cumulative)!;
    // Only jump forward: snapping backwards would replay instructions already given.
    if (global.distance <= onRouteMeters && global.along > previousAlong) hit = global;
  }

  const along = hit.along;
  const nextIndex = nextManeuverIndex(route, along);
  const next = route.maneuvers[nextIndex]!;
  return {
    along,
    snapped: hit.point,
    offRoute: hit.distance,
    routeBearing: bearingAtDistance(route.line, route.cumulative, along),
    nextIndex,
    distanceToNext: Math.max(0, next.along - along),
    remainingMeters: Math.max(0, route.distance - along),
    remainingSeconds: remainingSeconds(route, along),
    directToDestination: distanceMeters(point, route.destination),
  };
}
