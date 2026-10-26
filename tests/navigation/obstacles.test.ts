import { describe, expect, it } from 'vitest';
import { ObstacleTracker, iou, type Box, type FrameDetection, type ObstacleAssessment } from '@/utils/obstacles/tracker';
import { measureFrame, ReliabilityMonitor, frameProblem, toGray } from '@/utils/obstacles/quality';
import { WarningPolicy, describeObstacles, obstaclePhrases, statusAnnouncement, type ObstacleAnnouncement, type ObstacleStatus } from '@/utils/obstacles/warnings';
import { ObstacleAwarenessEngine, type ObstacleFrame } from '@/utils/obstacles/engine';
import { FramePacer } from '@/utils/obstacles/pacing';

/**
 * Obstacle awareness logic on SYNTHETIC detections. These check thresholds,
 * tracking, confirmation, priorities and cooldowns; they say nothing about how
 * well the real model detects obstacles — that is measured separately on
 * annotated images and still needs supervised tests on devices.
 */

const FRAME_MS = 200;
/** In the path, mid-distance. */
const ahead: Box = { x: 0.4, y: 0.4, width: 0.2, height: 0.3 };
/** In the path, tall enough to be near. */
const near: Box = { x: 0.35, y: 0.4, width: 0.3, height: 0.55 };
/** In the path, filling most of the frame. */
const huge: Box = { x: 0.25, y: 0.15, width: 0.5, height: 0.82 };
const rightNear: Box = { x: 0.72, y: 0.4, width: 0.26, height: 0.55 };
const leftAhead: Box = { x: 0.02, y: 0.45, width: 0.2, height: 0.3 };
const det = (label: string, box: Box, score = 0.75): FrameDetection => ({ label, score, box });
const person = (box: Box, score = 0.75) => det('person', box, score);
const good = { brightness: 120, contrast: 40, sharpness: 12 };

function feed(tracker: ObstacleTracker, frames: FrameDetection[][], start = 0) {
  return frames.map((detections, i) => tracker.update(detections, start + i * FRAME_MS));
}
const repeat = (n: number, detections: FrameDetection[]) => Array.from({ length: n }, () => detections);

describe('obstacle confirmation', () => {
  it('confirms a confident detection on its second frame by default', () => {
    const results = feed(new ObstacleTracker(), repeat(2, [person(ahead)]));
    expect(results[0]).toEqual([]);
    expect(results[1]).toMatchObject([{ label: 'person', direction: 'ahead', proximity: 'ahead', hits: 2 }]);
  });

  it('warns from the first frame when a very confident detection is close and straight ahead', () => {
    const [first] = feed(new ObstacleTracker(), [[person(near, 0.9)]]);
    expect(first).toMatchObject([{ proximity: 'near', direction: 'ahead', hits: 1 }]);
  });

  it('never calls an obstacle very close from a single frame', () => {
    const results = feed(new ObstacleTracker(), repeat(2, [person(huge, 0.95)]));
    expect(results[0]).toMatchObject([{ proximity: 'near' }]);
    expect(results[1]).toMatchObject([{ proximity: 'very-close' }]);
  });

  it('does not take the one-frame shortcut beside the path or for a smaller obstacle', () => {
    expect(feed(new ObstacleTracker(), [[person(rightNear, 0.95)]])[0]).toEqual([]);
    expect(feed(new ObstacleTracker(), [[person(ahead, 0.95)]])[0]).toEqual([]);
  });

  it('needs three frames for an uncertain detection', () => {
    const results = feed(new ObstacleTracker(), repeat(3, [person(near, 0.45)]));
    expect(results[0]).toEqual([]);
    expect(results[1]).toEqual([]);
    expect(results[2]).toHaveLength(1);
  });

  it('ignores detections below the score floor and classes it does not support', () => {
    expect(feed(new ObstacleTracker(), repeat(5, [person(near, 0.35)])).flat()).toEqual([]);
    expect(feed(new ObstacleTracker(), repeat(5, [det('cup', huge, 0.95)])).flat()).toEqual([]);
  });

  it('filters a one-frame false alarm', () => {
    expect(feed(new ObstacleTracker(), [[person(near, 0.7)], [], [], []]).flat()).toEqual([]);
  });
});

