import { describe, expect, it } from 'vitest';
import {
  guidanceReliable,
  initialNavigationState,
  NAV,
  navigationReducer,
  remainingVia,
  routeRequestDue,
  type NavigationEvent,
  type NavigationState,
} from '@/utils/navigation/session';
import { markSpoken, planAnnouncement, type Announcement } from '@/utils/navigation/voiceScheduler';
import { maneuverInstruction } from '@/utils/navigation/instructions';
import { bearingAtDistance } from '@/utils/navigation/geometry';
import type { NavigationRoute } from '@/utils/navigation/maneuvers';
import { fixAt, fixtures, navRoute, offset } from './helpers';

const T0 = 1_000_000;

function run(state: NavigationState, events: NavigationEvent[]) {
  return events.reduce(navigationReducer, state);
}

/** Starts a session, gets a first fix at `along`, and installs the route. */
function started(route: NavigationRoute, along = 0): NavigationState {
  let state = run(initialNavigationState, [{ type: 'start', now: T0 }, { type: 'fix', fix: fixAt(route, along, T0), now: T0 }]);
  expect(routeRequestDue(state, T0)).toBe(true);
  state = run(state, [{ type: 'route-requested', now: T0 }, { type: 'route-ready', route, now: T0 }]);
  return state;
}

/** Drives the whole route at `speed` m/s, one fix per second, collecting voice prompts. */
function drive(route: NavigationRoute, speed = 10, locale: 'ar' | 'en' = 'en') {
  let state = started(route);
  const spoken = new Set<string>();
  const prompts: Announcement[] = [];
  const nextIndexes: number[] = [];
  let t = T0;
  for (let along = speed; along <= route.distance + speed && state.status !== 'arrived'; along += speed) {
    t += 1000;
    state = navigationReducer(state, { type: 'fix', fix: fixAt(route, Math.min(along, route.distance), t, { speed }), now: t });
    expect(state.rerouteReason).toBeUndefined();
    if (!guidanceReliable(state)) continue;
    nextIndexes.push(state.progress!.nextIndex);
    const announcement = planAnnouncement({ route, progress: state.progress!, speed: state.speed, spoken, locale });
    if (announcement) {
      markSpoken(spoken, announcement);
      prompts.push(announcement);
    }
  }
  return { state, prompts, nextIndexes };
}

