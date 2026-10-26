import type { GuidanceLocale } from '@/utils/navigation/instructions';
import { dangerOf, type Direction, type HazardLevel, type ObstacleAssessment } from './tracker';
import type { Unreliability } from './quality';

/**
 * When and how to speak about obstacles. Two kinds of warning:
 *
 * - early: said once per obstacle, as soon as it is confirmed in the path;
 * - urgent: said at once whatever else is playing, and again every few
 *   seconds while the obstacle stays urgent.
 *
 * Sentences are as short as possible: every word is time the walker spends
 * listening instead of reacting. Nothing here ever says the way is clear or
 * suggests where to step — the camera cannot see enough to promise that
 * (walls, poles, holes, curbs and stairs are not detected).
 */

export const WARNING_TIMING = {
  /** An obstacle that stays urgent is warned about again after this long. */
  urgentRepeatMs: 6_000,
  /**
   * Least time between two early warnings; an urgent warning never waits. Short, because on
   * annotated walking video longer gaps held back the early warning for real hazards.
   */
  earlyGapMs: 800,
  /** After an urgent warning, early news waits this long so the urgent one is heard (the queue never overlaps them). */
  afterUrgentMs: 600,
  /** An obstacle not seen for this long is forgotten; if it comes back it is new again. */
  forgetMs: 4_000,
};
export type WarningTiming = typeof WARNING_TIMING;

export type AnnouncementPriority = 'normal' | 'high' | 'urgent';

export interface ObstacleAnnouncement {
  level: HazardLevel;
  obstacle: ObstacleAssessment;
  /** Urgent cuts in over everything; early waits behind a turn instruction already playing. */
  priority: Extract<AnnouncementPriority, 'high' | 'urgent'>;
}

export class WarningPolicy {
  /** Per obstacle: the level last announced, and when. */
  private announced = new Map<number, { level: HazardLevel; at: number; seenAt: number }>();
  private lastEarlyAt = Number.NEGATIVE_INFINITY;
  private lastUrgentAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly timing: WarningTiming = WARNING_TIMING) {}

  /** The announcement for this frame, if one is due. */
  decide(assessments: ObstacleAssessment[], now: number): ObstacleAnnouncement | undefined {
    // Forget first: an obstacle that left and came back is news again.
    for (const [id, memory] of this.announced) if (now - memory.seenAt > this.timing.forgetMs) this.announced.delete(id);
    for (const a of assessments) {
      const memory = this.announced.get(a.trackId);
      if (memory) memory.seenAt = now;
    }
    const sorted = [...assessments].sort((x, y) => dangerOf(y) - dangerOf(x));

    const due = sorted.find((a) => {
      if (a.level !== 'urgent') return false;
      const memory = this.announced.get(a.trackId);
      return !memory || memory.level !== 'urgent' || now - memory.at >= this.timing.urgentRepeatMs;
    });
    if (due) {
      this.announced.set(due.trackId, { level: 'urgent', at: now, seenAt: now });
      this.lastUrgentAt = now;
      return { level: 'urgent', obstacle: due, priority: 'urgent' };
    }

    // Early news about another obstacle must not wait for an urgent one to go away
    // (in a crowd that can be never), only long enough for the urgent words to be heard.
    if (now - this.lastUrgentAt < this.timing.afterUrgentMs || now - this.lastEarlyAt < this.timing.earlyGapMs) return undefined;
    // Each obstacle gets one early warning; a harmless one is not repeated.
    const fresh = sorted.find((a) => !this.announced.has(a.trackId));
    if (!fresh) return undefined;
    this.announced.set(fresh.trackId, { level: 'early', at: now, seenAt: now });
    this.lastEarlyAt = now;
    return { level: 'early', obstacle: fresh, priority: 'high' };
  }

  reset(): void {
    this.announced.clear();
    this.lastEarlyAt = Number.NEGATIVE_INFINITY;
    this.lastUrgentAt = Number.NEGATIVE_INFINITY;
  }
}

const NAMES: Record<string, { ar: string; en: string }> = {
  person: { ar: 'شخص', en: 'person' },
  bicycle: { ar: 'دراجة', en: 'bicycle' },
  motorcycle: { ar: 'دراجة نارية', en: 'motorcycle' },
  car: { ar: 'سيارة', en: 'car' },
  bus: { ar: 'حافلة', en: 'bus' },
  truck: { ar: 'شاحنة', en: 'truck' },
  bench: { ar: 'مقعد', en: 'bench' },
  chair: { ar: 'كرسي', en: 'chair' },
  'dining table': { ar: 'طاولة', en: 'table' },
  'potted plant': { ar: 'أصيص', en: 'plant pot' },
  'fire hydrant': { ar: 'حنفية إطفاء', en: 'fire hydrant' },
  'parking meter': { ar: 'عداد موقف', en: 'parking meter' },
  'stop sign': { ar: 'إشارة قف', en: 'stop sign' },
  dog: { ar: 'كلب', en: 'dog' },
  cat: { ar: 'قطة', en: 'cat' },
  horse: { ar: 'حصان', en: 'horse' },
  sheep: { ar: 'خروف', en: 'sheep' },
  cow: { ar: 'بقرة', en: 'cow' },
};
/** An obstacle whose type is not clear is never given a guessed name. */
const OBSTACLE = { ar: 'عائق', en: 'obstacle' };
const nameOf = (label?: string) => (label && NAMES[label]) || OBSTACLE;
const AR_SIDE: Record<Direction, string> = { center: '', left: ' جهة اليسار', right: ' جهة اليمين' };
const EN_SIDE: Record<Direction, string> = { center: '', left: ' to the left', right: ' to the right' };

