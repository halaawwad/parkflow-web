import { describe, expect, it } from 'vitest';
import { ObstacleTracker, TRACKING, iou, type Box, type CameraShift, type FrameDetection, type ObstacleAssessment } from '@/utils/obstacles/tracker';
import { estimateShift, measureFrame, ReliabilityMonitor, frameProblem, toGray } from '@/utils/obstacles/quality';
import { WarningPolicy, describeObstacles, obstaclePhrases, statusAnnouncement, type ObstacleAnnouncement, type ObstacleStatus } from '@/utils/obstacles/warnings';
import { ObstacleAwarenessEngine, type ObstacleFrame } from '@/utils/obstacles/engine';
import { FramePacer } from '@/utils/obstacles/pacing';
import { WarningTimings } from '@/utils/obstacles/timing';

/**
 * Obstacle awareness logic on SYNTHETIC detections. These check thresholds,
 * tracking, confirmation, warning timing and priorities; they say nothing
 * about how well the real model sees obstacles — that is measured separately
 * on annotated footage and still needs supervised tests on a phone.
 */

const FRAME_MS = 200;
/** In the path, mid-distance. */
const ahead: Box = { x: 0.4, y: 0.4, width: 0.2, height: 0.4 };
/** In the path, tall enough to count as close. */
const close: Box = { x: 0.3, y: 0.3, width: 0.4, height: 0.65 };
/** Beside the path on the right, large. */
const peripheral: Box = { x: 0.8, y: 0.3, width: 0.18, height: 0.65 };
const det = (label: string, box: Box, score = 0.75): FrameDetection => ({ label, score, box });
const person = (box: Box, score = 0.75) => det('person', box, score);
const good = { brightness: 120, contrast: 40, sharpness: 12 };

function feed(tracker: ObstacleTracker, frames: FrameDetection[][], { start = 0, step = FRAME_MS, shift }: { start?: number; step?: number; shift?: CameraShift } = {}) {
  return frames.map((detections, i) => tracker.update(detections, start + i * step, shift));
}
const repeat = (n: number, detections: FrameDetection[]) => Array.from({ length: n }, () => detections);
/** A box of side `size` (square-ish, grows downward and outward from the middle), as an approaching person. */
const centred = (size: number): Box => ({ x: 0.5 - size / 2, y: 0.55 - size / 2, width: size, height: size * 1.1 });

describe('confirmation and false positives', () => {
  it('stays silent on an empty scene', () => {
    expect(feed(new ObstacleTracker(), repeat(10, [])).flat()).toEqual([]);
  });

  it('needs two consistent frames for an ordinary detection', () => {
    const results = feed(new ObstacleTracker(), repeat(2, [person(ahead)]));
    expect(results[0]).toEqual([]);
    expect(results[1]).toMatchObject([{ label: 'person', direction: 'center', level: 'early', hits: 2 }]);
  });

  it('needs three frames for an uncertain detection', () => {
    const results = feed(new ObstacleTracker(), repeat(3, [person(ahead, 0.5)]));
    expect(results.slice(0, 2).flat()).toEqual([]);
    expect(results[2]).toHaveLength(1);
  });

  it('is urgent from one frame only for a very confident, close obstacle straight ahead', () => {
    expect(feed(new ObstacleTracker(), [[person(close, 0.9)]])[0]).toMatchObject([{ level: 'urgent', hits: 1 }]);
    expect(feed(new ObstacleTracker(), [[person(close, 0.8)]])[0]).toEqual([]);
    expect(feed(new ObstacleTracker(), [[person(ahead, 0.95)]])[0]).toEqual([]);
  });

  it('filters a one-frame false alarm', () => {
    expect(feed(new ObstacleTracker(), [[person(close, 0.7)], [], [], []]).flat()).toEqual([]);
  });

  it('does not confirm a box whose size jumps between frames', () => {
    const results = feed(new ObstacleTracker(), [[person(ahead)], [person({ ...ahead, x: 0.35, width: 0.32, height: 0.5 })]]);
    expect(results.flat()).toEqual([]);
  });

  it('holds less precise classes and small boxes to a higher score', () => {
    expect(feed(new ObstacleTracker(), repeat(4, [det('dining table', ahead, 0.45)])).flat()).toEqual([]);
    expect(feed(new ObstacleTracker(), repeat(4, [person(ahead, 0.45)])).at(-1)).toHaveLength(1);
    const small: Box = { x: 0.45, y: 0.4, width: 0.12, height: 0.2 };
    expect(feed(new ObstacleTracker(), repeat(4, [person(small, 0.45)])).flat()).toEqual([]);
    expect(feed(new ObstacleTracker(), repeat(4, [det('cup', close, 0.95)])).flat()).toEqual([]);
  });

  it('says "obstacle" instead of guessing when the type is not clear', () => {
    const flipping = feed(new ObstacleTracker(), [[det('car', ahead)], [det('truck', ahead)], [det('bus', ahead)], [det('car', ahead)]]);
    expect(flipping.at(-1)![0]!.label).toBeUndefined();
    expect(feed(new ObstacleTracker(), repeat(2, [det('chair', ahead, 0.8)])).at(-1)![0]!.label).toBe('chair');
  });
});

