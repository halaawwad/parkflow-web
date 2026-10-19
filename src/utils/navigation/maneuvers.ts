import type { GeoPoint, RouteResult, RouteStep } from '@/types';
import { bearingDifference, cumulativeDistances } from './geometry';

/**
 * Converts the routing provider's steps into the maneuvers the driver is
 * guided through. Every maneuver comes from a real OSRM step; when the provider
 * returned no steps (offline straight-line fallback) there is no route to guide
 * along and `buildNavigationRoute` returns undefined rather than inventing turns.
 */

export type ManeuverKind =
  | 'depart'
  | 'straight'
  | 'slight-left'
  | 'slight-right'
  | 'left'
  | 'right'
  | 'sharp-left'
  | 'sharp-right'
  | 'uturn'
  | 'keep-left'
  | 'keep-right'
  | 'roundabout'
  | 'waypoint'
  | 'arrive';

export interface Maneuver {
  /** Stable within one route: `${routeId}:${index}`. */
  id: string;
  index: number;
  kind: ManeuverKind;
  /** Distance from the route start to the maneuver point, metres. */
  along: number;
  location: GeoPoint;
  /** Road taken after the maneuver ('' when the map has no name). */
  street: string;
  /** Roundabout exit number. */
  exit?: number;
  /** Side of the road the stop or destination is on. */
  side?: 'left' | 'right';
  /** False for maneuvers that only rename the road or leave a roundabout already announced. */
  announce: boolean;
  leg: number;
}

export interface NavigationRoute {
  id: string;
  line: GeoPoint[];
  cumulative: number[];
  distance: number;
  duration: number;
  maneuvers: Maneuver[];
  /** Travel time per stretch of the route, for remaining-time estimates. */
  spans: { start: number; end: number; duration: number }[];
  /** Where the route ends on the road network — arrival is measured against this. */
  destination: GeoPoint;
  /** Intermediate stops still ahead on this route, in order. */
  via: GeoPoint[];
}

const SIDE = new Set(['left', 'right']);

/** Turn direction from the bearing change when the provider gives no modifier. */
function modifierFromBearings(before: number, after: number): string {
  const signed = ((after - before + 540) % 360) - 180;
  const size = bearingDifference(before, after);
  if (size < 20) return 'straight';
  if (size > 160) return 'uturn';
  const side = signed > 0 ? 'right' : 'left';
  if (size < 45) return `slight ${side}`;
  if (size > 120) return `sharp ${side}`;
  return side;
}

function turnKind(modifier: string): ManeuverKind {
  switch (modifier) {
    case 'uturn':
      return 'uturn';
    case 'sharp left':
      return 'sharp-left';
    case 'sharp right':
      return 'sharp-right';
    case 'left':
      return 'left';
    case 'right':
      return 'right';
    case 'slight left':
      return 'slight-left';
    case 'slight right':
      return 'slight-right';
    default:
      return 'straight';
  }
}

export function classifyStep(step: RouteStep, isLastLeg: boolean): { kind: ManeuverKind; announce: boolean } {
  const modifier = step.modifier ?? modifierFromBearings(step.bearingBefore, step.bearingAfter);
  switch (step.type) {
    case 'depart':
      return { kind: 'depart', announce: false };
    case 'arrive':
      return { kind: isLastLeg ? 'arrive' : 'waypoint', announce: true };
    case 'roundabout':
    case 'rotary':
      return { kind: 'roundabout', announce: true };
    case 'exit roundabout':
    case 'exit rotary':
      // The exit was already part of the roundabout instruction.
      return { kind: turnKind(modifier), announce: false };
    case 'fork':
    case 'on ramp':
    case 'off ramp':
    case 'merge':
      if (modifier.includes('left') && !modifier.includes('sharp') && modifier !== 'left') return { kind: 'keep-left', announce: true };
      if (modifier.includes('right') && !modifier.includes('sharp') && modifier !== 'right') return { kind: 'keep-right', announce: true };
      return { kind: turnKind(modifier), announce: modifier !== 'straight' };
    case 'new name':
    case 'notification': {
      // A renamed road is not a maneuver unless the road itself turns there.
      const kind = turnKind(modifier);
      return { kind, announce: kind !== 'straight' && kind !== 'slight-left' && kind !== 'slight-right' };
    }
    case 'continue': {
      const kind = turnKind(modifier);
      return { kind, announce: kind !== 'straight' };
    }
    default:
      // turn, end of road, roundabout turn and anything newer OSRM adds.
      return { kind: turnKind(modifier), announce: true };
  }
}

