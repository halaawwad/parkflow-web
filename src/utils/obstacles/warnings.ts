import type { GuidanceLocale } from '@/utils/navigation/instructions';
import { dangerOf, type Direction, type ObstacleAssessment, type Proximity } from './tracker';
import type { Unreliability } from './quality';

/**
 * When and how to speak about obstacles: the most dangerous one first, said
 * again only when it is new, gets more dangerous, or stays relevant long
 * enough to need a reminder. A warning for every visible object would drown
 * out the route and the street. Nothing here ever says the way is clear or
 * suggests where to step — the camera cannot see enough to promise that
 * (walls, poles, holes, curbs and stairs are not detected).
 */

export const WARNING_TIMING = {
  /** Least time between two obstacle announcements, unless the danger rises. */
  minGapMs: 1_500,
  /** A still-relevant obstacle is mentioned again after this long at the same level. */
  repeatMs: { 'very-close': 3_000, near: 5_000, ahead: 12_000 } as Record<Proximity, number>,
  /** An obstacle not seen for this long is forgotten; if it comes back it is new again. */
  forgetMs: 4_000,
};
export type WarningTiming = typeof WARNING_TIMING;

export type AnnouncementPriority = 'normal' | 'high' | 'urgent';

export interface ObstacleAnnouncement {
  primary: ObstacleAssessment;
  /** One other obstacle in a different direction, mentioned after the main one. */
  secondary?: ObstacleAssessment;
  /** Close and in the path cuts in over everything; the rest waits behind a turn instruction. */
  priority: Extract<AnnouncementPriority, 'high' | 'urgent'>;
}

export class WarningPolicy {
  /** Per obstacle: the danger last announced (or the highest since), and when. */
  private announced = new Map<number, { danger: number; at: number; seenAt: number }>();
  private lastAt = Number.NEGATIVE_INFINITY;
  private lastDanger = 0;

  constructor(private readonly timing: WarningTiming = WARNING_TIMING) {}

  /** The announcement for this frame, if one is due. */
  decide(assessments: ObstacleAssessment[], now: number): ObstacleAnnouncement | undefined {
    // Forget first: an obstacle that left and came back is news again.
    for (const [id, memory] of this.announced) if (now - memory.seenAt > this.timing.forgetMs) this.announced.delete(id);
    for (const a of assessments) {
      const memory = this.announced.get(a.trackId);
      if (memory) memory.seenAt = now;
    }
    if (!assessments.length) return undefined;

    const sinceLast = now - this.lastAt;
    const due = (a: ObstacleAssessment) => {
      const memory = this.announced.get(a.trackId);
      const danger = dangerOf(a);
      return memory
        // The same obstacle: speak when it got more dangerous, or as a reminder.
        ? danger > memory.danger || (now - memory.at >= this.timing.repeatMs[a.proximity] && sinceLast >= this.timing.minGapMs)
        // A new obstacle: promptly, unless something at least as dangerous was just said.
        : sinceLast >= this.timing.minGapMs || danger > this.lastDanger;
    };
    const sorted = [...assessments].sort((x, y) => dangerOf(y) - dangerOf(x));
    // While something is very close, talk about nothing else.
    const candidates = sorted[0]!.proximity === 'very-close' ? [sorted[0]!] : sorted;
    const primary = candidates.find(due);
    if (!primary) return undefined;
    const danger = dangerOf(primary);

    const priority = primary.proximity === 'very-close' || (primary.proximity === 'near' && primary.direction === 'ahead') ? 'urgent' : 'high';
    // An urgent warning stays as short as possible.
    const secondary = priority === 'urgent' ? undefined : assessments
      .filter((a) => a.trackId !== primary.trackId && a.direction !== primary.direction && !this.recentlyAnnounced(a, now))
      .sort((a, b) => dangerOf(b) - dangerOf(a))[0];

    for (const a of secondary ? [primary, secondary] : [primary]) {
      this.announced.set(a.trackId, { danger: dangerOf(a), at: now, seenAt: now });
    }
    this.lastAt = now;
    this.lastDanger = danger;
    return { primary, secondary, priority };
  }

