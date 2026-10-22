import { describe, expect, it } from 'vitest';
import { guidanceReliable, initialNavigationState, navigationReducer, type NavigationState } from '@/utils/navigation/session';
import { markSpoken, planAnnouncement, routeSentences, upcomingSentences } from '@/utils/navigation/voiceScheduler';
import type { NavigationRoute } from '@/utils/navigation/maneuvers';
import { fixAt, fixtures, navRoute } from './helpers';

const T0 = 1_000_000;

/**
 * Drives a route and checks every prompt that is spoken was already among the
 * sentences prefetched on earlier fixes — i.e. natural-voice audio would be
 * ready and the device voice never needed.
 */
function coverage(route: NavigationRoute, speed: number, locale: 'ar' | 'en') {
  let state: NavigationState = [
    { type: 'start', now: T0 } as const,
    { type: 'fix', fix: fixAt(route, 0, T0), now: T0 } as const,
    { type: 'route-requested', now: T0 } as const,
    { type: 'route-ready', route, now: T0 } as const,
  ].reduce(navigationReducer, initialNavigationState);
  const prefetched = new Set(routeSentences(route, locale));
  const spoken = new Set<string>();
  const prompts: { text: string; covered: boolean; early: boolean }[] = [];
  let t = T0;
  for (let along = speed; state.status !== 'arrived' && along <= route.distance + speed; along += speed) {
    t += 1000;
    state = navigationReducer(state, { type: 'fix', fix: fixAt(route, Math.min(along, route.distance), t, { speed }), now: t });
    if (!guidanceReliable(state)) continue;
    // The app's prefetch effect runs before its announcement effect on the same
    // update, so a sentence requested here is already in flight when it is spoken.
    const before = new Set(prefetched);
    upcomingSentences({ route, progress: state.progress!, speed: state.speed, locale }).forEach((s) => prefetched.add(s));
    const announcement = planAnnouncement({ route, progress: state.progress!, speed: state.speed, spoken, locale });
    if (announcement) {
      markSpoken(spoken, announcement);
      prompts.push({ text: announcement.text, covered: prefetched.has(announcement.text), early: before.has(announcement.text) });
    }
  }
  return prompts;
}

describe('natural voice prefetch coverage', () => {
  for (const [name, result] of Object.entries(fixtures)) {
    for (const speed of [6, 10, 14]) {
      for (const locale of ['ar', 'en'] as const) {
        it(`${name} at ${speed} m/s (${locale}): every prompt is ready before it is spoken`, () => {
          const prompts = coverage(navRoute(result), speed, locale);
          expect(prompts.length).toBeGreaterThan(3);
          expect(prompts.filter((p) => !p.covered).map((p) => p.text)).toEqual([]);
          // Urgent "turn now" prompts must already be fetched a fix or more ahead.
          expect(prompts.filter((p) => !p.early && !/^(In |بعد )/.test(p.text) && !/^(Continue|استمر)/.test(p.text)).map((p) => p.text)).toEqual([]);
        });
      }
    }
  }

  it('asks for only a handful of sentences at a time', () => {
    const route = navRoute(fixtures.manara);
    let state: NavigationState = [
      { type: 'start', now: T0 } as const,
      { type: 'fix', fix: fixAt(route, 0, T0), now: T0 } as const,
      { type: 'route-requested', now: T0 } as const,
      { type: 'route-ready', route, now: T0 } as const,
    ].reduce(navigationReducer, initialNavigationState);
    state = navigationReducer(state, { type: 'fix', fix: fixAt(route, 400, T0 + 1000, { speed: 10 }), now: T0 + 1000 });
    expect(upcomingSentences({ route, progress: state.progress!, speed: 10, locale: 'ar' }).length).toBeLessThanOrEqual(8);
  });
});
