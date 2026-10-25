import { describe, expect, it } from 'vitest';
import {
  estimatedRemainingSeconds,
  guidanceReliable,
  initialNavigationState,
  NAV,
  navigationReducer,
  offRouteThreshold,
  resumeOnReturn,
  routeRequestDue,
  WALK_NAV,
  type NavigationEvent,
  type NavigationState,
} from '@/utils/navigation/session';
import { announcementDistances, markSpoken, planAnnouncement, type Announcement } from '@/utils/navigation/voiceScheduler';
import { continuePhrase, maneuverInstruction, roundSpokenDistance, systemPhrases } from '@/utils/navigation/instructions';
import { bearingAtDistance, pointAtDistance } from '@/utils/navigation/geometry';
import type { NavigationRoute } from '@/utils/navigation/maneuvers';
import type { TravelMode } from '@/types';
import { distanceMeters } from '@/utils/geo';
import { fixAt, fixtures, navRoute, offset } from './helpers';

/**
 * Walking navigation, exercised on real pedestrian routes from the OSRM foot
 * profile. Every "walk" here is a SIMULATED GPS track generated along the route
 * geometry (with optional noise and detours). These tests check the engine's
 * logic; they are not a substitute for walking the route with a phone.
 */

const T0 = 2_000_000;
const WALK = 1.4; // m/s, a normal walking pace

const run = (state: NavigationState, events: NavigationEvent[]) => events.reduce(navigationReducer, state);

function started(route: NavigationRoute, profile: TravelMode = 'walking', along = 0): NavigationState {
  let state = run(initialNavigationState, [
    { type: 'start', now: T0, profile },
    { type: 'fix', fix: fixAt(route, along, T0, { speed: WALK }), now: T0 },
  ]);
  expect(routeRequestDue(state, T0)).toBe(true);
  state = run(state, [{ type: 'route-requested', now: T0 }, { type: 'route-ready', route, now: T0 }]);
  return state;
}

/** Deterministic pseudo-random noise so a failing run can be replayed. */
function noise(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648 - 0.5;
  };
}

/** SIMULATED walk along the route at `speed`, one fix per second, with ±`jitter` m of GPS noise. */
function walk(route: NavigationRoute, { speed = WALK, jitter = 0, locale = 'en' as 'ar' | 'en' } = {}) {
  let state = started(route);
  const spoken = new Set<string>();
  const prompts: (Announcement & { at: number; distance: number })[] = [];
  const rand = noise(42);
  let t = T0;
  for (let along = speed; along <= route.distance + speed * 3 && state.status !== 'arrived'; along += speed) {
    t += 1000;
    const clamped = Math.min(along, route.distance);
    const bearing = bearingAtDistance(route.line, route.cumulative, clamped);
    const point = offset(pointAtDistance(route.line, route.cumulative, clamped), bearing, rand() * 2 * jitter);
    state = navigationReducer(state, {
      type: 'fix',
      fix: { point, accuracy: 6 + Math.abs(rand()) * 6, heading: bearing, speed, timestamp: t },
      now: t,
    });
    expect(state.rerouteReason).toBeUndefined();
    if (!guidanceReliable(state)) continue;
    const announcement = planAnnouncement({ route, progress: state.progress!, speed: state.speed, spoken, locale });
    if (announcement) {
      markSpoken(spoken, announcement);
      prompts.push({ ...announcement, at: state.progress!.along, distance: state.progress!.distanceToNext });
    }
  }
  return { state, prompts };
}

describe('pedestrian routes', () => {
  it('turns the provider\'s walking steps into guided maneuvers, never inventing any', () => {
    const route = navRoute(fixtures.walkHospital);
    expect(route.profile).toBe('walking');
    expect(route.maneuvers.map((m) => m.kind)).toEqual(['depart', 'right', 'right', 'left', 'right', 'left', 'arrive']);
    // One maneuver per provider step, and the line ends where the provider's route ends.
    expect(route.maneuvers).toHaveLength(fixtures.walkHospital.steps!.length);
    expect(Math.abs(route.distance - fixtures.walkHospital.distanceMeters)).toBeLessThan(5);

    const manara = navRoute(fixtures.walkManara);
    expect(manara.maneuvers.at(-1)).toMatchObject({ kind: 'arrive', side: 'left' });
    expect(manara.maneuvers.filter((m) => m.announce && m.kind !== 'arrive').length).toBeGreaterThanOrEqual(14);
  });

  it('uses tighter, more patient thresholds than driving', () => {
    expect(offRouteThreshold(5, WALK_NAV)).toBe(25);
    expect(offRouteThreshold(5, NAV)).toBe(30);
    expect(offRouteThreshold(60, WALK_NAV)).toBe(50);
    expect(WALK_NAV.arriveMeters).toBeLessThan(NAV.arriveMeters);
    expect(WALK_NAV.offRouteFixes).toBeGreaterThan(NAV.offRouteFixes);
    expect(WALK_NAV.wrongWayMinSpeed).toBeLessThan(WALK);
  });
});