describe('obstacle tracking and position', () => {
  it('keeps one identity as an obstacle moves, so it is not announced twice', () => {
    const shifted = (dx: number): Box => ({ ...ahead, x: ahead.x + dx });
    const results = feed(new ObstacleTracker(), [0, 0.02, 0.04, 0.06].map((dx) => [person(shifted(dx))]));
    expect(results[1]![0]!.trackId).toBe(results[3]![0]!.trackId);
    expect(iou(shifted(0), shifted(0.02))).toBeGreaterThan(0.3);
  });

  it('keeps one identity when the model changes its mind about the type', () => {
    const results = feed(new ObstacleTracker(), [[det('car', near)], [det('truck', near)], [det('car', near)]]);
    expect(results[1]![0]!.trackId).toBe(results[2]![0]!.trackId);
  });

  it('says "obstacle" instead of guessing when the type is not clear', () => {
    const flipping = feed(new ObstacleTracker(), [[det('car', near)], [det('truck', near)], [det('bus', near)], [det('car', near)]]);
    expect(flipping.at(-1)![0]!.label).toBeUndefined();
    const unsure = feed(new ObstacleTracker(), repeat(3, [det('chair', near, 0.55)]));
    expect(unsure.at(-1)![0]!.label).toBeUndefined();
    expect(feed(new ObstacleTracker(), repeat(2, [det('chair', near, 0.8)])).at(-1)![0]!.label).toBe('chair');
  });

  it('survives a brief miss but drops a track that disappears', () => {
    const results = feed(new ObstacleTracker(), [[person(ahead)], [person(ahead)], [], [person(ahead)], [], [], [], [person(ahead)]]);
    expect(results[3]).toHaveLength(1);
    expect(results[7]).toEqual([]);
  });

  it('places obstacles left, ahead or right, and ignores far or side ones that are not near', () => {
    expect(feed(new ObstacleTracker(), repeat(2, [det('car', rightNear)])).at(-1)).toMatchObject([{ direction: 'right', proximity: 'near' }]);
    expect(feed(new ObstacleTracker(), repeat(2, [person(leftAhead)])).flat()).toEqual([]);
    const horizon: Box = { x: 0.45, y: 0.3, width: 0.1, height: 0.15 };
    expect(feed(new ObstacleTracker(), repeat(4, [person(horizon)])).flat()).toEqual([]);
  });

  it('notices an obstacle growing quickly as approaching, and raises its level', () => {
    const box = (w: number): Box => ({ x: 0.5 - w / 2, y: 0.5, width: w, height: w * 1.2 });
    const still = feed(new ObstacleTracker(), repeat(5, [person(box(0.32))]));
    expect(still.at(-1)).toMatchObject([{ proximity: 'ahead', approaching: false }]);
    const growing = feed(new ObstacleTracker(), [0.22, 0.25, 0.28, 0.32].map((w) => [person(box(w))]));
    expect(growing.at(-1)).toMatchObject([{ proximity: 'near', approaching: true }]);
  });

  it('lists the most dangerous obstacle first', () => {
    const results = feed(new ObstacleTracker(), repeat(2, [person(ahead), det('car', rightNear), det('chair', huge)]));
    expect(results.at(-1)!.map((a) => a.label)).toEqual(['chair', 'car', 'person']);
  });
});

const a = (overrides: Partial<ObstacleAssessment> = {}): ObstacleAssessment => ({
  trackId: 1, label: 'person', direction: 'ahead', proximity: 'ahead', approaching: false, score: 0.8, hits: 2, ...overrides,
});

