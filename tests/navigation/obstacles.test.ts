import { describe, expect, it } from 'vitest';
import { ObstacleTracker, iou, type Box, type FrameDetection } from '@/utils/obstacles/tracker';
import { measureFrame, ReliabilityMonitor, frameProblem, toGray } from '@/utils/obstacles/quality';
import { WarningPolicy, obstaclePhrases, statusAnnouncement, type ObstacleStatus } from '@/utils/obstacles/warnings';
import { ObstacleAwarenessEngine, type ObstacleFrame } from '@/utils/obstacles/engine';

/**
 * Obstacle awareness logic on SYNTHETIC detections. These check thresholds,
 * tracking, cooldowns and failure handling; they say nothing about how well
 * the real model detects obstacles — that needs annotated footage and
 * supervised tests on devices.
 */

const FRAME_MS = 200;
const ahead: Box = { x: 0.4, y: 0.4, width: 0.2, height: 0.3 };
const close: Box = { x: 0.3, y: 0.25, width: 0.4, height: 0.7 };
const person = (box: Box, score = 0.8): FrameDetection => ({ label: 'person', score, box });
const good = { brightness: 120, contrast: 40, sharpness: 12 };

function feed(tracker: ObstacleTracker, frames: FrameDetection[][], start = 0) {
  return frames.map((detections, i) => tracker.update(detections, start + i * FRAME_MS));
}

describe('obstacle tracking', () => {
  it('reports an obstacle only after it is seen in several frames', () => {
    const results = feed(new ObstacleTracker(), [[person(ahead)], [person(ahead)], [person(ahead)]]);
    expect(results[0]).toEqual([]);
    expect(results[1]).toEqual([]);
    expect(results[2]).toMatchObject([{ label: 'person', proximity: 'ahead' }]);
  });

  it('ignores low-confidence detections', () => {
    const results = feed(new ObstacleTracker(), Array.from({ length: 6 }, () => [person(ahead, 0.4)]));
    expect(results.flat()).toEqual([]);
  });

  it('ignores classes it does not support', () => {
    const cup = { label: 'cup', score: 0.95, box: close };
    const results = feed(new ObstacleTracker(), Array.from({ length: 6 }, () => [cup]));
    expect(results.flat()).toEqual([]);
  });

  it('filters a one-frame false alarm', () => {
    const results = feed(new ObstacleTracker(), [[person(close)], [], [], [], []]);
    expect(results.flat()).toEqual([]);
  });

  it('follows one obstacle as it moves, keeping its identity', () => {
    const tracker = new ObstacleTracker();
    const shifted = (dx: number): Box => ({ ...ahead, x: ahead.x + dx });
    const results = feed(tracker, [[person(shifted(0))], [person(shifted(0.02))], [person(shifted(0.04))], [person(shifted(0.06))]]);
    expect(results[2]![0]!.trackId).toBe(results[3]![0]!.trackId);
    expect(iou(shifted(0), shifted(0.02))).toBeGreaterThan(0.3);
  });

  it('survives a brief miss but drops a track that disappears', () => {
    const tracker = new ObstacleTracker();
    const results = feed(tracker, [[person(ahead)], [person(ahead)], [], [person(ahead)], [], [], [], [person(ahead)]]);
    expect(results[3]).toHaveLength(1);
    expect(results[7]).toEqual([]);
  });

  it('ignores obstacles outside the walking corridor or far away', () => {
    const side: Box = { x: 0, y: 0.4, width: 0.2, height: 0.5 };
    const horizon: Box = { x: 0.45, y: 0.3, width: 0.1, height: 0.15 };
    const results = feed(new ObstacleTracker(), Array.from({ length: 4 }, () => [person(side), person(horizon)]));
    expect(results.flat()).toEqual([]);
  });

  it('rates a large box, or one growing fast, as close', () => {
    expect(feed(new ObstacleTracker(), Array.from({ length: 3 }, () => [person(close)]))[2]).toMatchObject([{ proximity: 'near' }]);
    // Never taller than the "close" height: only the growth makes it close.
    const box = (w: number): Box => ({ x: 0.5 - w / 2, y: 0.4, width: w, height: w * 1.5 });
    const still = feed(new ObstacleTracker(), Array.from({ length: 5 }, () => [person(box(0.36))]));
    expect(still.at(-1)).toMatchObject([{ proximity: 'ahead' }]);
    const growing = feed(new ObstacleTracker(), [0.26, 0.28, 0.31, 0.33, 0.36].map((w) => [person(box(w))]));
    expect(growing.at(-1)).toMatchObject([{ proximity: 'near' }]);
  });
});

describe('obstacle warnings', () => {
  const at = (proximity: 'ahead' | 'near', trackId = 1) => [{ trackId, label: 'person', proximity, score: 0.8 }];

  it('warns once for an obstacle ahead, then waits', () => {
    const policy = new WarningPolicy();
    expect(policy.decide(at('ahead'), 0)).toBe('ahead');
    expect(policy.decide(at('ahead'), 1_000)).toBeUndefined();
    expect(policy.decide(at('ahead'), 10_000)).toBeUndefined();
    expect(policy.decide(at('ahead', 2), 10_000)).toBe('ahead');
  });

  it('repeats a close obstacle only after its cooldown', () => {
    const policy = new WarningPolicy();
    expect(policy.decide(at('near'), 0)).toBe('near');
    expect(policy.decide(at('near'), 2_000)).toBeUndefined();
    expect(policy.decide(at('near'), 4_000)).toBe('near');
  });

  it('escalates an obstacle from ahead to close straight away', () => {
    const policy = new WarningPolicy();
    expect(policy.decide(at('ahead'), 0)).toBe('ahead');
    expect(policy.decide(at('near'), 500)).toBe('near');
  });

  it('says nothing when nothing is in the way, and never that the way is clear', () => {
    expect(new WarningPolicy().decide([], 0)).toBeUndefined();
    const sentences = Object.values(obstaclePhrases).flatMap((phrase) => [phrase('en'), phrase('ar')]).join(' ');
    expect(sentences).not.toMatch(/\bclear\b|\bsafe to\b|step (?:left|right)|on your (?:left|right)/i);
    expect(sentences).not.toMatch(/\d+\s*(?:m|metres|meters|متر)/i);
  });

  it('has the Arabic warnings', () => {
    expect(obstaclePhrases.ahead('ar')).toBe('انتبه، يوجد عائق أمامك.');
    expect(obstaclePhrases.near('ar')).toBe('توقف، يوجد عائق قريب أمامك.');
    expect(obstaclePhrases.unreliable('ar')).toBe('لا أستطيع التأكد من سلامة الطريق أمامك. توقف وتحقق من المسار.');
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

  it('turns a person walking into the path into one warning, then a close warning', () => {
    const engine = new ObstacleAwarenessEngine();
    engine.reset(0);
    const warnings = [
      ...Array.from({ length: 5 }, (_, i) => engine.frame(frame(i * FRAME_MS, [person(ahead)])).warning),
      ...Array.from({ length: 4 }, (_, i) => engine.frame(frame(1_000 + i * FRAME_MS, [person(close)])).warning),
    ].filter(Boolean);
    expect(warnings).toEqual(['ahead', 'near']);
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
    // Two frames after the restart are not enough to report again.
    expect(engine.frame(frame(5_000, [person(ahead)])).warning).toBeUndefined();
    expect(engine.frame(frame(5_200, [person(ahead)])).warning).toBeUndefined();
    expect(engine.frame(frame(5_400, [person(ahead)])).warning).toBe('ahead');
  });
});