describe('turn-by-turn session', () => {
  it('follows a real multi-turn route to arrival without rerouting', () => {
    const route = navRoute(fixtures.manara);
    const { state, prompts, nextIndexes } = drive(route);
    expect(state.status).toBe('arrived');
    // Progress never goes backwards.
    expect([...nextIndexes].sort((a, b) => a - b)).toEqual(nextIndexes);

    // Every announced turn gets exactly one "now" prompt, in route order.
    const announced = route.maneuvers.filter((m) => m.announce && m.kind !== 'arrive');
    const nowPrompts = prompts.filter((p) => p.tier === 'now');
    expect(nowPrompts.map((p) => p.maneuverId)).toEqual(announced.map((m) => m.id));
    // No prompt key is ever repeated.
    expect(new Set(prompts.map((p) => p.key)).size).toBe(prompts.length);
  });

  it('never says something different from the card for the same maneuver', () => {
    const route = navRoute(fixtures.second);
    const { prompts } = drive(route, 8);
    for (const prompt of prompts.filter((p) => p.tier === 'now' || p.tier === 'prepare')) {
      const maneuver = route.maneuvers.find((m) => m.id === prompt.maneuverId)!;
      expect(prompt.text.toLowerCase()).toContain(maneuverInstruction(maneuver, 'en').toLowerCase());
    }
  });

  it('distinguishes left from right in the spoken Arabic prompts', () => {
    const route = navRoute(fixtures.second);
    const { prompts } = drive(route, 8, 'ar');
    const now = prompts.filter((p) => p.tier === 'now').map((p) => p.text);
    expect(now[0]).toMatch(/^انعطف يسارًا/);
    expect(now[1]).toMatch(/^انعطف يمينًا/);
  });

  it('ignores brief GPS drift but reroutes after sustained off-route driving', () => {
    const route = navRoute(fixtures.manara);
    let state = started(route);
    const along = 300;
    const bearing = bearingAtDistance(route.line, route.cumulative, along);
    let t = T0 + 30_000;
    // Two drifting fixes 45 m off, then back on the route.
    for (let i = 0; i < 2; i++) {
      t += 1000;
      state = navigationReducer(state, { type: 'fix', fix: { ...fixAt(route, along, t), point: offset(fixAt(route, along, t).point, bearing, 45) }, now: t });
    }
    t += 1000;
    state = navigationReducer(state, { type: 'fix', fix: fixAt(route, along + 10, t), now: t });
    expect(state.rerouteReason).toBeUndefined();
    expect(routeRequestDue(state, t)).toBe(false);

    // Now leave the route for real.
    for (let i = 0; i < 6; i++) {
      t += 1000;
      const base = fixAt(route, along + 20, t);
      state = navigationReducer(state, { type: 'fix', fix: { ...base, point: offset(base.point, bearing, 90 + i * 10) }, now: t });
    }
    expect(state.rerouteReason).toBe('off-route');
    expect(routeRequestDue(state, t)).toBe(true);
    state = navigationReducer(state, { type: 'route-requested', now: t });
    expect(state.status).toBe('rerouting');
    // No second request while one is pending or within the minimum interval.
    expect(routeRequestDue(state, t + 1000)).toBe(false);
  });

  it('widens the off-route threshold when GPS reports poor accuracy', () => {
    const route = navRoute(fixtures.manara);
    let state = started(route);
    const bearing = bearingAtDistance(route.line, route.cumulative, 300);
    let t = T0;
    for (let i = 0; i < 8; i++) {
      t += 1000;
      const base = fixAt(route, 300 + i * 5, t, { accuracy: 35 });
      state = navigationReducer(state, { type: 'fix', fix: { ...base, point: offset(base.point, bearing, 45) }, now: t });
    }
    expect(state.rerouteReason).toBeUndefined();
  });

  it('suspends guidance on weak GPS and when the signal is lost, then recovers', () => {
    const route = navRoute(fixtures.manara);
    let state = started(route);
    let t = T0;
    const before = state.progress!.along;
    for (let i = 0; i < 10; i++) {
      t += 1000;
      state = navigationReducer(state, { type: 'fix', fix: fixAt(route, 400, t, { accuracy: 120 }), now: t });
    }
    expect(state.signal).toBe('weak');
    expect(guidanceReliable(state)).toBe(false);
    // Inaccurate fixes never move progress.
    expect(state.progress!.along).toBe(before);

    t += 1000;
    state = navigationReducer(state, { type: 'fix', fix: fixAt(route, 60, t), now: t });
    expect(state.signal).toBe('good');
    expect(guidanceReliable(state)).toBe(true);

    state = navigationReducer(state, { type: 'tick', now: t + NAV.lostAfterMs + 1 });
    expect(state.signal).toBe('lost');
    expect(guidanceReliable(state)).toBe(false);
  });

  it('detects driving the wrong way along the route', () => {
    const route = navRoute(fixtures.second);
    let state = started(route, 900);
    let t = T0;
    for (let i = 1; i <= 8; i++) {
      t += 1000;
      const along = 900 - i * 10;
      const heading = (bearingAtDistance(route.line, route.cumulative, along) + 180) % 360;
      state = navigationReducer(state, { type: 'fix', fix: fixAt(route, along, t, { heading, speed: 10 }), now: t });
    }
    expect(state.wrongWay).toBe(true);
    expect(state.rerouteReason).toBe('wrong-way');
  });

  it('keeps guiding on the old route when a reroute fails offline, with backoff', () => {
    const route = navRoute(fixtures.manara);
    let state = started(route);
    state = { ...state, rerouteReason: 'off-route' };
    state = run(state, [{ type: 'route-requested', now: T0 }, { type: 'route-failed', reason: 'offline', now: T0 }]);
    expect(state.status).toBe('active');
    expect(state.offline).toBe(true);
    expect(state.route).toBe(route);
    expect(routeRequestDue(state, T0 + NAV.rerouteIntervalMs - 1)).toBe(false);
    expect(routeRequestDue(state, T0 + NAV.rerouteIntervalMs)).toBe(true);
  });

  it('reports routing and permission failures before a route exists', () => {
    let state = run(initialNavigationState, [{ type: 'start', now: T0 }, { type: 'permission-denied' }]);
    expect(state).toMatchObject({ status: 'error', error: 'permission-denied' });
    const route = navRoute(fixtures.manara);
    state = run(initialNavigationState, [
      { type: 'start', now: T0 },
      { type: 'fix', fix: fixAt(route, 0, T0), now: T0 },
      { type: 'route-requested', now: T0 },
      { type: 'route-failed', reason: 'no-guidance', now: T0 },
    ]);
    expect(state).toMatchObject({ status: 'error', error: 'no-guidance' });
  });

  it('ignores fixes while paused and resumes with fresh counters', () => {
    const route = navRoute(fixtures.manara);
    let state = started(route);
    state = navigationReducer(state, { type: 'pause' });
    const paused = navigationReducer(state, { type: 'fix', fix: fixAt(route, 500, T0 + 1000), now: T0 + 1000 });
    expect(paused).toBe(state);
    state = navigationReducer(paused, { type: 'resume', now: T0 + 2000 });
    expect(state.paused).toBe(false);
    state = navigationReducer(state, { type: 'fix', fix: fixAt(route, 510, T0 + 3000), now: T0 + 3000 });
    expect(state.progress!.along).toBeGreaterThan(400);
  });

  it('drops stops already visited when rerouting a multi-stop route', () => {
    const route = { ...navRoute(fixtures.manara), via: [{ latitude: 1, longitude: 1 }] };
    const stop = { ...route.maneuvers[5]!, kind: 'waypoint' as const };
    const withStop = { ...route, maneuvers: route.maneuvers.map((m, i) => (i === 5 ? stop : m)) };
    expect(remainingVia({ ...initialNavigationState, route: withStop, progress: { along: 0 } as never })).toHaveLength(1);
    expect(remainingVia({ ...initialNavigationState, route: withStop, progress: { along: stop.along + 30 } as never })).toHaveLength(0);
  });
});
