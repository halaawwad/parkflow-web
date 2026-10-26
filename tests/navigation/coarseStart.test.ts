import { describe, expect, it } from 'vitest';
import {
  COARSE_START_MS,
  guidanceReliable,
  initialNavigationState,
  navigationReducer,
  planningFix,
  routeRequestDue,
  type NavigationState,
} from '@/utils/navigation/session';
import { fixAt, fixtures, navRoute } from './helpers';

const T0 = 1_000_000;

/** What a computer reports: Wi-Fi/IP location, ±120 m, never improving. */
function coarseOnly(): NavigationState {
  const route = navRoute(fixtures.manara);
  let state = navigationReducer(initialNavigationState, { type: 'start', now: T0 });
  state = navigationReducer(state, { type: 'fix', fix: fixAt(route, 0, T0 + 500, { accuracy: 120 }), now: T0 + 500 });
  return state;
}

describe('starting navigation without an accurate fix', () => {
  it('does not wait forever: plans from the best fix after a short wait', () => {
    let state = coarseOnly();
    expect(routeRequestDue(state, T0 + 1000)).toBe(false);
    expect(routeRequestDue(state, T0 + COARSE_START_MS)).toBe(true);
    state = navigationReducer(state, { type: 'route-requested', now: T0 + COARSE_START_MS });
    expect(state.status).toBe('routing');
    expect(planningFix(state)?.accuracy).toBe(120);
  });

  it('still ends the wait when the device reported once and then went quiet', () => {
    let state = coarseOnly();
    state = navigationReducer(state, { type: 'tick', now: T0 + COARSE_START_MS + 10 });
    expect(state.coarseStart).toBe(true);
    expect(routeRequestDue(state, T0 + COARSE_START_MS + 10)).toBe(true);
  });

  it('keeps the most accurate of several coarse fixes', () => {
    const route = navRoute(fixtures.manara);
    let state = navigationReducer(initialNavigationState, { type: 'start', now: T0 });
    for (const [i, accuracy] of [300, 90, 150].entries()) {
      state = navigationReducer(state, { type: 'fix', fix: fixAt(route, 0, T0 + i * 1000, { accuracy }), now: T0 + i * 1000 });
    }
    expect(state.bestFix?.accuracy).toBe(90);
  });

  it('shows the route but gives no turn guidance until an accurate fix arrives', () => {
    const route = navRoute(fixtures.manara);
    let state = coarseOnly();
    state = navigationReducer(state, { type: 'route-requested', now: T0 + COARSE_START_MS });
    state = navigationReducer(state, { type: 'route-ready', route, now: T0 + COARSE_START_MS + 500 });
    expect(state.status).toBe('active');
    expect(state.progress).toBeDefined();
    expect(state.signal).toBe('weak');
    expect(guidanceReliable(state)).toBe(false);

    state = navigationReducer(state, { type: 'fix', fix: fixAt(route, 20, T0 + 6000, { accuracy: 8 }), now: T0 + 6000 });
    expect(state.signal).toBe('good');
    expect(guidanceReliable(state)).toBe(true);
  });

  it('starts immediately when an accurate fix is there', () => {
    const route = navRoute(fixtures.manara);
    let state = navigationReducer(initialNavigationState, { type: 'start', now: T0 });
    state = navigationReducer(state, { type: 'fix', fix: fixAt(route, 0, T0 + 300, { accuracy: 6 }), now: T0 + 300 });
    expect(routeRequestDue(state, T0 + 300)).toBe(true);
  });
});