describe('walking corridor', () => {
  it('ignores a large obstacle beside the path that is not moving into it', () => {
    expect(feed(new ObstacleTracker(), repeat(8, [det('car', peripheral)])).flat()).toEqual([]);
  });

  it('gives no early warning for a short, far obstacle that is not closing in', () => {
    const far: Box = { x: 0.42, y: 0.5, width: 0.16, height: 0.25 };
    expect(feed(new ObstacleTracker(), repeat(5, [person(far)])).flat()).toEqual([]);
  });

  it('ignores far-off obstacles near the horizon', () => {
    const horizon: Box = { x: 0.45, y: 0.25, width: 0.1, height: 0.2 };
    expect(feed(new ObstacleTracker(), repeat(5, [person(horizon)])).flat()).toEqual([]);
  });

  it('places in-path obstacles straight ahead or ahead to one side', () => {
    expect(feed(new ObstacleTracker(), repeat(2, [person({ ...ahead, x: 0.52 })])).at(-1)).toMatchObject([{ direction: 'right' }]);
    expect(feed(new ObstacleTracker(), repeat(2, [person({ ...ahead, x: 0.22 })])).at(-1)).toMatchObject([{ direction: 'left' }]);
  });

  it('reports someone stepping sideways into the path before they are in it', () => {
    // Still fully beside the corridor (it starts at 0.75), but moving towards it.
    const results = feed(new ObstacleTracker(), [0.92, 0.89, 0.86, 0.83].map((x) => [person({ x, y: 0.4, width: 0.12, height: 0.4 })]));
    expect(results.at(-1)).toMatchObject([{ crossing: true, direction: 'right' }]);
  });

  it('ignores someone in the path who is stepping out of it', () => {
    const results = feed(new ObstacleTracker(), [0.55, 0.6, 0.65, 0.7].map((x) => [person({ x, y: 0.4, width: 0.14, height: 0.4 })]));
    expect(results.at(-1)).toEqual([]);
  });

  it('does not tell the walker to stop for someone close who is walking away', () => {
    // Tall enough to count as close in every frame; only the steady shrinking says it is leaving.
    const shrinking = [0.5, 0.47, 0.44, 0.41, 0.38].map((s) => [person({ x: 0.5 - s / 2, y: 0.97 - 1.6 * s, width: s, height: 1.6 * s })]);
    const results = feed(new ObstacleTracker(), shrinking);
    expect(shrinking.at(-1)![0]!.box.height).toBeGreaterThanOrEqual(TRACKING.urgentHeight);
    expect(results.at(-1)).toMatchObject([{ level: 'early' }]);
    const still = feed(new ObstacleTracker(), repeat(5, [person(close)]));
    expect(still.at(-1)).toMatchObject([{ level: 'urgent' }]);
  });

  it('does not mistake the camera swinging for someone crossing', () => {
    // The person stays put in the world; the picture slides because the camera turns.
    const shift: CameraShift = { dx: -0.06, dy: 0 };
    const results = feed(new ObstacleTracker(), [0.98, 0.92, 0.86, 0.8].map((x) => [person({ x, y: 0.4, width: 0.12, height: 0.4 })]), { shift });
    expect(results.flat()).toEqual([]);
  });

  it('measures the camera shift between two frames', () => {
    const w = 64, h = 48;
    // Seeded noise: no repeating pattern, so only the true offset matches.
    let seed = 7;
    const noise = Array.from({ length: (w + 8) * h }, () => ((seed = (seed * 1103515245 + 12345) % 2147483648) >> 16) & 255);
    const scene = (offset: number) => Uint8Array.from({ length: w * h }, (_, i) => noise[Math.floor(i / w) * (w + 8) + (i % w) - offset + 8]!);
    expect(estimateShift(scene(0), scene(2), w, h)).toEqual({ dx: 2 / w, dy: 0 });
    expect(estimateShift(new Uint8Array(w * h).fill(90), new Uint8Array(w * h).fill(90), w, h)).toEqual({ dx: 0, dy: 0 });
  });
});

