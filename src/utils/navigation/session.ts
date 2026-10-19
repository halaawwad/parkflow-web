import type { GeoPoint } from '@/types';
import { distanceMeters } from '@/utils/geo';
import { bearingDegrees, bearingDifference } from './geometry';
import type { NavigationRoute } from './maneuvers';
import { computeProgress, type RouteProgress } from './progress';

/**
 * Turn-by-turn session state machine. Pure: the hook feeds it GPS fixes, timer
 * ticks and routing results, and reads back what to show and whether a new
 * route is due. Keeping the decisions here (rather than in effects) is what
 * makes rerouting, signal loss and arrival testable without a device.
 */

export interface LocationFix {
  point: GeoPoint;
  /** Horizontal accuracy radius in metres (null when the platform does not say). */
  accuracy: number | null;
  /** Course over ground in degrees, when the platform provides one. */
  heading: number | null;
  /** Speed in m/s, when the platform provides one. */
  speed: number | null;
  timestamp: number;
}

export type NavigationStatus = 'idle' | 'locating' | 'routing' | 'active' | 'rerouting' | 'arrived' | 'error';
export type SignalState = 'good' | 'weak' | 'lost';
export type NavigationErrorCode = 'permission-denied' | 'location-unavailable' | 'routing-failed' | 'no-guidance';
export type RerouteReason = 'off-route' | 'wrong-way';

export interface NavigationState {
  status: NavigationStatus;
  route?: NavigationRoute;
  progress?: RouteProgress;
  signal: SignalState;
  lastFix?: LocationFix;
  /** Last fix accurate enough to guide with. */
  lastGoodFix?: LocationFix;
  lastFixAt?: number;
  weakSince?: number;
  heading?: number;
  speed: number;
  offRouteSince?: number;
  offRouteCount: number;
  wrongWaySince?: number;
  wrongWayCount: number;
  wrongWay: boolean;
  rerouteReason?: RerouteReason;
  lastRouteRequestAt?: number;
  routeFailures: number;
  /** The last route request failed for lack of connectivity; guidance continues on the old route. */
  offline: boolean;
  paused: boolean;
  error?: NavigationErrorCode;
  /** Increments every time a new route is installed. */
  epoch: number;
  arrivedAt?: number;
}

export type NavigationEvent =
  | { type: 'start'; now: number }
  | { type: 'stop' }
  | { type: 'pause' }
  | { type: 'resume'; now: number }
  | { type: 'permission-denied' }
  | { type: 'location-unavailable' }
  | { type: 'fix'; fix: LocationFix; now: number }
  | { type: 'tick'; now: number }
  | { type: 'route-requested'; now: number }
  | { type: 'route-ready'; route: NavigationRoute; now: number }
  | { type: 'route-failed'; reason: 'offline' | 'no-guidance' | 'error'; now: number };

export const NAV = {
  /** Fixes less accurate than this never move guidance. */
  weakAccuracy: 40,
  /** Weak-only fixes for this long suspend guidance. */
  weakGraceMs: 8_000,
  /** No fix at all for this long is a lost signal. */
  lostAfterMs: 15_000,
  /** Base distance from the route that counts as off it. */
  offRouteMeters: 30,
  offRouteMaxMeters: 60,
  /** Consecutive off-route fixes and duration before rerouting (rejects GPS drift). */
  offRouteFixes: 3,
  offRouteMs: 5_000,
  /** Moving against the route this much, for this long, is the wrong way. */
  wrongWayDegrees: 135,
  wrongWayMinSpeed: 2,
  wrongWayFixes: 3,
  wrongWayMs: 6_000,
  /** Never ask the router again sooner than this. */
  rerouteIntervalMs: 10_000,
  maxBackoffMs: 60_000,
  /** Arrival radius. */
  arriveMeters: 25,
  /** Heading is trusted from the platform above this speed, else derived from movement. */
  headingMinSpeed: 1.5,
  headingMinMove: 8,
} as const;

export const initialNavigationState: NavigationState = {
  status: 'idle',
  signal: 'good',
  speed: 0,
  offRouteCount: 0,
  wrongWayCount: 0,
  wrongWay: false,
  routeFailures: 0,
  offline: false,
  paused: false,
  epoch: 0,
};

