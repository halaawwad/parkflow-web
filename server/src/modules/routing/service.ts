
import type { GeoPoint } from '../../utils/geo';
import { env } from '../../config/env';
import { checkpoints } from '../roads/service';
type CheckpointState = Awaited<ReturnType<typeof checkpoints>>[number];
interface RouteClosure {checkpointId:string;nameAr:string;nameEn:string;status:'closed'|'congested'}
import { distanceMeters, distanceToPolyline } from '../../utils/geo';
import { enrichTraffic } from './traffic';


/**
 * Checkpoint-aware routing, ported from Wusool: ask the public OSRM server for
 * alternatives, then score each one by travel time plus a penalty for every
 * live closure it passes. The rejected alternatives come back too, so the map
 * can show the road the driver did NOT take and name the closure that ruled it
 * out. Offline, it degrades to a straight line rather than failing.
 *
 * Walking uses a separate OSRM server running the foot profile, so routes follow
 * footpaths and ignore one-way streets. The response format is identical, which
 * lets the same maneuver engine guide both modes.
 */

export type TravelProfile = 'driving' | 'walking';

const PROVIDERS: Record<TravelProfile, { base: string; profile: string }> = {
  driving: { base: env.OSRM_BASE_URL, profile: 'driving' },
  walking: { base: env.OSRM_FOOT_BASE_URL, profile: env.OSRM_FOOT_PROFILE },
};
const HEADERS = { 'User-Agent': env.ROUTING_USER_AGENT, Accept: 'application/json' };
const NEAR_METERS = 250;
const PENALTY_SECONDS = { closed: 3600, congested: 900 } as const;
const TIMEOUT_MS = 6000;
/** Rough speeds for the offline estimate, m/s: urban driving (~30 km/h) and walking (~4.8 km/h). */
const FALLBACK_SPEED: Record<TravelProfile, number> = { driving: 8.3, walking: 1.35 };

/** One OSRM maneuver, kept as the router produced it so the client can build real turn guidance. */
export interface RouteStep {
  type: string;
  modifier?: string;
  exit?: number;
  location: GeoPoint;
  bearingBefore: number;
  bearingAfter: number;
  name: string;
  ref?: string;
  distanceMeters: number;
  durationSeconds: number;
  geometry: GeoPoint[];
  /** Leg this step belongs to (0 for a direct route; one leg per stop otherwise). */
  leg: number;
}

interface OsrmRoute {
  coordinates: GeoPoint[];
  distance: number;
  duration: number;
  steps: RouteStep[];
}

type LngLat = [number, number];

interface OsrmStep {
  distance: number;
  duration: number;
  name?: string;
  ref?: string;
  geometry?: { coordinates: LngLat[] };
  maneuver: { type: string; modifier?: string; exit?: number; location: LngLat; bearing_before?: number; bearing_after?: number };
}

interface OsrmResponse {
  code?: string;
  routes?: {
    distance: number;
    duration: number;
    geometry: { coordinates: LngLat[] };
    legs?: { steps?: OsrmStep[] }[];
  }[];
}

interface OsrmNearestResponse {
  code?: string;
  waypoints?: { location: [number, number] }[];
}

interface RouteOptions {
  /** Driving (default) or walking. */
  profile?: TravelProfile;
  mode?: 'checkpoint-aware' | 'fastest';
  snapDestination?: boolean;
  maxAlternatives?: number;
  /** Include OSRM turn-by-turn steps (navigation). */
  steps?: boolean;
  /** Direction of travel at the origin, degrees from north. Stops a reroute starting against traffic. */
  originBearing?: number;
  /** Intermediate stops visited in order before the destination. */
  via?: GeoPoint[];
}

/** Geometry is cached per origin/destination; scoring is redone on every call. */
const cache = new Map<string, {routes:OsrmRoute[];expires:number}>();

const toPoint = ([longitude, latitude]: LngLat): GeoPoint => ({ latitude, longitude });

const keyOf = (profile: TravelProfile, points: GeoPoint[], bearing?: number) =>
  profile + ':' + points.flatMap((p) => [p.latitude, p.longitude]).map((n) => n.toFixed(5)).join(',') +
  (bearing === undefined ? '' : `@${Math.round(bearing)}`);

/** Bearing tolerance OSRM may deviate from the requested heading at the origin. */
const BEARING_RANGE = 60;

function stepsOf(legs: NonNullable<OsrmResponse['routes']>[number]['legs']): RouteStep[] {
  return (legs ?? []).flatMap((leg, legIndex) =>
    (leg.steps ?? []).map((step) => ({
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
      geometry: (step.geometry?.coordinates ?? []).map(toPoint),
      leg: legIndex,
    })),
  );
}

