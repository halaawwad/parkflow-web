import type { GeoPoint } from '@/types';
import { distanceMeters } from '@/utils/geo';

/**
 * Polyline maths for turn-by-turn guidance. Everything works in a local
 * equirectangular frame around the point being projected, which is accurate to
 * well under a metre at city scale and keeps snapping cheap enough to run on
 * every GPS fix.
 */

const METERS_PER_DEGREE = 111_320;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Initial great-circle bearing from a to b, 0–360° clockwise from north. */
export function bearingDegrees(a: GeoPoint, b: GeoPoint): number {
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Smallest absolute angle between two bearings, 0–180°. */
export function bearingDifference(a: number, b: number): number {
  const diff = Math.abs((((a - b) % 360) + 360) % 360);
  return diff > 180 ? 360 - diff : diff;
}

/** Cumulative distance along the line at every vertex (first entry is 0). */
export function cumulativeDistances(line: GeoPoint[]): number[] {
  const out = [0];
  for (let i = 1; i < line.length; i++) out.push(out[i - 1]! + distanceMeters(line[i - 1]!, line[i]!));
  return out;
}

export interface Projection {
  /** Closest point on the line. */
  point: GeoPoint;
  /** Distance from the query point to the line, metres. */
  distance: number;
  /** Distance along the line to the projected point, metres. */
  along: number;
  /** Index of the segment's first vertex. */
  segment: number;
}

function projectOnSegment(point: GeoPoint, a: GeoPoint, b: GeoPoint) {
  const k = Math.cos(toRad(point.latitude));
  const ax = (a.longitude - point.longitude) * k;
  const ay = a.latitude - point.latitude;
  const dx = (b.longitude - point.longitude) * k - ax;
  const dy = b.latitude - point.latitude - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq)) : 0;
  const px = ax + t * dx;
  const py = ay + t * dy;
  return {
    t,
    distance: Math.sqrt(px * px + py * py) * METERS_PER_DEGREE,
    point: {
      latitude: a.latitude + (b.latitude - a.latitude) * t,
      longitude: a.longitude + (b.longitude - a.longitude) * t,
    },
  };
}

/**
 * Projects a point onto the line, considering only the stretch between
 * `fromAlong` and `toAlong`. Restricting the window is what keeps a car on a
 * road the route uses twice (out and back) snapped to the right pass.
 */
export function projectOntoLine(
  point: GeoPoint,
  line: GeoPoint[],
  cumulative: number[],
  fromAlong = 0,
  toAlong = Infinity,
): Projection | undefined {
  let best: Projection | undefined;
  for (let i = 1; i < line.length; i++) {
    const start = cumulative[i - 1]!;
    const end = cumulative[i]!;
    if (end < fromAlong || start > toAlong) continue;
    const hit = projectOnSegment(point, line[i - 1]!, line[i]!);
    if (!best || hit.distance < best.distance) {
      best = { point: hit.point, distance: hit.distance, along: start + (end - start) * hit.t, segment: i - 1 };
    }
  }
  if (!best && line.length === 1) {
    return { point: line[0]!, distance: distanceMeters(point, line[0]!), along: 0, segment: 0 };
  }
  return best;
}

/** Point at a given distance along the line (clamped to its ends). */
export function pointAtDistance(line: GeoPoint[], cumulative: number[], along: number): GeoPoint {
  if (along <= 0 || line.length < 2) return line[0]!;
  const total = cumulative[cumulative.length - 1]!;
  if (along >= total) return line[line.length - 1]!;
  let i = 1;
  while (i < cumulative.length && cumulative[i]! < along) i++;
  const start = cumulative[i - 1]!;
  const span = cumulative[i]! - start;
  const t = span ? (along - start) / span : 0;
  const a = line[i - 1]!;
  const b = line[i]!;
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * t,
    longitude: a.longitude + (b.longitude - a.longitude) * t,
  };
}

/** Bearing of the line at a distance along it. */
export function bearingAtDistance(line: GeoPoint[], cumulative: number[], along: number): number {
  if (line.length < 2) return 0;
  let i = 1;
  while (i < cumulative.length - 1 && cumulative[i]! <= along) i++;
  return bearingDegrees(line[i - 1]!, line[i]!);
}

/**
 * Splits the line at `along` into the part already driven and the part still
 * ahead. Both halves share the split point so the two polylines meet cleanly.
 */
export function splitLine(
  line: GeoPoint[],
  cumulative: number[],
  along: number,
): { traveled: GeoPoint[]; remaining: GeoPoint[] } {
  if (line.length < 2) return { traveled: [], remaining: line };
  const split = pointAtDistance(line, cumulative, along);
  let i = 1;
  while (i < cumulative.length && cumulative[i]! <= along) i++;
  return {
    traveled: [...line.slice(0, i), split],
    remaining: [split, ...line.slice(i)],
  };
}
