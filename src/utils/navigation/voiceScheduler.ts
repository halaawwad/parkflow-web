import { actionPhrase, approachPhrase, continuePhrase, type GuidanceLocale } from './instructions';
import type { Maneuver, NavigationRoute } from './maneuvers';
import type { RouteProgress } from './progress';

/**
 * Decides which voice prompt (if any) is due. Prompts are tied to distance
 * windows that scale with speed, so a driver at 70 km/h hears "in 400 metres"
 * early enough to change lanes, while one crawling through traffic is not told
 * about a turn half a kilometre away. Each prompt is spoken at most once per
 * maneuver; the caller records what was said.
 */

export type AnnouncementTier = 'continue' | 'far' | 'prepare' | 'now';

export interface Announcement {
  key: string;
  tier: AnnouncementTier;
  maneuverId: string;
  /** Index of the maneuver in the route, so a late prompt can be recognised as stale. */
  maneuverIndex: number;
  text: string;
  priority: 'normal' | 'high';
  /** A close follow-up maneuver already described in this prompt ("…, then turn left"). */
  chained?: string;
}

const TIERS: AnnouncementTier[] = ['continue', 'far', 'prepare', 'now'];
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Distance windows in metres for the current speed (m/s). Assumes at least ~18 km/h. */
export function announcementDistances(speed: number) {
  const v = Math.max(speed, 5);
  return {
    far: clamp(v * 45, 500, 1600),
    prepare: clamp(v * 14, 120, 400),
    now: clamp(v * 4, 25, 70),
  };
}

export const tierKey = (maneuverId: string, tier: AnnouncementTier) => `${maneuverId}:${tier}`;

/**
 * Marks a tier and every earlier tier for that maneuver, so a late "now" never
 * triggers a stale "in 400 m". A chained follow-up has already been described,
 * so its advance warnings are skipped too (its own "now" prompt still plays).
 */
export function markSpoken(spoken: Set<string>, announcement: Pick<Announcement, 'maneuverId' | 'tier' | 'chained'>) {
  for (const tier of TIERS.slice(0, TIERS.indexOf(announcement.tier) + 1)) {
    spoken.add(tierKey(announcement.maneuverId, tier));
  }
  if (announcement.chained) {
    for (const tier of ['continue', 'far', 'prepare'] as const) spoken.add(tierKey(announcement.chained, tier));
  }
}

/** A maneuver that follows close enough to chain: "Turn right, then turn left". */
export function followingManeuver(route: NavigationRoute, index: number, speed: number): Maneuver | undefined {
  const current = route.maneuvers[index];
  if (!current || current.kind === 'arrive') return undefined;
  const next = route.maneuvers.slice(index + 1).find((maneuver) => maneuver.announce);
  if (!next) return undefined;
  return next.along - current.along <= Math.max(60, speed * 6) ? next : undefined;
}

export function planAnnouncement(input: {
  route: NavigationRoute;
  progress: RouteProgress;
  speed: number;
  spoken: ReadonlySet<string>;
  locale: GuidanceLocale;
}): Announcement | undefined {
  const { route, progress, speed, spoken, locale } = input;
  const maneuver = route.maneuvers[progress.nextIndex];
  if (!maneuver || !maneuver.announce) return undefined;
  const distance = progress.distanceToNext;
  const windows = announcementDistances(speed);
  const has = (tier: AnnouncementTier) => spoken.has(tierKey(maneuver.id, tier));
  const make = (tier: AnnouncementTier, text: string, priority: Announcement['priority'] = 'normal', chained?: Maneuver): Announcement => ({
    key: tierKey(maneuver.id, tier),
    tier,
    maneuverId: maneuver.id,
    maneuverIndex: progress.nextIndex,
    text,
    priority,
    chained: chained?.id,
  });
  const terminal = maneuver.kind === 'arrive' || maneuver.kind === 'waypoint';

  if (distance <= windows.now) {
    // Arrival itself is announced by the session when it is detected, not by distance.
    if (terminal || has('now')) return undefined;
    const then = followingManeuver(route, progress.nextIndex, speed);
    return make('now', actionPhrase(maneuver, locale, then), 'high', then);
  }
  if (distance <= windows.prepare) {
    if (has('prepare') || distance - windows.now < 15) return undefined;
    return make('prepare', approachPhrase(maneuver, distance, locale));
  }
  if (distance <= windows.far) {
    if (has('far') || terminal || distance < windows.prepare * 1.6) return undefined;
    return make('far', approachPhrase(maneuver, distance, locale));
  }
  // A long stretch with nothing to do: say so once, then stay quiet.
  if (!has('continue') && !has('far')) return make('continue', continuePhrase(distance, locale));
  return undefined;
}