const isGood = (fix: LocationFix) => fix.accuracy === null || fix.accuracy <= NAV.weakAccuracy;

/** Off-route threshold widens with reported inaccuracy so drift alone cannot trigger a reroute. */
export const offRouteThreshold = (accuracy: number | null) =>
  Math.min(NAV.offRouteMaxMeters, Math.max(NAV.offRouteMeters, (accuracy ?? 0) * 1.5));

function headingOf(fix: LocationFix, previous: LocationFix | undefined, current: number | undefined): number | undefined {
  if (fix.heading !== null && fix.heading >= 0 && (fix.speed ?? 0) >= NAV.headingMinSpeed) return fix.heading;
  if (previous && distanceMeters(previous.point, fix.point) >= NAV.headingMinMove) {
    return bearingDegrees(previous.point, fix.point);
  }
  return current;
}

function speedOf(fix: LocationFix, previous: LocationFix | undefined, current: number): number {
  if (fix.speed !== null && fix.speed >= 0) return current * 0.4 + fix.speed * 0.6;
  if (!previous) return current;
  const seconds = (fix.timestamp - previous.timestamp) / 1000;
  if (seconds <= 0) return current;
  return current * 0.5 + (distanceMeters(previous.point, fix.point) / seconds) * 0.5;
}

/** Guidance from the current progress is trustworthy (status active and signal good). */
export const guidanceReliable = (state: NavigationState) =>
  state.status === 'active' && state.signal === 'good' && !state.paused && Boolean(state.progress);

/** Whether the hook should ask the router for a route now. */
export function routeRequestDue(state: NavigationState, now: number): boolean {
  if (state.paused || !state.lastGoodFix) return false;
  if (state.status === 'locating') return true;
  if (state.status !== 'active' || !state.rerouteReason) return false;
  const backoff = Math.min(NAV.maxBackoffMs, NAV.rerouteIntervalMs * Math.max(1, state.routeFailures));
  return state.lastRouteRequestAt === undefined || now - state.lastRouteRequestAt >= backoff;
}

function applyFix(state: NavigationState, fix: LocationFix, now: number): NavigationState {
  const base: NavigationState = { ...state, lastFix: fix, lastFixAt: now };

  if (!isGood(fix)) {
    const weakSince = state.weakSince ?? now;
    return {
      ...base,
      weakSince,
      signal: now - weakSince >= NAV.weakGraceMs || state.signal !== 'good' ? 'weak' : state.signal,
    };
  }

  const heading = headingOf(fix, state.lastGoodFix, state.heading);
  const speed = speedOf(fix, state.lastGoodFix, state.speed);
  const next: NavigationState = {
    ...base,
    lastGoodFix: fix,
    weakSince: undefined,
    signal: 'good',
    heading,
    speed,
  };

  if (!next.route || (next.status !== 'active' && next.status !== 'rerouting')) return next;

  const elapsed = state.lastGoodFix ? Math.max(1, (fix.timestamp - state.lastGoodFix.timestamp) / 1000) : 1;
  const threshold = offRouteThreshold(fix.accuracy);
  const progress = computeProgress(next.route, fix.point, state.progress?.along, speed * elapsed * 2 + 100, threshold);

  // Arrival: close to the destination by road and in a straight line.
  const arriveRadius = Math.max(NAV.arriveMeters, Math.min(fix.accuracy ?? 0, NAV.weakAccuracy));
  if (
    progress.directToDestination <= arriveRadius &&
    (progress.remainingMeters <= arriveRadius * 2 || progress.offRoute <= threshold)
  ) {
    return { ...next, progress, status: 'arrived', arrivedAt: now, rerouteReason: undefined, wrongWay: false };
  }

  const off = progress.offRoute > threshold;
  const offRouteCount = off ? state.offRouteCount + 1 : 0;
  const offRouteSince = off ? state.offRouteSince ?? now : undefined;
  const offRouteConfirmed = off && offRouteCount >= NAV.offRouteFixes && now - offRouteSince! >= NAV.offRouteMs;

  const against =
    !off &&
    heading !== undefined &&
    speed >= NAV.wrongWayMinSpeed &&
    bearingDifference(heading, progress.routeBearing) >= NAV.wrongWayDegrees;
  const wrongWayCount = against ? state.wrongWayCount + 1 : 0;
  const wrongWaySince = against ? state.wrongWaySince ?? now : undefined;
  const wrongWay = against && wrongWayCount >= NAV.wrongWayFixes && now - wrongWaySince! >= NAV.wrongWayMs;

  return {
    ...next,
    // While off the route the old progress (and its instructions) are kept, never advanced.
    progress: off ? { ...(state.progress ?? progress), offRoute: progress.offRoute } : progress,
    offRouteCount,
    offRouteSince,
    wrongWayCount,
    wrongWaySince,
    wrongWay,
    rerouteReason: offRouteConfirmed ? 'off-route' : wrongWay ? 'wrong-way' : state.status === 'rerouting' ? state.rerouteReason : undefined,
  };
}