async function fetchRoutes(profile: TravelProfile, points: GeoPoint[], bearing?: number): Promise<OsrmRoute[]> {
  const key = keyOf(profile, points, bearing);
  const hit = cache.get(key);
  if (hit && hit.expires>Date.now()) return hit.routes;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const coordinates = points.map((p) => `${p.longitude},${p.latitude}`).join(';');
    // OSRM only returns alternatives for two-point routes.
    const bearings = bearing === undefined
      ? ''
      : `&bearings=${Math.round(((bearing % 360) + 360) % 360)},${BEARING_RANGE}${';'.repeat(points.length - 1)}`;
    const provider = PROVIDERS[profile];
    const url =
      `${provider.base}/route/v1/${provider.profile}/${coordinates}` +
      `?alternatives=${points.length === 2}&overview=full&geometries=geojson&steps=true${bearings}`;
    const response = await fetch(url, { signal: controller.signal, headers: HEADERS });
    const json = (await response.json()) as OsrmResponse;
    if (json.code !== 'Ok' || !json.routes?.length) return [];

    const routes = json.routes.map((route) => ({
      distance: route.distance,
      duration: route.duration,
      coordinates: route.geometry.coordinates.map(toPoint),
      steps: stepsOf(route.legs),
    }));
    if(cache.size>500)cache.clear();
    cache.set(key, {routes,expires:Date.now()+60000});
    return routes;
  } catch {
    // Offline or OSRM down — the caller falls back to a straight line.
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** OSRM's driving profile returns the closest road point reachable by a car. */
async function snapToDrivableRoad(point: GeoPoint): Promise<GeoPoint> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(
      `${PROVIDERS.driving.base}/nearest/v1/driving/${point.longitude},${point.latitude}?number=1`,
      { signal: controller.signal, headers: HEADERS },
    );
    const json = (await response.json()) as OsrmNearestResponse;
    const snapped = json.code === 'Ok' ? json.waypoints?.[0]?.location : undefined;
    return snapped ? { latitude: snapped[1], longitude: snapped[0] } : point;
  } catch {
    return point;
  } finally {
    clearTimeout(timer);
  }
}

function closuresNear(line: GeoPoint[], states: CheckpointState[]): RouteClosure[] {
  return states
    .filter((s) => s.status !== 'open' && distanceToPolyline(s.location, line) <= NEAR_METERS)
    .map((s) => ({
      checkpointId: s.id,
      nameAr: s.nameAr,
      nameEn: s.nameEn,
      status: s.status as RouteClosure['status'],
    }));
}

const penaltyOf = (closures: RouteClosure[]) =>
  closures.reduce((total, c) => total + PENALTY_SECONDS[c.status], 0);

const worstOf = (closures: RouteClosure[]) =>
  closures.find((c) => c.status === 'closed') ?? closures[0];

export const routingService = {
  async getRoute(from: GeoPoint, to: GeoPoint, options: RouteOptions = {}) {
    const profile = options.profile ?? 'driving';
    // A pedestrian walks to the place itself; only a car needs the nearest drivable road.
    const destination = options.snapDestination && profile === 'driving' ? await snapToDrivableRoad(to) : to;
    const via = options.via ?? [];
    // A walker can turn on the spot, so a heading hint only matters when driving.
    const bearing = profile === 'driving' ? options.originBearing : undefined;
    const fetched = await fetchRoutes(profile, [from, ...via, destination], bearing);
    // A heading hint can make OSRM fail when the car sits on an unmapped lot; retry without it.
    const routesPromise = fetched.length || bearing === undefined
      ? Promise.resolve(fetched)
      : fetchRoutes(profile, [from, ...via, destination]);
    const [routes, states] = await Promise.all([
      routesPromise,
      options.mode === 'fastest' ? Promise.resolve([] as CheckpointState[]) : checkpoints(),
    ]);

    if (!routes.length) {
      const line = [from, ...via, destination];
      const distance = line.slice(1).reduce((sum, point, index) => sum + distanceMeters(line[index]!, point), 0);
      const closures = closuresNear(line, states);
      return {
        coordinates: line,
        distanceMeters: Math.round(distance),
        durationSeconds: Math.round(distance / FALLBACK_SPEED[profile]),
        penaltySeconds: penaltyOf(closures),
        closuresOnRoute: closures,
        rejected: [],
        alternatives: [],
        source: 'straight-line',
        profile,
        snappedDestination: destination,
      };
    }

    const scored = routes
      .map((route) => {
        const closures = closuresNear(route.coordinates, states);
        return { ...route, closures, penalty: penaltyOf(closures) };
      })
      .sort((a, b) =>
        options.mode === 'fastest'
          ? a.duration - b.duration
          : a.duration + a.penalty - (b.duration + b.penalty),
      );

    const best = scored[0]!;
    const alternatives = scored.slice(1, 1 + (options.maxAlternatives ?? scored.length));
    // Road traffic says nothing about a footpath.
    const traffic = via.length || profile === 'walking' ? undefined : await enrichTraffic(from, destination);
    return {
      coordinates: best.coordinates,
      distanceMeters: Math.round(best.distance),
      durationSeconds: Math.round(best.duration),
      ...(options.steps ? { steps: best.steps } : {}),
      ...(traffic ?? {}),
      penaltySeconds: best.penalty,
      closuresOnRoute: best.closures,
      rejected: alternatives.map((route) => ({
        coordinates: route.coordinates,
        blockedBy: worstOf(route.closures),
      })),
      alternatives: alternatives.map((route, index) => ({
        id: `alternative-${index + 1}`,
        coordinates: route.coordinates,
        distanceMeters: Math.round(route.distance),
        durationSeconds: Math.round(route.duration),
        ...(options.steps ? { steps: route.steps } : {}),
      })),
      source: 'osrm',
      profile,
      snappedDestination: destination,
    };
  },
};