describe('approaching obstacles', () => {
  /** Box size of something 6 m away when walking towards it at 1.3 m/s: size ∝ 1 / distance. */
  const walkingTowards = (frames: number) => Array.from({ length: frames }, (_, i) => 1.2 / (6 - 1.3 * i * (FRAME_MS / 1000)));

  it('estimates time to contact from steady growth and warns urgently in time', () => {
    const sizes = walkingTowards(14);
    const results = feed(new ObstacleTracker(), sizes.map((s) => [person(centred(s))]));
    const last = results.at(-1)![0]!;
    const trueTau = (6 - 1.3 * 13 * (FRAME_MS / 1000)) / 1.3;
    expect(last.approaching).toBe(true);
    expect(Math.abs(last.tau! - trueTau) / trueTau).toBeLessThan(0.3);
    // Urgent once tau falls inside latency + speech + reaction, before the box alone looks close.
    const urgentAt = results.findIndex((r) => r[0]?.level === 'urgent');
    expect(urgentAt).toBeGreaterThan(-1);
    expect(sizes[urgentAt]! * 1.1).toBeLessThan(TRACKING.urgentHeight);
  });

  it('allows for a slow device by warning earlier', () => {
    const sizes = walkingTowards(14);
    const fast = new ObstacleTracker();
    const slow = new ObstacleTracker();
    slow.setLatency(1.5);
    const first = (tracker: ObstacleTracker) => feed(tracker, sizes.map((s) => [person(centred(s))])).findIndex((r) => r[0]?.level === 'urgent');
    expect(first(slow)).toBeGreaterThan(-1);
    expect(first(slow)).toBeLessThan(first(fast));
  });

  it('gives no time to contact when the growth is noisy', () => {
    const noisy = [0.2, 0.26, 0.21, 0.27, 0.22, 0.28, 0.23];
    const last = feed(new ObstacleTracker(), noisy.map((s) => [person(centred(s))])).at(-1)!;
    expect(last.every((a) => a.tau === undefined)).toBe(true);
  });

  it('gives no time to contact while the camera swings, or when the box is cut off', () => {
    const sizes = Array.from({ length: 8 }, (_, i) => 0.2 * (1 + 0.05 * i));
    const swinging = feed(new ObstacleTracker(), sizes.map((s) => [person(centred(s))]), { shift: { dx: 0.05, dy: 0.02 } }).at(-1)!;
    expect(swinging.every((a) => a.tau === undefined)).toBe(true);
    const cut = feed(new ObstacleTracker(), sizes.map((s) => [person({ ...centred(s), y: 0 })])).at(-1)!;
    expect(cut.every((a) => a.tau === undefined)).toBe(true);
  });
});

const a = (overrides: Partial<ObstacleAssessment> = {}): ObstacleAssessment => ({
  trackId: 1, label: 'person', direction: 'center', level: 'early', approaching: false, crossing: false, box: ahead, score: 0.8, hits: 2, firstSeenAt: 0, ...overrides,
});

describe('warning decisions', () => {
  it('gives each obstacle one early warning and does not repeat it', () => {
    const policy = new WarningPolicy();
    const said = Array.from({ length: 150 }, (_, i) => policy.decide([a()], i * FRAME_MS)).filter(Boolean);
    expect(said).toEqual([expect.objectContaining({ level: 'early', priority: 'high' })]);
  });

  it('warns urgently at once, even right after an early warning, and repeats while urgent', () => {
    const policy = new WarningPolicy();
    expect(policy.decide([a()], 0)?.level).toBe('early');
    expect(policy.decide([a({ level: 'urgent' })], 200)).toMatchObject({ level: 'urgent', priority: 'urgent' });
    expect(policy.decide([a({ level: 'urgent' })], 4_000)).toBeUndefined();
    expect(policy.decide([a({ level: 'urgent' })], 6_200)?.level).toBe('urgent');
  });

  it('spaces out early warnings and holds them back briefly after an urgent one', () => {
    const policy = new WarningPolicy();
    expect(policy.decide([a()], 0)).toBeDefined();
    expect(policy.decide([a(), a({ trackId: 2 })], 500)).toBeUndefined();
    expect(policy.decide([a(), a({ trackId: 2 })], 900)?.obstacle.trackId).toBe(2);
    expect(policy.decide([a({ trackId: 3, level: 'urgent' }), a({ trackId: 4 })], 5_000)?.obstacle.trackId).toBe(3);
    // Just after the urgent warning, early news waits so the urgent words are heard...
    expect(policy.decide([a({ trackId: 3, level: 'urgent' }), a({ trackId: 4 })], 5_400)).toBeUndefined();
    // ...but not for as long as something stays urgent (in a crowd that can be never).
    expect(policy.decide([a({ trackId: 3, level: 'urgent' }), a({ trackId: 4 })], 5_700)?.obstacle.trackId).toBe(4);
  });

  it('treats an obstacle that went away and came back as new', () => {
    const policy = new WarningPolicy();
    expect(policy.decide([a()], 0)).toBeDefined();
    expect(policy.decide([], 2_000)).toBeUndefined();
    expect(policy.decide([a()], 6_500)).toBeDefined();
  });

  it('stays silent when nothing is in the path', () => {
    expect(new WarningPolicy().decide([], 0)).toBeUndefined();
  });
});