export function navigationReducer(state: NavigationState, event: NavigationEvent): NavigationState {
  switch (event.type) {
    case 'start':
      return { ...initialNavigationState, status: 'locating', lastFixAt: event.now };
    case 'stop':
      return initialNavigationState;
    case 'permission-denied':
      return { ...state, status: 'error', error: 'permission-denied' };
    case 'location-unavailable':
      return state.route ? { ...state, signal: 'lost' } : { ...state, status: 'error', error: 'location-unavailable' };
    case 'pause':
      return state.status === 'idle' || state.status === 'arrived' || state.status === 'error' ? state : { ...state, paused: true };
    case 'resume':
      // Counters restart: whatever happened while paused is not evidence of drift.
      return {
        ...state,
        paused: false,
        lastFixAt: event.now,
        offRouteCount: 0,
        offRouteSince: undefined,
        wrongWayCount: 0,
        wrongWaySince: undefined,
      };
    case 'fix':
      if (state.status === 'idle' || state.status === 'arrived' || state.status === 'error' || state.paused) return state;
      return applyFix(state, event.fix, event.now);
    case 'tick': {
      if (state.status === 'idle' || state.status === 'arrived' || state.status === 'error' || state.paused) return state;
      if (state.lastFixAt !== undefined && event.now - state.lastFixAt >= NAV.lostAfterMs) {
        return state.signal === 'lost' ? state : { ...state, signal: 'lost' };
      }
      if (state.weakSince !== undefined && event.now - state.weakSince >= NAV.weakGraceMs && state.signal === 'good') {
        return { ...state, signal: 'weak' };
      }
      return state;
    }
    case 'route-requested':
      return {
        ...state,
        status: state.status === 'locating' ? 'routing' : state.status === 'active' ? 'rerouting' : state.status,
        lastRouteRequestAt: event.now,
      };
    case 'route-ready': {
      const fix = state.lastGoodFix;
      const progress = fix
        ? computeProgress(event.route, fix.point, undefined, 0, offRouteThreshold(fix.accuracy))
        : undefined;
      return {
        ...state,
        status: 'active',
        route: event.route,
        progress,
        epoch: state.epoch + 1,
        offRouteCount: 0,
        offRouteSince: undefined,
        wrongWayCount: 0,
        wrongWaySince: undefined,
        wrongWay: false,
        rerouteReason: undefined,
        routeFailures: 0,
        offline: false,
        error: undefined,
      };
    }
    case 'route-failed':
      if (state.route) {
        // Keep guiding on the previous route, flagged, and retry with backoff.
        return {
          ...state,
          status: 'active',
          offline: event.reason === 'offline',
          routeFailures: state.routeFailures + 1,
          lastRouteRequestAt: event.now,
        };
      }
      return { ...state, status: 'error', error: event.reason === 'no-guidance' ? 'no-guidance' : 'routing-failed' };
    default:
      return state;
  }
}

/** Stops the route still has to visit, given how far along it the driver is. */
export function remainingVia(state: NavigationState): GeoPoint[] {
  const route = state.route;
  if (!route) return [];
  const along = state.progress?.along ?? 0;
  const reached = route.maneuvers.filter((m) => m.kind === 'waypoint' && m.along <= along + NAV.arriveMeters).length;
  return route.via.slice(reached);
}
