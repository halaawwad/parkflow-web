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
