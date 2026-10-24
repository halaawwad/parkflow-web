import type { GeoPoint, TravelMode } from '@/types';
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
  /** Driving or walking; fixed for the session and used to pick the thresholds below. */
  profile: TravelMode;
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
  /**
   * How far the user stood from the current route when it was planned. Routers
   * start at the nearest mapped way, which can be well away from someone inside
   * a building block or a car park; that gap is not being off the route, so it is
   * tolerated until the user has been on the route once.
   */
  startGap: number;
  /** The user has been within the normal off-route band of the current route. */
  joinedRoute: boolean;
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
  | { type: 'start'; now: number; profile?: TravelMode }
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

/** Driving thresholds. */
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

export type NavTuning = { readonly [K in keyof typeof NAV]: number };

/**
 * Walking thresholds. Pedestrians move at ~1.4 m/s, so movement-based checks
 * need lower speeds and more patience, and footpath routes are tighter: a
 * smaller off-route band and arrival radius, but more fixes before a reroute
 * because a person stepping around an obstacle is not lost.
 */
export const WALK_NAV: NavTuning = {
  ...NAV,
  weakAccuracy: 35,
  offRouteMeters: 25,
  offRouteMaxMeters: 50,
  offRouteFixes: 4,
  offRouteMs: 8_000,
  wrongWayMinSpeed: 0.6,
  wrongWayFixes: 4,
  wrongWayMs: 10_000,
  arriveMeters: 15,
  headingMinSpeed: 0.6,
  headingMinMove: 5,
};

export const tuningFor = (profile: TravelMode): NavTuning => (profile === 'walking' ? WALK_NAV : NAV);

export const initialNavigationState: NavigationState = {
  status: 'idle',
  profile: 'driving',
  signal: 'good',
  speed: 0,
  offRouteCount: 0,
  startGap: 0,
  joinedRoute: true,
  wrongWayCount: 0,
  wrongWay: false,
  routeFailures: 0,
  offline: false,
  paused: false,
  epoch: 0,
};

/** Slack on top of the start gap, for GPS noise while walking to the route. */
const START_GAP_MARGIN = 15;

const isGood = (fix: LocationFix, tuning: NavTuning) => fix.accuracy === null || fix.accuracy <= tuning.weakAccuracy;

/** Off-route threshold widens with reported inaccuracy so drift alone cannot trigger a reroute. */
export const offRouteThreshold = (accuracy: number | null, tuning: NavTuning = NAV) =>
  Math.min(tuning.offRouteMaxMeters, Math.max(tuning.offRouteMeters, (accuracy ?? 0) * 1.5));