const streetOf = (step: RouteStep) => step.name || step.ref || '';

let routeCounter = 0;

/**
 * Builds the guided route. The polyline is the concatenation of the step
 * geometries, so every maneuver sits exactly on a vertex of the line it is
 * measured along.
 */
export function buildNavigationRoute(
  route: Pick<RouteResult, 'source' | 'steps' | 'distanceMeters' | 'durationSeconds'>,
  via: GeoPoint[] = [],
): NavigationRoute | undefined {
  const steps = route.steps;
  if (route.source !== 'osrm' || !steps?.length) return undefined;

  const id = `r${++routeCounter}`;
  const line: GeoPoint[] = [];
  const stepStartIndex: number[] = [];
  for (const step of steps) {
    const geometry = step.geometry.length ? step.geometry : [step.location];
    const last = line[line.length - 1];
    const first = geometry[0]!;
    const joins = last && last.latitude === first.latitude && last.longitude === first.longitude;
    stepStartIndex.push(joins ? line.length - 1 : line.length);
    line.push(...(joins ? geometry.slice(1) : geometry));
  }
  if (line.length < 2) return undefined;

  const cumulative = cumulativeDistances(line);
  const lastLeg = Math.max(...steps.map((step) => step.leg));
  const maneuvers: Maneuver[] = [];
  const spans: NavigationRoute['spans'] = [];

  steps.forEach((step, index) => {
    const along = cumulative[stepStartIndex[index]!]!;
    const next = stepStartIndex[index + 1];
    const end = next === undefined ? cumulative[cumulative.length - 1]! : cumulative[next]!;
    if (end > along) spans.push({ start: along, end, duration: step.durationSeconds });

    const { kind, announce } = classifyStep(step, step.leg === lastLeg);
    maneuvers.push({
      id: `${id}:${index}`,
      index: maneuvers.length,
      kind,
      along,
      location: step.location,
      street: streetOf(step),
      exit: kind === 'roundabout' ? step.exit : undefined,
      side: (kind === 'arrive' || kind === 'waypoint') && step.modifier && SIDE.has(step.modifier)
        ? (step.modifier as 'left' | 'right')
        : undefined,
      announce,
      leg: step.leg,
    });
  });

  return {
    id,
    line,
    cumulative,
    distance: cumulative[cumulative.length - 1]!,
    duration: route.durationSeconds,
    maneuvers,
    spans,
    // The requested point may sit inside a building; the road end is what the car can reach.
    destination: line[line.length - 1]!,
    via,
  };
}

/** The next maneuver the driver must act on, at or after `along`. */
export function nextManeuverIndex(route: NavigationRoute, along: number, passedTolerance = 8): number {
  const index = route.maneuvers.findIndex(
    (maneuver) => maneuver.kind !== 'depart' && maneuver.announce && maneuver.along > along - passedTolerance,
  );
  return index === -1 ? route.maneuvers.length - 1 : index;
}

/** Seconds of driving left from `along`, using the provider's per-step durations. */
export function remainingSeconds(route: NavigationRoute, along: number): number {
  let total = 0;
  for (const span of route.spans) {
    if (span.end <= along) continue;
    const length = span.end - span.start;
    const fraction = span.start >= along ? 1 : (span.end - along) / length;
    total += span.duration * fraction;
  }
  return total;
}