/**
 * Prompts likely to be spoken in the next ~30 seconds, so natural-voice audio
 * can be fetched before it is needed. Distance prompts are predicted from the
 * windows above: a prompt fires on the first fix inside its window, so the
 * spoken distance is the window edge minus up to two fixes of travel. The
 * candidates are deduplicated after rounding, so this is a handful of short
 * sentences, not one per metre.
 */
export function upcomingSentences(input: {
  route: NavigationRoute;
  progress: RouteProgress;
  speed: number;
  locale: GuidanceLocale;
}): string[] {
  const { route, progress, speed, locale } = input;
  const maneuver = route.maneuvers[progress.nextIndex];
  if (!maneuver || !maneuver.announce) return [];
  const windows = announcementDistances(speed);
  const step = Math.max(speed, 5);
  const distance = progress.distanceToNext;
  const terminal = maneuver.kind === 'arrive' || maneuver.kind === 'waypoint';
  const out: string[] = [];
  const near = (edge: number) => [edge, edge - step, edge - 2 * step].filter((d) => d > windows.now + 15);

  if (!terminal) out.push(actionPhrase(maneuver, locale, followingManeuver(route, progress.nextIndex, speed)));
  // The prompt that would fire at the current distance (fetched just before it is planned).
  if (distance <= windows.prepare && distance - windows.now >= 15) out.push(approachPhrase(maneuver, distance, locale));
  if (!terminal && distance <= windows.far && distance >= windows.prepare * 1.6) out.push(approachPhrase(maneuver, distance, locale));
  if (distance <= windows.prepare + 300) near(windows.prepare).forEach((d) => out.push(approachPhrase(maneuver, d, locale)));
  if (!terminal && distance <= windows.far + 400 && distance > windows.prepare * 1.6) {
    near(windows.far).forEach((d) => out.push(approachPhrase(maneuver, d, locale)));
  }

  // Right after this maneuver the next one becomes current. Whatever is said
  // first about it is spoken at (about) the gap between the two: a "continue
  // for …" over a long stretch, or an "in … metres" warning when they are close.
  const afterIndex = route.maneuvers.findIndex((m, i) => i > progress.nextIndex && m.announce);
  const after = route.maneuvers[afterIndex];
  if (after && distance <= windows.prepare + 300) {
    const gap = after.along - maneuver.along;
    const afterTerminal = after.kind === 'arrive' || after.kind === 'waypoint';
    for (const d of [gap, gap - step, gap - 2 * step]) {
      if (d <= windows.now + 15) continue;
      if (d > windows.far) out.push(continuePhrase(d, locale));
      else if (d <= windows.prepare) out.push(approachPhrase(after, d, locale));
      else if (!afterTerminal && d >= windows.prepare * 1.6) out.push(approachPhrase(after, d, locale));
    }
  }
  return [...new Set(out)];
}

/** Sentences a whole route is certain to need, known as soon as it is planned. */
export function routeSentences(route: NavigationRoute, locale: GuidanceLocale): string[] {
  const out: string[] = [];
  route.maneuvers.forEach((maneuver, index) => {
    if (!maneuver.announce || maneuver.kind === 'arrive' || maneuver.kind === 'waypoint') return;
    // Typical city speed decides whether a close follow-up is chained.
    out.push(actionPhrase(maneuver, locale, followingManeuver(route, index, 10)));
  });
  return out;
}