function headingOf(fix: LocationFix, previous: LocationFix | undefined, current: number | undefined, tuning: NavTuning): number | undefined {
  if (fix.heading !== null && fix.heading >= 0 && (fix.speed ?? 0) >= tuning.headingMinSpeed) return fix.heading;
  if (previous && distanceMeters(previous.point, fix.point) >= tuning.headingMinMove) {
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
  const tuning = tuningFor(state.profile);

  if (!isGood(fix, tuning)) {
    const weakSince = state.weakSince ?? now;
    return {
      ...base,
      weakSince,
      signal: now - weakSince >= tuning.weakGraceMs || state.signal !== 'good' ? 'weak' : state.signal,
    };
  }

  const heading = headingOf(fix, state.lastGoodFix, state.heading, tuning);
  // Measured on this fix — from the platform's course while moving, or from real movement
  // since the last good fix. A heading carried over from earlier says nothing about now.
  const headingFresh =
    (fix.heading !== null && fix.heading >= 0 && (fix.speed ?? 0) >= tuning.headingMinSpeed) ||
    (state.lastGoodFix !== undefined && distanceMeters(state.lastGoodFix.point, fix.point) >= tuning.headingMinMove);
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
  const band = offRouteThreshold(fix.accuracy, tuning);
  const threshold = state.joinedRoute ? band : Math.max(band, state.startGap + START_GAP_MARGIN);
  const progress = computeProgress(next.route, fix.point, state.progress?.along, speed * elapsed * 2 + 100, threshold);

  // Arrival: close to the destination by road and in a straight line.
  const arriveRadius = Math.max(tuning.arriveMeters, Math.min(fix.accuracy ?? 0, tuning.weakAccuracy));
  if (
    progress.directToDestination <= arriveRadius &&
    (progress.remainingMeters <= arriveRadius * 2 || progress.offRoute <= threshold)
  ) {
    return { ...next, progress, status: 'arrived', arrivedAt: now, rerouteReason: undefined, wrongWay: false };
  }

  const off = progress.offRoute > threshold;
  const offRouteCount = off ? state.offRouteCount + 1 : 0;
  const offRouteSince = off ? state.offRouteSince ?? now : undefined;
  const offRouteConfirmed = off && offRouteCount >= tuning.offRouteFixes && now - offRouteSince! >= tuning.offRouteMs;

  const against =
    !off &&
    headingFresh &&
    heading !== undefined &&
    speed >= tuning.wrongWayMinSpeed &&
    bearingDifference(heading, progress.routeBearing) >= tuning.wrongWayDegrees;
  const wrongWayCount = against ? state.wrongWayCount + 1 : 0;
  const wrongWaySince = against ? state.wrongWaySince ?? now : undefined;
  const wrongWay = against && wrongWayCount >= tuning.wrongWayFixes && now - wrongWaySince! >= tuning.wrongWayMs;

  return {
    ...next,
    joinedRoute: state.joinedRoute || progress.offRoute <= band,
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
      return { ...initialNavigationState, status: 'locating', profile: event.profile ?? 'driving', lastFixAt: event.now };
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
      const band = fix ? offRouteThreshold(fix.accuracy, tuningFor(state.profile)) : 0;
      const progress = fix ? computeProgress(event.route, fix.point, undefined, 0, Infinity) : undefined;
      const startGap = progress?.offRoute ?? 0;
      return {
        ...state,
        status: 'active',
        route: event.route,
        progress,
        startGap,
        joinedRoute: startGap <= band,
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
  const reached = route.maneuvers.filter((m) => m.kind === 'waypoint' && m.along <= along + tuningFor(state.profile).arriveMeters).length;
  return route.via.slice(reached);
}

/** Time away from the app after which guidance re-announces the current instruction. */
export const REANNOUNCE_AFTER_MS = 10_000;

/**
 * Whether coming back to the app should resume guidance afresh (re-announce,
 * restart drift counters). A short blip — a call banner, a quick app switch —
 * changes nothing, and a pause the user chose is never undone by returning.
 */
export const resumeOnReturn = (state: NavigationState, awayMs: number) =>
  state.status === 'active' && !state.paused && awayMs >= REANNOUNCE_AFTER_MS;

/** Typical walking pace, m/s, used before the walker's own pace is known. */
export const WALKING_PACE = 1.35;

/**
 * Time left. Driving trusts the provider's per-step times (they know road
 * speeds). Walking blends the provider's estimate with the person's measured
 * pace once they are clearly moving, so a slow or brisk walker sees their own
 * ETA; standing at a crossing does not stretch it, because the measured pace is
 * only used while moving.
 */
export function estimatedRemainingSeconds(state: NavigationState): number | undefined {
  const progress = state.progress;
  if (!progress) return undefined;
  if (state.profile !== 'walking' || progress.remainingMeters <= 0) return progress.remainingSeconds;
  const providerPace = progress.remainingSeconds > 0 ? progress.remainingMeters / progress.remainingSeconds : WALKING_PACE;
  const moving = state.speed >= 0.5 && state.speed <= 3 && state.signal === 'good' && !state.paused;
  const pace = moving ? 0.6 * state.speed + 0.4 * providerPace : providerPace;
  return progress.remainingMeters / Math.max(0.4, pace);
}
