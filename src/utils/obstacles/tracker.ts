/**
 * Decides which camera detections matter while walking. Detections come from
 * a real object-detection model; this keeps the ones that are confident, seen
 * over several frames, inside the walking corridor and large enough to be
 * close. Box size is only a rough sign of nearness — nothing here measures
 * distance, so the output is a risk level, never metres.
 *
 * Assumes the phone is held upright with the rear camera facing the walking
 * direction. Pure, so it is testable with synthetic frames.
 */

/** Fractions of the frame, origin top-left. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameDetection {
  label: string;
  score: number;
  box: Box;
}

/**
 * COCO classes the detector is asked for: things that stand on or cross a
 * footpath and that the model detects reasonably well. Poles, walls, trees,
 * holes, curbs and stairs are not COCO classes, so they are never reported.
 */
export const OBSTACLE_LABELS = [
  'person', 'bicycle', 'motorcycle', 'car', 'bus', 'truck',
  'bench', 'chair', 'fire hydrant', 'parking meter', 'stop sign', 'potted plant', 'dog',
] as const;
const OBSTACLE_SET = new Set<string>(OBSTACLE_LABELS);

export const TRACKING = {
  minScore: 0.5,
  /** Frames a track needs before it can be reported. */
  minHits: 3,
  /** Frames a track survives unseen (a brief occlusion or missed frame). */
  maxMisses: 2,
  matchIou: 0.3,
  /** Middle part of the frame a walker is heading into. */
  corridorLeft: 0.3,
  corridorRight: 0.7,
  /** Share of the box's width that must sit inside the corridor. */
  minCorridorShare: 0.3,
  /** The box must reach this far down the frame; far-off objects sit near the horizon. */
  minBottom: 0.55,
  /** Smaller than this share of the frame is too far away to mention. */
  minArea: 0.02,
  /** A box this tall, or touching the bottom edge while this wide, is probably close. */
  nearHeight: 0.6,
  nearBottom: 0.95,
  nearWidth: 0.3,
  /** Already this large and growing this much within the window: probably approaching. */
  approachArea: 0.12,
  growth: 1.35,
  growthWindowMs: 1_500,
};
export type TrackingConfig = typeof TRACKING;

export type Proximity = 'ahead' | 'near';

export interface ObstacleAssessment {
  trackId: number;
  label: string;
  proximity: Proximity;
  score: number;
}

interface Track {
  id: number;
  label: string;
  box: Box;
  score: number;
  hits: number;
  misses: number;
  history: { at: number; area: number }[];
}

export const boxArea = (box: Box) => box.width * box.height;

export function iou(a: Box, b: Box): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const overlap = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = boxArea(a) + boxArea(b) - overlap;
  return union > 0 ? overlap / union : 0;
}

const validBox = (box: Box) =>
  [box.x, box.y, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0;

/** Clamps a model box to the frame; models can return boxes that spill past the edges. */
function clampBox(box: Box): Box {
  const x = Math.max(0, box.x);
  const y = Math.max(0, box.y);
  return { x, y, width: Math.min(1, box.x + box.width) - x, height: Math.min(1, box.y + box.height) - y };
}

export class ObstacleTracker {
  private tracks: Track[] = [];
  private nextId = 1;

  constructor(private readonly config: TrackingConfig = TRACKING) {}

  /** Feeds one analysed frame; returns the stable obstacles in the walking corridor. */
  update(detections: FrameDetection[], now: number): ObstacleAssessment[] {
    const c = this.config;
    const candidates = detections
      .filter((d) => d.score >= c.minScore && OBSTACLE_SET.has(d.label) && validBox(d.box))
      .map((d) => ({ ...d, box: clampBox(d.box) }))
      .filter((d) => d.box.width > 0 && d.box.height > 0);

    // Greedy matching: the best-overlapping same-class pairs first.
    const pairs: { track: Track; detection: (typeof candidates)[number]; overlap: number }[] = [];
    for (const track of this.tracks) {
      for (const detection of candidates) {
        if (detection.label !== track.label) continue;
        const overlap = iou(track.box, detection.box);
        if (overlap >= c.matchIou) pairs.push({ track, detection, overlap });
      }
    }
    pairs.sort((a, b) => b.overlap - a.overlap);
    const matchedTracks = new Set<Track>();
    const usedDetections = new Set<(typeof candidates)[number]>();
    for (const { track, detection } of pairs) {
      if (matchedTracks.has(track) || usedDetections.has(detection)) continue;
      matchedTracks.add(track);
      usedDetections.add(detection);
      track.box = detection.box;
      track.score = track.score * 0.4 + detection.score * 0.6;
      track.hits++;
      track.misses = 0;
      track.history.push({ at: now, area: boxArea(detection.box) });
      track.history = track.history.filter((entry) => now - entry.at <= c.growthWindowMs * 2);
    }
    for (const track of this.tracks) if (!matchedTracks.has(track)) track.misses++;
    this.tracks = this.tracks.filter((track) => track.misses <= c.maxMisses);
    for (const detection of candidates) {
      if (usedDetections.has(detection)) continue;
      this.tracks.push({
        id: this.nextId++, label: detection.label, box: detection.box, score: detection.score,
        hits: 1, misses: 0, history: [{ at: now, area: boxArea(detection.box) }],
      });
    }

    return this.tracks.flatMap((track) => {
      if (track.hits < c.minHits || track.misses > 0) return [];
      const proximity = assessTrack(track, now, c);
      return proximity ? [{ trackId: track.id, label: track.label, proximity, score: track.score }] : [];
    });
  }

  reset(): void {
    this.tracks = [];
  }
}

/** Where a stable track sits relative to the walker, or undefined when it is not in the way. */
function assessTrack(track: Track, now: number, c: TrackingConfig): Proximity | undefined {
  const { box } = track;
  const area = boxArea(box);
  if (area < c.minArea) return undefined;
  const corridorOverlap = Math.max(0, Math.min(box.x + box.width, c.corridorRight) - Math.max(box.x, c.corridorLeft));
  const bottom = box.y + box.height;
  if (corridorOverlap / box.width < c.minCorridorShare || bottom < c.minBottom) return undefined;

  const earlier = track.history.find((entry) => now - entry.at <= c.growthWindowMs && entry.at < now);
  const approaching = Boolean(earlier && area >= c.approachArea && area / earlier.area >= c.growth);
  const close = box.height >= c.nearHeight || (bottom >= c.nearBottom && box.width >= c.nearWidth);
  return close || approaching ? 'near' : 'ahead';
}