describe('obstacle announcements', () => {
  it('announces a new obstacle at once and repeats it only after its interval', () => {
    const policy = new WarningPolicy();
    expect(policy.decide([a()], 0)?.primary.trackId).toBe(1);
    expect(policy.decide([a()], 3_000)).toBeUndefined();
    expect(policy.decide([a()], 12_000)?.primary.trackId).toBe(1);
  });

  it('repeats a very close obstacle more often than one further away', () => {
    const policy = new WarningPolicy();
    expect(policy.decide([a({ proximity: 'very-close' })], 0)).toBeDefined();
    expect(policy.decide([a({ proximity: 'very-close' })], 2_000)).toBeUndefined();
    expect(policy.decide([a({ proximity: 'very-close' })], 3_000)).toBeDefined();
  });

  it('speaks again straight away when an obstacle becomes more dangerous', () => {
    const policy = new WarningPolicy();
    expect(policy.decide([a()], 0)).toBeDefined();
    expect(policy.decide([a({ proximity: 'near' })], 300)).toMatchObject({ priority: 'urgent' });
    expect(policy.decide([a({ proximity: 'near', approaching: true })], 600)).toBeDefined();
    // Settling back down and up again within the interval is not news.
    expect(policy.decide([a({ proximity: 'near' })], 900)).toBeUndefined();
    expect(policy.decide([a({ proximity: 'near', approaching: true })], 1_200)).toBeUndefined();
  });

  it('spaces out new obstacles of the same danger, but not a more dangerous one', () => {
    const policy = new WarningPolicy();
    expect(policy.decide([a()], 0)).toBeDefined();
    expect(policy.decide([a(), a({ trackId: 2 })], 500)).toBeUndefined();
    expect(policy.decide([a(), a({ trackId: 2 })], 1_600)?.primary.trackId).toBe(2);
    expect(policy.decide([a({ trackId: 3, proximity: 'near' })], 1_700)?.primary.trackId).toBe(3);
  });

  it('picks the most dangerous obstacle and mentions one more in another direction', () => {
    const policy = new WarningPolicy();
    const chair = a({ trackId: 1, label: 'chair' });
    const side = a({ trackId: 2, direction: 'left', proximity: 'near' });
    const decision = policy.decide([chair, side], 0)!;
    expect(decision.primary.trackId).toBe(2);
    expect(decision.priority).toBe('high');
    expect(decision.secondary?.trackId).toBe(1);
  });

  it('keeps an urgent warning short', () => {
    const decision = new WarningPolicy().decide([a({ proximity: 'very-close' }), a({ trackId: 2, direction: 'left', proximity: 'near' })], 0)!;
    expect(decision.priority).toBe('urgent');
    expect(decision.secondary).toBeUndefined();
  });

  it('treats an obstacle that went away and came back as new', () => {
    const policy = new WarningPolicy();
    expect(policy.decide([a()], 0)).toBeDefined();
    expect(policy.decide([], 2_000)).toBeUndefined();
    expect(policy.decide([a()], 6_500)).toBeDefined();
  });

  it('stays silent when nothing is detected', () => {
    expect(new WarningPolicy().decide([], 0)).toBeUndefined();
  });
});

describe('spoken obstacle descriptions', () => {
  const say = (announcement: Partial<ObstacleAnnouncement> & { primary: ObstacleAssessment }, locale: 'ar' | 'en') =>
    describeObstacles({ priority: 'high', ...announcement }, locale);

  it('describes type, direction and closeness in Arabic', () => {
    expect(say({ primary: a() }, 'ar')).toBe('يوجد شخص أمامك.');
    expect(say({ primary: a({ label: 'car', direction: 'right', proximity: 'near' }) }, 'ar')).toBe('انتبه، سيارة قريبة على يمينك.');
    expect(say({ primary: a({ label: undefined, proximity: 'very-close' }) }, 'ar')).toBe('تحذير، يوجد عائق قريب جدًا أمامك.');
    expect(say({ primary: a({ label: 'chair' }), secondary: a({ trackId: 2, direction: 'left' }) }, 'ar')).toBe('يوجد كرسي أمامك وعلى يسارك شخص.');
    expect(say({ primary: a({ label: 'car', proximity: 'near', approaching: true }) }, 'ar')).toBe('انتبه، سيارة تقترب أمامك.');
  });

  it('describes the same in English', () => {
    expect(say({ primary: a() }, 'en')).toBe('Person ahead.');
    expect(say({ primary: a({ label: 'car', direction: 'right', proximity: 'near' }) }, 'en')).toBe('Careful, car close on your right.');
    expect(say({ primary: a({ label: undefined, proximity: 'very-close' }) }, 'en')).toBe('Warning, obstacle very close ahead.');
    expect(say({ primary: a({ label: 'chair' }), secondary: a({ trackId: 2, direction: 'left', label: undefined }) }, 'en')).toBe('Chair ahead, and an obstacle on your left.');
  });

  it('never gives distances or says the way is clear', () => {
    const all: string[] = [];
    for (const proximity of ['ahead', 'near', 'very-close'] as const) {
      for (const direction of ['left', 'ahead', 'right'] as const) {
        for (const locale of ['ar', 'en'] as const) all.push(say({ primary: a({ proximity, direction, label: 'car' }) }, locale));
      }
    }
    all.push(...Object.values(obstaclePhrases).flatMap((phrase) => [phrase('en'), phrase('ar')]));
    const text = all.join(' ');
    expect(text).not.toMatch(/\bclear\b|\bsafe to\b|step (?:left|right)|خالٍ|آمن للمرور/i);
    expect(text).not.toMatch(/\d+\s*(?:m\b|metres|meters|متر)/i);
  });
});