/**
 * The spoken sentence. Early: "انتبه، شخص أمامك." Urgent: "توقف، عائق أمامك."
 * — no type, so it is as short as it can be. Never a distance or a time.
 */
export function describeObstacles(announcement: ObstacleAnnouncement, locale: GuidanceLocale): string {
  const { level, obstacle } = announcement;
  if (locale === 'ar') {
    return level === 'urgent'
      ? `توقف، عائق أمامك${AR_SIDE[obstacle.direction]}.`
      : `انتبه، ${nameOf(obstacle.label).ar} أمامك${AR_SIDE[obstacle.direction]}.`;
  }
  return level === 'urgent'
    ? `Stop, obstacle ahead${EN_SIDE[obstacle.direction]}.`
    : `Careful, ${nameOf(obstacle.label).en} ahead${EN_SIDE[obstacle.direction]}.`;
}
export type ObstacleUnavailable = 'unsupported' | 'permission-denied' | 'camera-error' | 'model-error' | 'front-camera' | 'background';

/** What the walker is told about obstacle monitoring itself. */
export type ObstacleStatus =
  | { state: 'off' }
  | { state: 'starting' }
  | { state: 'active' }
  | { state: 'unreliable'; reason: Unreliability }
  | { state: 'paused' }
  | { state: 'unavailable'; reason: ObstacleUnavailable };

export const obstaclePhrases = {
  on: (locale: GuidanceLocale) =>
    locale === 'ar'
      ? 'تنبيه العوائق بالكاميرا يعمل. إنه مساعدة فقط، استمر بالحذر المعتاد.'
      : 'Camera obstacle alerts are on. They are only an aid; keep your usual care.',
  restored: (locale: GuidanceLocale) => (locale === 'ar' ? 'عاد تنبيه العوائق للعمل.' : 'Obstacle alerts are working again.'),
  paused: (locale: GuidanceLocale) => (locale === 'ar' ? 'تم إيقاف تنبيه العوائق مؤقتًا.' : 'Obstacle alerts paused.'),
  unreliable: (locale: GuidanceLocale) =>
    locale === 'ar'
      ? 'لا أستطيع التأكد من سلامة الطريق أمامك. توقف وتحقق من المسار.'
      : "I can't confirm the way ahead is safe. Stop and check your path.",
  stopped: (locale: GuidanceLocale) =>
    locale === 'ar' ? 'توقف تنبيه العوائق بالكاميرا. تابع بحذر.' : 'Camera obstacle alerts have stopped. Continue with care.',
  failed: (locale: GuidanceLocale) =>
    locale === 'ar' ? 'تعذّر تشغيل تنبيه العوائق بالكاميرا. إرشاد المشي يعمل بدونه.' : "Camera obstacle alerts couldn't start. Walking guidance continues without them.",
  unsupported: (locale: GuidanceLocale) =>
    locale === 'ar'
      ? 'تنبيه العوائق بالكاميرا غير متاح على هذا الجهاز. إرشاد المشي يعمل بدونه.'
      : 'Camera obstacle alerts are not available on this device. Walking guidance continues without them.',
  permissionDenied: (locale: GuidanceLocale) =>
    locale === 'ar'
      ? 'لم يُسمح باستخدام الكاميرا، لذلك تنبيه العوائق متوقف.'
      : 'Camera access was not allowed, so obstacle alerts are off.',
  frontCamera: (locale: GuidanceLocale) =>
    locale === 'ar'
      ? 'لا تتوفر كاميرا خلفية، لذلك تنبيه العوائق متوقف.'
      : 'No rear camera is available, so obstacle alerts are off.',
};

/** The sentence for a change in monitoring status, if the walker needs to hear it. */
export function statusAnnouncement(
  previous: ObstacleStatus,
  next: ObstacleStatus,
  locale: GuidanceLocale,
): { text: string; priority: AnnouncementPriority } | undefined {
  if (previous.state === next.state && (previous as { reason?: string }).reason === (next as { reason?: string }).reason) return undefined;
  switch (next.state) {
    case 'active':
      return previous.state === 'starting' || previous.state === 'off'
        ? { text: obstaclePhrases.on(locale), priority: 'normal' }
        : { text: obstaclePhrases.restored(locale), priority: 'normal' };
    case 'unreliable':
      // Already unreliable for another reason: the walker has been told.
      return previous.state === 'unreliable' ? undefined : { text: obstaclePhrases.unreliable(locale), priority: 'urgent' };
    case 'paused':
      return { text: obstaclePhrases.paused(locale), priority: 'normal' };
    case 'unavailable': {
      // Nothing can be spoken in the background; returning is announced instead.
      if (next.reason === 'background') return undefined;
      const wasWatching = previous.state === 'active' || previous.state === 'unreliable';
      const text = next.reason === 'unsupported' ? obstaclePhrases.unsupported(locale)
        : next.reason === 'permission-denied' ? obstaclePhrases.permissionDenied(locale)
        : next.reason === 'front-camera' ? obstaclePhrases.frontCamera(locale)
        : wasWatching ? obstaclePhrases.stopped(locale) : obstaclePhrases.failed(locale);
      // Losing the camera mid-walk matters more than never having had it.
      return { text, priority: wasWatching ? 'urgent' : 'high' };
    }
    default:
      return undefined;
  }
}
