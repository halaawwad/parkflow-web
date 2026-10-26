/**
 * Decides which camera detections are hazards for a walker. Detections come
 * from a real object-detection model; this keeps the ones that are
 * confident, consistent over frames, and in (or crossing into) the walking
 * corridor, and grades them:
 *
 * - early:  confirmed in the path, not yet close — time to slow down;
 * - urgent: close, or closing so fast that a warning now is the last useful one.
 *
 * Closeness comes from box size (a rough, uncalibrated cue) and, when the
 * signal is clean, from optical expansion: a box growing steadily gives a
 * time-to-contact estimate (tau = size / growth rate) without knowing any
 * distance. Tau is only used to decide *when* to warn; it is never spoken,
 * and it is discarded when the camera is swinging, the box is cut off by the
 * frame edge, or the growth is too noisy to fit.
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

/** Whole-image shift since the previous frame (camera sway or turning), as fractions of the frame. */
export interface CameraShift {
  dx: number;
  dy: number;
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
   * (near) objects from 78 % to 85 % in the benchmark; consistency over frames is
   * what filters the extra noise, not a later warning.
   */
  minScore: 0.4,
  /** Classes the benchmark found less precise need a higher score. */
  classMinScore: { chair: 0.45, bench: 0.45, 'dining table': 0.5, 'potted plant': 0.5 } as Record<string, number>,
  /** Small, distant boxes are the noisiest: they need this much more score. */
  smallArea: 0.04,
  smallPenalty: 0.1,
  /** Consistent frames needed before a detection is reported. */
  confirmFrames: 2,
  /** Below this smoothed score a detection is uncertain and needs more frames. */
  uncertainScore: 0.6,
  uncertainFrames: 3,
  /** At or above this, a close obstacle in the middle of the path is urgent from its first frame. */
  instantScore: 0.85,
  /** A box whose size jumps more than this between frames is not the same consistent object. */
  maxSizeJump: 1.4,
  /** Frames a track survives unseen (a brief occlusion or missed frame). */
  maxMisses: 2,
  matchIou: 0.3,
  /** The walking corridor: the middle part of the frame the walker is heading into. */
  corridorLeft: 0.25,
  corridorRight: 0.75,
  /** In the path: this share of the box's width inside the corridor, or the box spans this share of it. */
  inPathShare: 0.4,
  spansCorridor: 0.5,
  /** Box centres between these count as straight ahead; otherwise ahead to the left or right. */
  centerLeft: 0.4,
  centerRight: 0.6,
  /** A box beside the corridor moving towards it fast enough to enter within this is crossing into the path. */
  crossingHorizonS: 1.5,
  /** A box in the corridor moving out of it fast enough to be gone within this is leaving: no hazard. */
  leavingHorizonS: 0.7,
  /** Shrinking at least this fast (relative, per second): walking away, so not about to be reached. */
  recedingRate: 0.1,
  /** Fit quality needed to trust a sideways or shrinking trend. */
  trendMinR2: 0.5,
  /** Boxes that end above this line, or are smaller than this, are too far away to mention. */
  minBottom: 0.5,
  minArea: 0.015,
  /**
   * Shorter than this (share of frame height), an obstacle in the path is not yet worth an
   * early warning unless it is closing in. Tuned on annotated walking video (MOT17): real
   * hazards were 0.31+ tall when first confirmed, half the needless warnings below 0.3, and
   * 0.35 kept the same hazards warned in time with fewer needless warnings.
   */
  earlyMinHeight: 0.35,
  /** Box sizes that suggest the obstacle is close (uncalibrated cues, not measurements). */
  urgentHeight: 0.6,
  urgentBottom: 0.95,
  urgentWidth: 0.35,
  /** Optical expansion: fit over this window, with at least these points and span, and this fit quality. */
  loomWindowMs: 1_500,
  loomMinPoints: 4,
  loomMinSpanMs: 600,
  loomMinR2: 0.7,
  /** Slower relative growth than this (per second) is not approaching in any useful sense. */
  loomMinRate: 0.12,
  /** Average camera shift per frame above this makes box motion meaningless. */
  maxCameraShift: 0.03,
  /** Reaction margin for a walker: hear the warning, understand it, and stop. */
  reactionS: 1.5,
  /** Time to say the key word of a warning. */
  speechS: 0.6,
};
export type TrackingConfig = typeof TRACKING;