describe('frame pacing', () => {
  it('rests half the inference time between frames', () => {
    expect(new FramePacer().next(200)).toBe(100);
    expect(new FramePacer().next(4)).toBe(10);
    expect(new FramePacer().next(3_000)).toBe(700);
  });

  it('rests longer on low battery', () => {
    expect(new FramePacer(true).next(200)).toBe(300);
  });

  it('backs off when inference slows down, as on a hot device, and recovers', () => {
    const pacer = new FramePacer();
    for (let i = 0; i < 20; i++) pacer.next(200);
    for (let i = 0; i < 6; i++) pacer.next(400);
    expect(pacer.throttled).toBe(true);
    expect(pacer.next(400)).toBe(600);
    for (let i = 0; i < 10; i++) pacer.next(210);
    expect(pacer.throttled).toBe(false);
  });
});

describe('camera reliability', () => {
  it('measures brightness, contrast and sharpness of a frame', () => {
    const flat = measureFrame(new Uint8Array(64 * 48).fill(128), 64, 48);
    expect(flat).toMatchObject({ brightness: 128, contrast: 0, sharpness: 0 });
    const checker = Uint8Array.from({ length: 64 * 48 }, (_, i) => ((i % 64) + Math.floor(i / 64)) % 2 ? 255 : 0);
    expect(measureFrame(checker, 64, 48).sharpness).toBeGreaterThan(100);
    expect(Array.from(toGray([255, 255, 255, 255, 0, 0, 0, 255]))).toEqual([255, 0]);
  });

  it('names what is wrong with a frame', () => {
    expect(frameProblem({ ...good, brightness: 10 }, 50)).toBe('dark');
    expect(frameProblem({ ...good, contrast: 3 }, 50)).toBe('obscured');
    expect(frameProblem({ ...good, sharpness: 1 }, 50)).toBe('blurred');
    expect(frameProblem(good, 2_000)).toBe('slow');
    expect(frameProblem(good, 50)).toBeUndefined();
  });

  it('only reports a lasting problem, and recovery only once it is stable', () => {
    const monitor = new ReliabilityMonitor();
    monitor.reset(0);
    expect(monitor.frame('dark', 0).reliable).toBe(true);
    expect(monitor.frame('dark', 600).reliable).toBe(true);
    expect(monitor.frame('dark', 1_200)).toEqual({ reliable: false, reason: 'dark' });
    expect(monitor.frame(undefined, 1_400).reliable).toBe(false);
    expect(monitor.frame(undefined, 3_400).reliable).toBe(true);
  });

  it('notices when frames stop arriving', () => {
    const monitor = new ReliabilityMonitor();
    monitor.reset(0);
    monitor.frame(undefined, 0);
    expect(monitor.tick(1_000).reliable).toBe(true);
    expect(monitor.tick(2_600)).toEqual({ reliable: false, reason: 'stalled' });
  });
});