describe('spoken warnings', () => {
  const say = (announcement: Pick<ObstacleAnnouncement, 'level' | 'obstacle'>, locale: 'ar' | 'en') =>
    describeObstacles({ priority: announcement.level === 'urgent' ? 'urgent' : 'high', ...announcement }, locale);

  it('uses the short Arabic sentences', () => {
    expect(say({ level: 'early', obstacle: a() }, 'ar')).toBe('انتبه، شخص أمامك.');
    expect(say({ level: 'urgent', obstacle: a() }, 'ar')).toBe('توقف، عائق أمامك.');
    expect(say({ level: 'early', obstacle: a({ label: undefined, direction: 'right' }) }, 'ar')).toBe('انتبه، عائق أمامك جهة اليمين.');
  });

  it('has the same in English', () => {
    expect(say({ level: 'early', obstacle: a() }, 'en')).toBe('Careful, person ahead.');
    expect(say({ level: 'urgent', obstacle: a({ direction: 'left' }) }, 'en')).toBe('Stop, obstacle ahead to the left.');
  });

  it('never gives distances or times, or says the way is clear', () => {
    const text = [
      ...(['early', 'urgent'] as const).flatMap((level) => (['left', 'center', 'right'] as const).flatMap((direction) =>
        (['ar', 'en'] as const).map((locale) => say({ level, obstacle: a({ direction, tau: 2.4 }) }, locale)))),
      ...Object.values(obstaclePhrases).flatMap((phrase) => [phrase('en'), phrase('ar')]),
    ].join(' ');
    expect(text).not.toMatch(/\bclear\b|\bsafe to\b|step (?:left|right)|خالٍ|آمن للمرور/i);
    expect(text).not.toMatch(/\d/);
  });
});

describe('warning timings', () => {
  it('splits detection, speech start-up and total delay', () => {
    const timings = new WarningTimings();
    timings.record({ firstSeenAt: 1_000, frameAt: 1_200, decidedAt: 1_350, speechAt: 1_500 });
    timings.record({ firstSeenAt: 2_000, frameAt: 2_200, decidedAt: 2_400, speechAt: 2_700 });
    expect(timings.summary()).toMatchObject({ samples: 2 });
    expect(timings.summary().detectionMs).toBe(400);
    expect(timings.summary().speechStartMs).toBe(300);
    expect(timings.summary().totalMs).toBe(700);
    expect(timings.latencySeconds()).toBe(0.5);
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

  it('warns early on the second frame, then urgently as the person comes close', () => {
    const engine = new ObstacleAwarenessEngine();
    engine.reset(0);
    const outputs = [
      ...Array.from({ length: 3 }, (_, i) => engine.frame(frame(i * FRAME_MS, [person(ahead)]))),
      ...Array.from({ length: 3 }, (_, i) => engine.frame(frame(600 + i * FRAME_MS, [person(close)]))),
    ];
    expect(outputs[0]!.warning).toBeUndefined();
    const spoken = outputs.flatMap((o) => (o.warning ? [describeObstacles(o.warning, 'ar')] : []));
    expect(spoken).toEqual(['انتبه، شخص أمامك.', 'توقف، عائق أمامك.']);
  });

  it('says a waiting warning is out of date once the obstacle has gone', () => {
    const engine = new ObstacleAwarenessEngine();
    engine.reset(0);
    engine.frame(frame(0, [person(ahead)]));
    const warning = engine.frame(frame(200, [person(ahead)])).warning!;
    expect(engine.isRelevant(warning.obstacle.trackId, 'early')).toBe(true);
    expect(engine.isRelevant(warning.obstacle.trackId, 'urgent')).toBe(false);
    engine.frame(frame(400, []));
    expect(engine.isRelevant(warning.obstacle.trackId, 'early')).toBe(false);
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