  private recentlyAnnounced(a: ObstacleAssessment, now: number) {
    const memory = this.announced.get(a.trackId);
    return Boolean(memory && dangerOf(a) <= memory.danger && now - memory.at < this.timing.repeatMs[a.proximity]);
  }

  reset(): void {
    this.announced.clear();
    this.lastAt = Number.NEGATIVE_INFINITY;
    this.lastDanger = 0;
  }
}

type Gender = 'm' | 'f';
const NAMES: Record<string, { ar: string; g: Gender; en: string }> = {
  person: { ar: 'شخص', g: 'm', en: 'person' },
  bicycle: { ar: 'دراجة', g: 'f', en: 'bicycle' },
  motorcycle: { ar: 'دراجة نارية', g: 'f', en: 'motorcycle' },
  car: { ar: 'سيارة', g: 'f', en: 'car' },
  bus: { ar: 'حافلة', g: 'f', en: 'bus' },
  truck: { ar: 'شاحنة', g: 'f', en: 'truck' },
  bench: { ar: 'مقعد', g: 'm', en: 'bench' },
  chair: { ar: 'كرسي', g: 'm', en: 'chair' },
  'dining table': { ar: 'طاولة', g: 'f', en: 'table' },
  'potted plant': { ar: 'أصيص نبات', g: 'm', en: 'plant pot' },
  'fire hydrant': { ar: 'حنفية إطفاء', g: 'f', en: 'fire hydrant' },
  'parking meter': { ar: 'عداد موقف', g: 'm', en: 'parking meter' },
  'stop sign': { ar: 'إشارة قف', g: 'f', en: 'stop sign' },
  dog: { ar: 'كلب', g: 'm', en: 'dog' },
  cat: { ar: 'قطة', g: 'f', en: 'cat' },
  horse: { ar: 'حصان', g: 'm', en: 'horse' },
  sheep: { ar: 'خروف', g: 'm', en: 'sheep' },
  cow: { ar: 'بقرة', g: 'f', en: 'cow' },
};
/** An obstacle whose type is not clear is never given a guessed name. */
const OBSTACLE = { ar: 'عائق', g: 'm' as Gender, en: 'obstacle' };
const nameOf = (label?: string) => (label && NAMES[label]) || OBSTACLE;

const AR_DIRECTION: Record<Direction, string> = { ahead: 'أمامك', left: 'على يسارك', right: 'على يمينك' };
const EN_DIRECTION: Record<Direction, string> = { ahead: 'ahead', left: 'on your left', right: 'on your right' };
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The spoken sentence for an announcement: what, where, and roughly how close. Never metres. */
export function describeObstacles(announcement: ObstacleAnnouncement, locale: GuidanceLocale): string {
  const { primary, secondary } = announcement;
  const name = nameOf(primary.label);
  if (locale === 'ar') {
    const where = AR_DIRECTION[primary.direction];
    const f = name.g === 'f';
    const base = primary.proximity === 'very-close'
      ? `تحذير، يوجد ${name.ar} ${f ? 'قريبة جدًا' : 'قريب جدًا'} ${where}`
      : primary.approaching
      ? `انتبه، ${name.ar} ${f ? 'تقترب' : 'يقترب'} ${where}`
      : primary.proximity === 'near'
      ? `انتبه، ${name.ar} ${f ? 'قريبة' : 'قريب'} ${where}`
      : `يوجد ${name.ar} ${where}`;
    return secondary ? `${base} و${AR_DIRECTION[secondary.direction]} ${nameOf(secondary.label).ar}.` : `${base}.`;
  }
  const where = EN_DIRECTION[primary.direction];
  const base = primary.proximity === 'very-close'
    ? `Warning, ${name.en} very close ${where}`
    : primary.approaching
    ? `Careful, ${name.en} approaching ${where}`
    : primary.proximity === 'near'
    ? `Careful, ${name.en} close ${where}`
    : `${capitalize(name.en)} ${where}`;
  if (!secondary) return `${base}.`;
  const other = nameOf(secondary.label).en;
  return `${base}, and ${/^[aeiou]/.test(other) ? 'an' : 'a'} ${other} ${EN_DIRECTION[secondary.direction]}.`;
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