describe('monitoring status announcements', () => {
  const s = (status: ObstacleStatus) => status;
  it('announces start, loss and recovery', () => {
    expect(statusAnnouncement(s({ state: 'starting' }), s({ state: 'active' }), 'en')).toEqual({ text: obstaclePhrases.on('en'), priority: 'normal' });
    expect(statusAnnouncement(s({ state: 'active' }), s({ state: 'unreliable', reason: 'dark' }), 'ar')).toEqual({ text: obstaclePhrases.unreliable('ar'), priority: 'urgent' });
    expect(statusAnnouncement(s({ state: 'unreliable', reason: 'dark' }), s({ state: 'unreliable', reason: 'blurred' }), 'en')).toBeUndefined();
    expect(statusAnnouncement(s({ state: 'active' }), s({ state: 'unavailable', reason: 'camera-error' }), 'en')).toEqual({ text: obstaclePhrases.stopped('en'), priority: 'urgent' });
    expect(statusAnnouncement(s({ state: 'unavailable', reason: 'background' }), s({ state: 'active' }), 'en')).toEqual({ text: obstaclePhrases.restored('en'), priority: 'normal' });
  });

  it('explains why it cannot start', () => {
    expect(statusAnnouncement(s({ state: 'starting' }), s({ state: 'unavailable', reason: 'unsupported' }), 'en')?.text).toBe(obstaclePhrases.unsupported('en'));
    expect(statusAnnouncement(s({ state: 'starting' }), s({ state: 'unavailable', reason: 'permission-denied' }), 'ar')?.text).toBe(obstaclePhrases.permissionDenied('ar'));
    expect(statusAnnouncement(s({ state: 'starting' }), s({ state: 'unavailable', reason: 'model-error' }), 'en')).toEqual({ text: obstaclePhrases.failed('en'), priority: 'high' });
    // Nothing can be heard in the background.
    expect(statusAnnouncement(s({ state: 'active' }), s({ state: 'unavailable', reason: 'background' }), 'en')).toBeUndefined();
  });
});

describe('obstacle awareness engine', () => {
  const frame = (at: number, detections: FrameDetection[], quality = good, inferenceMs = 60): ObstacleFrame => ({ at, detections, quality, inferenceMs });

  it('warns on the second frame, then again as the person comes close', () => {
    const engine = new ObstacleAwarenessEngine();
    engine.reset(0);
    const outputs = [
      ...Array.from({ length: 4 }, (_, i) => engine.frame(frame(i * FRAME_MS, [person(ahead)]))),
      ...Array.from({ length: 3 }, (_, i) => engine.frame(frame(800 + i * FRAME_MS, [person(huge)]))),
    ];
    const spoken = outputs.map((o) => o.warning && describeObstacles(o.warning, 'en'));
    expect(spoken[0]).toBeUndefined();
    expect(spoken[1]).toBe('Person ahead.');
    expect(spoken.filter(Boolean)).toEqual(['Person ahead.', 'Warning, person very close ahead.']);
    expect(outputs.find((o) => o.warning?.primary.proximity === 'very-close')!.warning!.priority).toBe('urgent');
  });

  it('reports a dark camera instead of silence', () => {
    const engine = new ObstacleAwarenessEngine();
    engine.reset(0);
    const dark = { brightness: 5, contrast: 2, sharpness: 0 };
    const outputs = Array.from({ length: 8 }, (_, i) => engine.frame(frame(i * FRAME_MS, [], dark)));
    expect(outputs.at(-1)!.reliability).toEqual({ reliable: false, reason: 'dark' });
    expect(outputs.every((o) => !o.warning)).toBe(true);
  });

  it('starts fresh after a camera restart', () => {
    const engine = new ObstacleAwarenessEngine();
    engine.reset(0);
    for (let i = 0; i < 3; i++) engine.frame(frame(i * FRAME_MS, [person(ahead)]));
    engine.reset(5_000);
    expect(engine.frame(frame(5_000, [person(ahead)])).warning).toBeUndefined();
    expect(engine.frame(frame(5_200, [person(ahead)])).warning).toBeDefined();
  });
});