describe('walking voice guidance', () => {
  it('times prompts for walking speed: about 120 m, 40 m and at the turn', () => {
    const windows = announcementDistances(WALK, 'walking');
    expect(windows.far).toBeGreaterThanOrEqual(100);
    expect(windows.far).toBeLessThanOrEqual(200);
    expect(windows.prepare).toBeGreaterThanOrEqual(30);
    expect(windows.prepare).toBeLessThanOrEqual(60);
    expect(windows.now).toBeLessThanOrEqual(15);
    // Driving windows are untouched.
    expect(announcementDistances(WALK)).toEqual(announcementDistances(5));
  });

  it('guides a full SIMULATED walk: every turn announced once, in order, close to the corner', () => {
    const route = navRoute(fixtures.walkManara);
    const { state, prompts } = walk(route, { jitter: 4 });
    expect(state.status).toBe('arrived');

    const turns = route.maneuvers.filter((m) => m.announce && m.kind !== 'arrive');
    const nowPrompts = prompts.filter((p) => p.tier === 'now');
    expect(nowPrompts.map((p) => p.maneuverId)).toEqual(turns.map((m) => m.id));
    // A pedestrian hears "turn now" within a few steps of the corner, never 50 m early.
    for (const prompt of nowPrompts) expect(prompt.distance).toBeLessThanOrEqual(16);
    // Nothing is said twice.
    expect(new Set(prompts.map((p) => p.key)).size).toBe(prompts.length);
    // "In N meters" is within 10 m of the truth: on foot, rounding 125 m up to 150 m is ~20 s off.
    for (const prompt of prompts.filter((p) => p.tier === 'far' || p.tier === 'prepare')) {
      const spokenMeters = Number(/In (\d+) meters/.exec(prompt.text)?.[1]);
      expect(Math.abs(spokenMeters - prompt.distance)).toBeLessThanOrEqual(10);
    }
    // Each prompt names the same maneuver the on-screen card shows.
    for (const prompt of nowPrompts) {
      const maneuver = route.maneuvers.find((m) => m.id === prompt.maneuverId)!;
      expect(prompt.text.toLowerCase()).toContain(maneuverInstruction(maneuver, 'en').toLowerCase());
    }
  });

  it('speaks walking wording in Arabic and English', () => {
    expect(systemPhrases.rerouting('ar', 'walking')).toBe('ابتعدت عن المسار. جاري حساب طريق جديد.');
    expect(systemPhrases.rerouting('en', 'walking')).toBe('You are off the route. Calculating a new walking route.');
    expect(systemPhrases.start('en', 'walking')).toBe('Walking guidance started.');
    expect(continuePhrase(300, 'ar', 'walking')).toBe('تابع السير لمسافة 300 متر.');
    expect(continuePhrase(300, 'en', 'walking')).toBe('Continue walking for 300 meters.');
    // Driving wording is unchanged.
    expect(systemPhrases.rerouting('en')).toBe('Recalculating route.');
    expect(roundSpokenDistance(125, 'walking')).toBe(130);
    expect(roundSpokenDistance(125)).toBe(150);

    const route = navRoute(fixtures.walkHospital);
    const { prompts } = walk(route, { locale: 'ar' });
    expect(prompts.length).toBeGreaterThan(3);
    for (const prompt of prompts) expect(prompt.text).toMatch(/[؀-ۿ]/);
  });
});