export type Direction = 'left' | 'center' | 'right';
export type HazardLevel = 'early' | 'urgent';

export interface ObstacleAssessment {
  trackId: number;
  /** The COCO label when the type is clear; undefined means "an obstacle". */
  label?: string;
  /** Where in the path: straight ahead, or ahead towards the left or right. */
  direction: Direction;
  level: HazardLevel;
  /** Growing steadily across frames: it is coming closer, or the walker is closing in. */
  approaching: boolean;
  /** Seconds to contact from optical expansion, only when that signal is clean. Never spoken. */
  tau?: number;
  /** Moving sideways into the path rather than already in it. */
  crossing: boolean;
  /** Where it is in the frame now. */
  box: Box;
  score: number;
  hits: number;
  /** When the track was first detected (frame time). */
  firstSeenAt: number;
}

interface Track {
  id: number;
  box: Box;
  score: number;
  /** Consecutive consistent frames. */
  hits: number;
  misses: number;
  firstSeenAt: number;
  votes: Map<string, number>;
  history: { at: number; size: number; cx: number; stable: boolean; truncated: boolean }[];
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

/** A box touching the top, or both sides, is cut off: its growth no longer tracks distance. */
const truncatedBox = (box: Box) => box.y <= 0.01 || (box.x <= 0.01 && box.x + box.width >= 0.99);
/** Touching the left, right or bottom edge: still coming into view. */
const atEdge = (box: Box) => box.x <= 0.01 || box.x + box.width >= 0.99 || box.y + box.height >= 0.99;

/** Most dangerous first: urgent, then sooner contact, then straight ahead, then larger. */
export function dangerOf(a: Pick<ObstacleAssessment, 'level' | 'direction' | 'approaching' | 'tau'>): number {
  return (a.level === 'urgent' ? 100 : 0) + (a.tau !== undefined ? Math.max(0, 20 - a.tau * 2) : 0) + (a.direction === 'center' ? 5 : 0) + (a.approaching ? 3 : 0);
}

/** Least-squares line through (t, v); slope per second and R². */
function fitLine(points: { t: number; v: number }[]): { slope: number; r2: number } {
  const n = points.length;
  const mt = points.reduce((s, p) => s + p.t, 0) / n;
  const mv = points.reduce((s, p) => s + p.v, 0) / n;
  let stt = 0, stv = 0, svv = 0;
  for (const p of points) {
    stt += (p.t - mt) ** 2;
    stv += (p.t - mt) * (p.v - mv);
    svv += (p.v - mv) ** 2;
  }
  const slope = stt > 0 ? stv / stt : 0;
  const r2 = stt > 0 && svv > 0 ? (stv * stv) / (stt * svv) : 0;
  return { slope, r2 };
}

export class ObstacleTracker {
  private tracks: Track[] = [];
  private nextId = 1;
  private recentShift: number[] = [];
  /** Measured delay from a warning decision to speech starting, added to the warning budget. */
  private latencyS = 0.5;

  constructor(private readonly config: TrackingConfig = TRACKING) {}

  /** Feeds back how long warnings take to be heard, so the budget includes this device's real delay. */
  setLatency(seconds: number): void {
    if (Number.isFinite(seconds) && seconds >= 0) this.latencyS = Math.min(3, seconds);
  }

  /** Tau at or below which a warning is the last useful one: latency + saying it + reacting. */
  get urgentTau(): number {
    return this.latencyS + this.config.speechS + this.config.reactionS;
  }

  /** Whether a track is still reported at this level or above (a waiting warning about it is still true). */
  isRelevant(trackId: number, level: HazardLevel, now: number): boolean {
    const track = this.tracks.find((t) => t.id === trackId);
    if (!track || track.misses > 0) return false;
    const assessment = this.assess(track, now, this.cameraStable());
    return Boolean(assessment && (level === 'early' || assessment.level === 'urgent'));
  }

