import type { GuidanceLocale } from '@/utils/navigation/instructions';
import type { ObstacleAssessment, Proximity } from './tracker';
import type { Unreliability } from './quality';

/**
 * When to speak about obstacles. Few, short warnings: a warning for every
 * visible object would drown out the route. Nothing here ever says the way is
 * clear or suggests a direction to step in — the camera cannot see enough to
 * promise that (walls, holes, curbs and stairs are not detected).
 */

export const WARNING_TIMING = {
  /** A close obstacle is repeated at most this often while it stays close. */
  nearCooldownMs: 4_000,
  /** Gap between "obstacle ahead" warnings. */
  aheadCooldownMs: 8_000,
  /** The same tracked obstacle is not announced as "ahead" again within this. */
  trackRepeatMs: 20_000,
};
export type WarningTiming = typeof WARNING_TIMING;

export class WarningPolicy {
  private lastNearAt = Number.NEGATIVE_INFINITY;
  private lastAheadAt = Number.NEGATIVE_INFINITY;
  private warnedAt = new Map<number, number>();

  constructor(private readonly timing: WarningTiming = WARNING_TIMING) {}

  /** The warning to speak for this frame, if any. */
  decide(assessments: ObstacleAssessment[], now: number): Proximity | undefined {
    for (const [id, at] of this.warnedAt) if (now - at > this.timing.trackRepeatMs) this.warnedAt.delete(id);
    const near = assessments.filter((a) => a.proximity === 'near');
    if (near.length) {
      // Inside the cooldown stay quiet rather than downgrade a close obstacle to "ahead".
      if (now - this.lastNearAt < this.timing.nearCooldownMs) return undefined;
      this.lastNearAt = now;
      this.lastAheadAt = now;
      for (const a of assessments) this.warnedAt.set(a.trackId, now);
      return 'near';
    }
    const fresh = assessments.filter((a) => !this.warnedAt.has(a.trackId));
    if (!fresh.length || now - this.lastAheadAt < this.timing.aheadCooldownMs) return undefined;
    this.lastAheadAt = now;
    for (const a of assessments) this.warnedAt.set(a.trackId, now);
    return 'ahead';
  }

  reset(): void {
    this.lastNearAt = Number.NEGATIVE_INFINITY;
    this.lastAheadAt = Number.NEGATIVE_INFINITY;
    this.warnedAt.clear();
  }
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
  ahead: (locale: GuidanceLocale) => (locale === 'ar' ? 'انتبه، يوجد عائق أمامك.' : 'Careful, obstacle ahead.'),
  near: (locale: GuidanceLocale) => (locale === 'ar' ? 'توقف، يوجد عائق قريب أمامك.' : 'Stop. Obstacle close ahead.'),
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

export type AnnouncementPriority = 'normal' | 'high' | 'urgent';

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