describe('walking session (SIMULATED GPS)', () => {
  it('detects a real detour, asks for a new walking route, and continues to arrival', () => {
    const route = navRoute(fixtures.walkManara);
    let state = started(route);
    let t = T0;
    // Walk the first 300 m normally.
    for (let along = WALK; along <= 300; along += WALK) {
      t += 1000;
      state = navigationReducer(state, { type: 'fix', fix: fixAt(route, along, t, { speed: WALK }), now: t });
    }
    expect(state.rerouteReason).toBeUndefined();

    // Step 40 m off the path. A couple of drifted fixes are not enough...
    const base = pointAtDistance(route.line, route.cumulative, 300);
    const side = bearingAtDistance(route.line, route.cumulative, 300);
    for (let i = 0; i < 2; i++) {
      t += 1000;
      state = navigationReducer(state, { type: 'fix', fix: { point: offset(base, side, 40), accuracy: 6, heading: null, speed: WALK, timestamp: t }, now: t });
    }
    expect(state.rerouteReason).toBeUndefined();
    // ...but staying off the route for longer is.
    for (let i = 0; i < 8; i++) {
      t += 1000;
      state = navigationReducer(state, { type: 'fix', fix: { point: offset(base, side, 40 + i), accuracy: 6, heading: null, speed: WALK, timestamp: t }, now: t });
    }
    expect(state.rerouteReason).toBe('off-route');
    expect(routeRequestDue(state, t)).toBe(true);

    // The new route (here: the same walk, as the router would return from the detour) is installed.
    state = run(state, [{ type: 'route-requested', now: t }, { type: 'route-ready', route, now: t }]);
    expect(state.epoch).toBe(2);
    expect(state.status).toBe('active');
    expect(routeRequestDue(state, t + 1)).toBe(false);

    // Walk on to the destination.
    for (let along = 300; state.status !== 'arrived' && along <= route.distance + 10; along += WALK) {
      t += 1000;
      state = navigationReducer(state, { type: 'fix', fix: fixAt(route, Math.min(along, route.distance), t, { speed: WALK }), now: t });
    }
    expect(state.status).toBe('arrived');
  });

  it('notices walking the wrong way at walking speed, which driving thresholds would miss', () => {
    const route = navRoute(fixtures.walkManara);
    const backwards = (profile: TravelMode) => {
      let state = started(route, profile, 400);
      let t = T0;
      for (let i = 1; i <= 14; i++) {
        t += 1000;
        const along = 400 - i * WALK;
        const heading = (bearingAtDistance(route.line, route.cumulative, along) + 180) % 360;
        state = navigationReducer(state, { type: 'fix', fix: fixAt(route, along, t, { speed: WALK, heading }), now: t });
      }
      return state;
    };
    expect(backwards('walking').wrongWay).toBe(true);
    expect(backwards('driving').wrongWay).toBe(false);
  });

  it('arrives within 15 m of the door, not 25 m out', () => {
    const route = navRoute(fixtures.walkHospital);
    const at = (along: number) => run(started(route, 'walking', route.distance - 100), [
      { type: 'fix', fix: fixAt(route, along, T0 + 1000, { speed: WALK }), now: T0 + 1000 },
    ]).status;
    expect(at(route.distance - 22)).not.toBe('arrived');
    expect(at(route.distance - 8)).toBe('arrived');
  });

  it('holds guidance during pause and keeps the route through a GPS gap', () => {
    const route = navRoute(fixtures.walkHospital);
    let state = started(route);
    state = run(state, [{ type: 'pause' }, { type: 'fix', fix: fixAt(route, 200, T0 + 1000, { speed: WALK }), now: T0 + 1000 }]);
    expect(state.paused).toBe(true);
    expect(state.progress!.along).toBeLessThan(5);
    state = run(state, [{ type: 'resume', now: T0 + 2000 }, { type: 'fix', fix: fixAt(route, 20, T0 + 3000, { speed: WALK }), now: T0 + 3000 }]);
    expect(state.progress!.along).toBeGreaterThan(15);

    // No fixes for 20 s: signal lost, guidance suspended, route kept.
    state = run(state, [{ type: 'tick', now: T0 + 23_000 }]);
    expect(state.signal).toBe('lost');
    expect(guidanceReliable(state)).toBe(false);
    expect(state.route).toBe(route);
    state = run(state, [{ type: 'fix', fix: fixAt(route, 40, T0 + 24_000, { speed: WALK }), now: T0 + 24_000 }]);
    expect(state.signal).toBe('good');
    expect(guidanceReliable(state)).toBe(true);
  });
});

