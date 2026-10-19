import { describe, expect, it } from 'vitest';
import type { RouteStep } from '@/types';
import { buildNavigationRoute, classifyStep, nextManeuverIndex, remainingSeconds } from '@/utils/navigation/maneuvers';
import { fixtures, navRoute } from './helpers';

const step = (overrides: Partial<RouteStep>): RouteStep => ({
  type: 'turn',
  location: { latitude: 31.9, longitude: 35.2 },
  bearingBefore: 0,
  bearingAfter: 90,
  name: '',
  distanceMeters: 100,
  durationSeconds: 10,
  geometry: [],
  leg: 0,
  ...overrides,
});

describe('maneuvers from real OSRM steps', () => {
  it('turns the Al-Manara route into the turns OSRM describes, in order', () => {
    const route = navRoute(fixtures.manara);
    expect(route.maneuvers.map((m) => m.kind)).toEqual([
      'depart', 'roundabout', 'right', 'right', 'left', 'right', 'left', 'right', 'left', 'right', 'right', 'left', 'arrive',
    ]);
    const roundabout = route.maneuvers[1]!;
    expect(roundabout.exit).toBe(3);
    // Leaving the roundabout is already covered by "take the third exit".
    expect(route.maneuvers[2]!.announce).toBe(false);
    expect(route.maneuvers[12]!.side).toBe('left');
    expect(route.maneuvers[5]!.street).toBe('شارع القدس');
  });

  it('measures maneuvers along a continuous line whose length matches the provider', () => {
    const route = navRoute(fixtures.manara);
    expect(Math.abs(route.distance - fixtures.manara.distanceMeters) / fixtures.manara.distanceMeters).toBeLessThan(0.02);
    const alongs = route.maneuvers.map((m) => m.along);
    expect([...alongs].sort((a, b) => a - b)).toEqual(alongs);
    expect(alongs[alongs.length - 1]).toBeCloseTo(route.distance, 0);
  });

  it('treats a renamed road as silent but a continue-with-turn as a real maneuver', () => {
    const route = navRoute(fixtures.second);
    const kinds = route.maneuvers.map((m) => `${m.kind}:${m.announce}`);
    expect(kinds).toEqual([
      'depart:false', 'left:true', 'right:true', 'right:true', 'straight:false', 'right:true', 'left:true', 'arrive:true',
    ]);
  });

  it('refuses to build guidance from a straight-line fallback or a route without steps', () => {
    expect(buildNavigationRoute({ ...fixtures.manara, source: 'straight-line' })).toBeUndefined();
    expect(buildNavigationRoute({ ...fixtures.manara, steps: undefined })).toBeUndefined();
  });

  it('classifies every turn severity and U-turns', () => {
    expect(classifyStep(step({ modifier: 'left' }), true).kind).toBe('left');
    expect(classifyStep(step({ modifier: 'right' }), true).kind).toBe('right');
    expect(classifyStep(step({ modifier: 'slight left' }), true).kind).toBe('slight-left');
    expect(classifyStep(step({ modifier: 'sharp right' }), true).kind).toBe('sharp-right');
    expect(classifyStep(step({ modifier: 'uturn' }), true).kind).toBe('uturn');
    expect(classifyStep(step({ modifier: 'straight' }), true)).toEqual({ kind: 'straight', announce: true });
    expect(classifyStep(step({ type: 'fork', modifier: 'slight right' }), true).kind).toBe('keep-right');
    expect(classifyStep(step({ type: 'arrive' }), false).kind).toBe('waypoint');
  });

  it('derives the direction from the step bearings when OSRM gives no modifier', () => {
    expect(classifyStep(step({ bearingBefore: 0, bearingAfter: 90 }), true).kind).toBe('right');
    expect(classifyStep(step({ bearingBefore: 90, bearingAfter: 0 }), true).kind).toBe('left');
    expect(classifyStep(step({ bearingBefore: 10, bearingAfter: 15 }), true).kind).toBe('straight');
    expect(classifyStep(step({ bearingBefore: 0, bearingAfter: 180 }), true).kind).toBe('uturn');
    expect(classifyStep(step({ bearingBefore: 350, bearingAfter: 20 }), true).kind).toBe('slight-right');
  });

  it('finds the next actionable maneuver and the remaining time', () => {
    const route = navRoute(fixtures.manara);
    expect(nextManeuverIndex(route, 0)).toBe(1);
    expect(nextManeuverIndex(route, route.maneuvers[3]!.along + 20)).toBe(4);
    expect(remainingSeconds(route, 0)).toBeCloseTo(fixtures.manara.durationSeconds, 0);
    expect(remainingSeconds(route, route.distance)).toBe(0);
  });
});
