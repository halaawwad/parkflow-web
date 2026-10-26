/**
 * Decides which camera detections matter while walking. Detections come from
 * a real object-detection model; this keeps the ones that are confident, seen
 * long enough to be believed, and in or beside the walking path, and says
 * where they are (left, ahead, right) and roughly how close. Box size is only
 * a rough sign of nearness — nothing here measures distance, so the output is
 * a qualitative level, never metres.
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
 * COCO classes the detector is asked for: things on or crossing a footpath.
 * Tables and farm animals were added after a benchmark on 300 annotated COCO
 * images showed useful precision (≥ 75 %). Poles, walls, barriers, trees,
 * holes, curbs, stairs and glass are not COCO classes, so they are never
 * reported.
 */
export const OBSTACLE_LABELS = [
  'person', 'bicycle', 'motorcycle', 'car', 'bus', 'truck',
  'bench', 'chair', 'dining table', 'potted plant', 'fire hydrant', 'parking meter', 'stop sign',
  'dog', 'cat', 'horse', 'sheep', 'cow',
] as const;
const OBSTACLE_SET = new Set<string>(OBSTACLE_LABELS);

export const TRACKING = {
  /**
   * Lowest detection score considered. 0.4 instead of 0.5 raised recall on large
   * (near) objects from 78 % to 85 % in the benchmark; the extra single-frame false
   * alarms are what the three-frame rule for uncertain detections is for.
   */
  minScore: 0.4,
  /** Frames a detection needs before it is reported. */
  confirmFrames: 2,
  /** Below this smoothed score a detection is uncertain and needs more frames. */
  uncertainScore: 0.6,
  uncertainFrames: 3,
  /** At or above this, a close detection straight ahead is reported from its first frame. */
  instantScore: 0.85,
  /** Frames a track survives unseen (a brief occlusion or missed frame). */
  maxMisses: 2,
  matchIou: 0.3,
  /** Middle part of the frame a walker is heading into. */
  corridorLeft: 0.3,
  corridorRight: 0.7,
  /** Share of the box's width inside the corridor for it to count as straight ahead. */
  aheadShare: 0.5,
  /** The box must reach this far down the frame; far-off objects sit near the horizon. */
  minBottom: 0.55,
  /** Smaller than this share of the frame is too far away to mention. */
  minArea: 0.02,
  /** Box sizes that suggest "near" and "very close". Rough, uncalibrated cues, not measurements. */
  nearHeight: 0.5,
  nearBottom: 0.92,
  nearWidth: 0.25,
  veryCloseHeight: 0.75,
  veryCloseBottom: 0.97,
  veryCloseWidth: 0.45,
  /** At least this large and growing this much within the window: approaching. */
  approachArea: 0.08,
  growth: 1.3,
  growthWindowMs: 1_500,
  /** The type is named only when the track is this confident and its label this consistent. */
  typeScore: 0.65,
  typeShare: 0.67,
};
export type TrackingConfig = typeof TRACKING;

export type Direction = 'left' | 'ahead' | 'right';
export type Proximity = 'ahead' | 'near' | 'very-close';
const PROXIMITY_RANK: Record<Proximity, number> = { ahead: 1, near: 2, 'very-close': 3 };
export const proximityRank = (proximity: Proximity) => PROXIMITY_RANK[proximity];

export interface ObstacleAssessment {
  trackId: number;
  /** The COCO label when the type is clear; undefined means "an obstacle". */
  label?: string;
  direction: Direction;
  proximity: Proximity;
  /** Its box has grown quickly: it is coming closer, or the walker is closing in. */
  approaching: boolean;
  score: number;
  hits: number;
}

interface Track {
  id: number;
  box: Box;
  score: number;
  hits: number;
  misses: number;
  votes: Map<string, number>;
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

/** Most dangerous first: closer, then straight ahead, then approaching. */
export const dangerOf = (a: Pick<ObstacleAssessment, 'proximity' | 'direction' | 'approaching'>) =>
  PROXIMITY_RANK[a.proximity] * 10 + (a.direction === 'ahead' ? 3 : 0) + (a.approaching ? 2 : 0);

export class ObstacleTracker {
  private tracks: Track[] = [];
  private nextId = 1;

  constructor(private readonly config: TrackingConfig = TRACKING) {}