describe('regressions found in the live browser run (SIMULATED GPS)', () => {
  it('does not keep rerouting someone standing away from where the new route begins', () => {
    const route = navRoute(fixtures.walkHospital);
    // The user stands 35 m from the route's first point (e.g. inside a building block).
    const away = offset(route.line[0]!, bearingAtDistance(route.line, route.cumulative, 0), 35);
    let state = run(initialNavigationState, [
      { type: 'start', now: T0, profile: 'walking' },
      { type: 'fix', fix: { point: away, accuracy: 6, heading: null, speed: 0, timestamp: T0 }, now: T0 },
      { type: 'route-requested', now: T0 },
      { type: 'route-ready', route, now: T0 },
    ]);
    // Further from the route than the normal walking band, so without the start gap this would reroute.
    expect(state.startGap).toBeGreaterThan(WALK_NAV.offRouteMeters);
    expect(state.joinedRoute).toBe(false);
    let t = T0;
    for (let i = 0; i < 20; i++) {
      t += 1000;
      state = navigationReducer(state, { type: 'fix', fix: { point: away, accuracy: 6, heading: null, speed: 0, timestamp: t }, now: t });
    }
    expect(state.rerouteReason).toBeUndefined();
    // Walking clearly further away from the route is still caught.
    const further = offset(route.line[0]!, bearingAtDistance(route.line, route.cumulative, 0), -120);
    expect(distanceMeters(further, route.line[0]!)).toBeGreaterThan(state.startGap + 15);
    for (let i = 0; i < 12; i++) {
      t += 1000;
      state = navigationReducer(state, { type: 'fix', fix: { point: further, accuracy: 6, heading: null, speed: 1, timestamp: t }, now: t });
    }
    expect(state.rerouteReason).toBe('off-route');
  });

  it('uses the normal band again once the user has reached the route', () => {
    const route = navRoute(fixtures.walkHospital);
    const away = offset(route.line[0]!, bearingAtDistance(route.line, route.cumulative, 0), 35);
    let state = run(initialNavigationState, [
      { type: 'start', now: T0, profile: 'walking' },
      { type: 'fix', fix: { point: away, accuracy: 6, heading: null, speed: 0, timestamp: T0 }, now: T0 },
      { type: 'route-requested', now: T0 },
      { type: 'route-ready', route, now: T0 },
      { type: 'fix', fix: fixAt(route, 5, T0 + 1000, { speed: WALK }), now: T0 + 1000 },
    ]);
    expect(state.joinedRoute).toBe(true);
    // Back at the same spot, now 29 m off a route the user has walked on: a real detour.
    let t = T0 + 1000;
    for (let i = 0; i < 12; i++) {
      t += 1000;
      state = navigationReducer(state, { type: 'fix', fix: { point: away, accuracy: 6, heading: null, speed: 0.8, timestamp: t }, now: t });
    }
    expect(state.rerouteReason).toBe('off-route');
  });

  it('does not call a standing walker "wrong way" from an old heading and GPS drift speed', () => {
    const route = navRoute(fixtures.walkManara);
    let state = started(route, 'walking', 200);
    let t = T0;
    // One real step backwards sets a heading against the route...
    const back = (bearingAtDistance(route.line, route.cumulative, 195) + 180) % 360;
    t += 1000;
    state = navigationReducer(state, { type: 'fix', fix: fixAt(route, 194, t, { speed: 1, heading: back }), now: t });
    // ...then the walker stands still while the phone reports a little drift speed and no course.
    for (let i = 0; i < 15; i++) {
      t += 1000;
      state = navigationReducer(state, { type: 'fix', fix: fixAt(route, 194, t, { speed: 0.8, heading: null }), now: t });
    }
    expect(state.wrongWay).toBe(false);
  });

  it('ignores app-switch blips and never undoes a pause the user chose', () => {
    const route = navRoute(fixtures.walkHospital);
    const active = started(route);
    expect(resumeOnReturn(active, 2_000)).toBe(false);
    expect(resumeOnReturn(active, 30_000)).toBe(true);
    const paused = run(active, [{ type: 'pause' }]);
    expect(resumeOnReturn(paused, 60_000)).toBe(false);
  });
});

describe('walking ETA', () => {
  it('follows the walker\'s own pace while moving, and the router\'s while standing', () => {
    const route = navRoute(fixtures.walkManara);
    const state = started(route);
    const provider = state.progress!.remainingSeconds;
    const slow = estimatedRemainingSeconds({ ...state, speed: 0.9 })!;
    const brisk = estimatedRemainingSeconds({ ...state, speed: 1.9 })!;
    const standing = estimatedRemainingSeconds({ ...state, speed: 0.1 })!;
    expect(slow).toBeGreaterThan(provider);
    expect(brisk).toBeLessThan(provider);
    expect(standing).toBeCloseTo(provider, 0);
    // Driving keeps the provider's road-speed estimate.
    expect(estimatedRemainingSeconds({ ...state, profile: 'driving', speed: 0.9 })).toBe(provider);
  });
});