  /** Feeds one analysed frame; returns the hazards in or entering the path, most dangerous first. */
  update(detections: FrameDetection[], now: number, shift?: CameraShift): ObstacleAssessment[] {
    const c = this.config;
    const magnitude = shift ? Math.hypot(shift.dx, shift.dy) : 0;
    this.recentShift.push(magnitude);
    if (this.recentShift.length > 6) this.recentShift.shift();
    const stable = this.cameraStable();

    const candidates = detections
      .filter((d) => OBSTACLE_SET.has(d.label) && validBox(d.box))
      .map((d) => ({ ...d, box: clampBox(d.box) }))
      .filter((d) => d.box.width > 0 && d.box.height > 0)
      .filter((d) => d.score >= (c.classMinScore[d.label] ?? c.minScore) + (boxArea(d.box) < c.smallArea ? c.smallPenalty : 0));

    // Greedy matching by overlap, after undoing the camera's own shift. A label may
    // change between frames (truck / car), so any overlapping detection can continue
    // a track; same-label pairs go first.
    const pairs: { track: Track; detection: (typeof candidates)[number]; rank: number }[] = [];
    for (const track of this.tracks) {
      const predicted = shift ? { ...track.box, x: track.box.x + shift.dx, y: track.box.y + shift.dy } : track.box;
      for (const detection of candidates) {
        const overlap = iou(predicted, detection.box);
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
      const size = Math.sqrt(boxArea(detection.box));
      const previous = Math.sqrt(boxArea(track.box));
      // A box that suddenly doubles or halves is a different object or a bad fit: start counting
      // again. Not at the frame edge, where someone stepping into view grows quickly by nature.
      const consistent = atEdge(detection.box) || atEdge(track.box) || (size / previous <= c.maxSizeJump && previous / size <= c.maxSizeJump);
      track.box = detection.box;
      track.score = track.score * 0.4 + detection.score * 0.6;
      track.hits = consistent ? track.hits + 1 : 1;
      track.misses = 0;
      track.votes.set(detection.label, (track.votes.get(detection.label) ?? 0) + detection.score);
      // Positions are kept in the current frame's coordinates, so shift the history with the camera.
      if (shift) for (const entry of track.history) entry.cx += shift.dx;
      if (!consistent) track.history = [];
      track.history.push({ at: now, size, cx: detection.box.x + detection.box.width / 2, stable, truncated: truncatedBox(detection.box) });
      track.history = track.history.filter((entry) => now - entry.at <= c.loomWindowMs);
    }
    for (const track of this.tracks) if (!matchedTracks.has(track)) track.misses++;
    this.tracks = this.tracks.filter((track) => track.misses <= c.maxMisses);
    for (const detection of candidates) {
      if (usedDetections.has(detection)) continue;
      this.tracks.push({
        id: this.nextId++, box: detection.box, score: detection.score, hits: 1, misses: 0, firstSeenAt: now,
        votes: new Map([[detection.label, detection.score]]),
        history: [{ at: now, size: Math.sqrt(boxArea(detection.box)), cx: detection.box.x + detection.box.width / 2, stable, truncated: truncatedBox(detection.box) }],
      });
    }

    return this.tracks
      .flatMap((track) => {
        if (track.misses > 0) return [];
        const assessment = this.assess(track, now, stable);
        return assessment ? [assessment] : [];
      })
      .sort((a, b) => dangerOf(b) - dangerOf(a));
  }

  reset(): void {
    this.tracks = [];
    this.recentShift = [];
  }

  private cameraStable(): boolean {
    if (!this.recentShift.length) return true;
    return this.recentShift.reduce((s, v) => s + v, 0) / this.recentShift.length <= this.config.maxCameraShift;
  }

  private labelOf(track: Track): string | undefined {
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
    return track.score >= 0.65 && total > 0 && bestWeight / total >= 0.67 ? best : undefined;
  }

  /**
   * Optical expansion over the window. For a steady approach, size ∝ 1 / distance,
   * so d ln(size) / dt = 1 / tau exactly: the fitted slope gives tau at the middle of
   * the window, and tau shrinks one second per second, so the time since then is
   * subtracted. Noisy growth, a swinging camera or a cut-off box give nothing.
   */
  private looming(track: Track): { growing: boolean; tau?: number } {
    const c = this.config;
    const points = track.history;
    const last = points[points.length - 1];
    if (!last || points.length < c.loomMinPoints || last.at - points[0]!.at < c.loomMinSpanMs) return { growing: false };
    if (points.some((p) => !p.stable || p.truncated)) return { growing: false };
    const series = points.map((p) => ({ t: p.at / 1000, v: Math.log(p.size) }));
    const fit = fitLine(series);
    if (fit.r2 < c.loomMinR2 || fit.slope < c.loomMinRate) return { growing: false };
    const meanT = series.reduce((s, p) => s + p.t, 0) / series.length;
    return { growing: true, tau: Math.max(0, 1 / fit.slope - (last.at / 1000 - meanT)) };
  }

  private assess(track: Track, now: number, stable: boolean): ObstacleAssessment | undefined {
    const c = this.config;
    const { box } = track;
    const bottom = box.y + box.height;
    if (boxArea(box) < c.minArea || bottom < c.minBottom) return undefined;

    const overlap = Math.max(0, Math.min(box.x + box.width, c.corridorRight) - Math.max(box.x, c.corridorLeft));
    const inPath = overlap / box.width >= c.inPathShare || overlap / (c.corridorRight - c.corridorLeft) >= c.spansCorridor;
    const cx = box.x + box.width / 2;
    const history = track.history;
    // Sideways and size trends, with the camera's own sway already removed. Only
    // trusted on a steady camera with a clean fit; otherwise assume the worst.
    const trends = stable && history.length >= 3 && history[history.length - 1]!.at - history[0]!.at >= 400;
    const sideways = trends ? fitLine(history.map((p) => ({ t: p.at / 1000, v: p.cx }))) : undefined;
    const shrink = trends ? fitLine(history.map((p) => ({ t: p.at / 1000, v: Math.log(p.size) }))) : undefined;
    const outward = sideways && sideways.r2 >= c.trendMinR2 ? (cx < 0.5 ? -sideways.slope : sideways.slope) : 0;

    // Beside the path: only a hazard if it is moving into it soon.
    let crossing = false;
    if (!inPath) {
      const gap = cx < 0.5 ? c.corridorLeft - (box.x + box.width) : box.x - c.corridorRight;
      crossing = sideways !== undefined && sideways.r2 >= c.loomMinR2 && -outward > 0 && gap / -outward <= c.crossingHorizonS;
      if (!crossing) return undefined;
    } else if (outward > 0) {
      // In the path but stepping out of it: gone before the walker gets there.
      const inner = cx < 0.5 ? box.x + box.width - c.corridorLeft : c.corridorRight - box.x;
      if (inner / outward <= c.leavingHorizonS) return undefined;
    }
    const receding = Boolean(shrink && shrink.r2 >= c.trendMinR2 && shrink.slope <= -c.recedingRate);

    const direction: Direction = cx < c.centerLeft ? 'left' : cx > c.centerRight ? 'right' : 'center';
    const { growing, tau } = this.looming(track);
    const closeBySize = box.height >= c.urgentHeight || (bottom >= c.urgentBottom && box.width >= c.urgentWidth);
    // One frame never proves an obstacle is close, except a very confident one already in the path
    // (someone stepping in close from the side gives no time for a second frame).
    const instant = track.hits === 1 && track.score >= c.instantScore && closeBySize && !crossing;
    const needed = instant ? 1 : track.score < c.uncertainScore ? c.uncertainFrames : c.confirmFrames;
    if (track.hits < needed) return undefined;

    // Close but walking away (someone ahead going the same way) is worth one early
    // mention, not "stop"; closing in fast is urgent before it even looks close.
    const urgent = (closeBySize && !receding) || (tau !== undefined && tau <= this.urgentTau);
    if (!urgent && !growing && !crossing && box.height < c.earlyMinHeight) return undefined;
    // Walking away and not close: the walker is not about to reach it.
    if (!urgent && receding && !closeBySize) return undefined;
    return {
      trackId: track.id, label: this.labelOf(track), direction, level: urgent ? 'urgent' : 'early',
      approaching: growing, tau, crossing, box, score: track.score, hits: track.hits, firstSeenAt: track.firstSeenAt,
    };
  }
}