  /** Feeds one analysed frame; returns the confirmed obstacles in or beside the path, most dangerous first. */
  update(detections: FrameDetection[], now: number): ObstacleAssessment[] {
    const c = this.config;
    const candidates = detections
      .filter((d) => d.score >= c.minScore && OBSTACLE_SET.has(d.label) && validBox(d.box))
      .map((d) => ({ ...d, box: clampBox(d.box) }))
      .filter((d) => d.box.width > 0 && d.box.height > 0);

    // Greedy matching by overlap. A label may change between frames (truck / car),
    // so any overlapping detection can continue a track; same-label pairs go first.
    const pairs: { track: Track; detection: (typeof candidates)[number]; rank: number }[] = [];
    for (const track of this.tracks) {
      for (const detection of candidates) {
        const overlap = iou(track.box, detection.box);
        if (overlap >= c.matchIou) pairs.push({ track, detection, rank: overlap + (track.votes.has(detection.label) ? 1 : 0) });
      }
    }
    pairs.sort((a, b) => b.rank - a.rank);
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
      track.votes.set(detection.label, (track.votes.get(detection.label) ?? 0) + detection.score);
      track.history.push({ at: now, area: boxArea(detection.box) });
      track.history = track.history.filter((entry) => now - entry.at <= c.growthWindowMs * 2);
    }
    for (const track of this.tracks) if (!matchedTracks.has(track)) track.misses++;
    this.tracks = this.tracks.filter((track) => track.misses <= c.maxMisses);
    for (const detection of candidates) {
      if (usedDetections.has(detection)) continue;
      this.tracks.push({
        id: this.nextId++, box: detection.box, score: detection.score, hits: 1, misses: 0,
        votes: new Map([[detection.label, detection.score]]),
        history: [{ at: now, area: boxArea(detection.box) }],
      });
    }

    return this.tracks
      .flatMap((track) => {
        if (track.misses > 0) return [];
        const assessment = assessTrack(track, now, c);
        return assessment ? [assessment] : [];
      })
      .sort((a, b) => dangerOf(b) - dangerOf(a));
  }

  reset(): void {
    this.tracks = [];
  }
}

function labelOf(track: Track, c: TrackingConfig): string | undefined {
  let best: string | undefined;
  let bestWeight = 0;
  let total = 0;
  for (const [label, weight] of track.votes) {
    total += weight;
    if (weight > bestWeight) {
      best = label;
      bestWeight = weight;
    }
  }
  return track.score >= c.typeScore && total > 0 && bestWeight / total >= c.typeShare ? best : undefined;
}

/** Where a track sits relative to the walker, or undefined when it is not confirmed or not in the way. */
function assessTrack(track: Track, now: number, c: TrackingConfig): ObstacleAssessment | undefined {
  const { box } = track;
  const area = boxArea(box);
  const bottom = box.y + box.height;
  if (area < c.minArea || bottom < c.minBottom) return undefined;

  const corridorOverlap = Math.max(0, Math.min(box.x + box.width, c.corridorRight) - Math.max(box.x, c.corridorLeft));
  const direction: Direction = corridorOverlap / box.width >= c.aheadShare ? 'ahead' : box.x + box.width / 2 < 0.5 ? 'left' : 'right';

  const earlier = track.history.find((entry) => now - entry.at <= c.growthWindowMs && entry.at < now);
  const approaching = Boolean(earlier && area >= c.approachArea && area / earlier.area >= c.growth);
  let rank = box.height >= c.veryCloseHeight || (bottom >= c.veryCloseBottom && box.width >= c.veryCloseWidth) ? 3
    : box.height >= c.nearHeight || (bottom >= c.nearBottom && box.width >= c.nearWidth) ? 2
    : 1;
  if (approaching) rank = Math.min(3, rank + 1);
  // One frame can never prove an obstacle is very close.
  if (track.hits < 2) rank = Math.min(rank, 2);
  // Beside the path only matters once it is near.
  if (direction !== 'ahead' && rank < 2) return undefined;

  const needed = track.score >= c.instantScore && direction === 'ahead' && rank >= 2 ? 1
    : track.score < c.uncertainScore ? c.uncertainFrames
    : c.confirmFrames;
  if (track.hits < needed) return undefined;

  const proximity: Proximity = rank === 3 ? 'very-close' : rank === 2 ? 'near' : 'ahead';
  return { trackId: track.id, label: labelOf(track, c), direction, proximity, approaching, score: track.score, hits: track.hits };
}
