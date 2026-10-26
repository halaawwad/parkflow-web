import { ObstacleTracker, type CameraShift, type FrameDetection, type HazardLevel, type TrackingConfig } from './tracker';
import { frameProblem, ReliabilityMonitor, type FrameQuality, type Reliability, type ReliabilityConfig } from './quality';
import { WarningPolicy, type ObstacleAnnouncement, type WarningTiming } from './warnings';

/**
 * The obstacle awareness pipeline, independent of GPS and routing: one
 * analysed camera frame in, at most one spoken warning and the current
 * reliability out. The camera layer (camera.web.ts) produces the frames.
 */

/** One camera frame after model inference. */
export interface ObstacleFrame {
  detections: FrameDetection[];
  quality: FrameQuality;
  /** Model time for this frame. */
  inferenceMs: number;
  at: number;
  /** Whole-image shift since the previous frame, when the camera layer measured it. */
  cameraShift?: CameraShift;
}

export interface EngineOutput {
  warning?: ObstacleAnnouncement;
  reliability: Reliability;
}

export class ObstacleAwarenessEngine {
  private readonly tracker: ObstacleTracker;
  private readonly policy: WarningPolicy;
  private readonly reliability: ReliabilityMonitor;
  private lastFrameAt = 0;

  constructor(config: { tracking?: TrackingConfig; timing?: WarningTiming; reliability?: ReliabilityConfig } = {}) {
    this.tracker = new ObstacleTracker(config.tracking);
    this.policy = new WarningPolicy(config.timing);
    this.reliability = new ReliabilityMonitor(config.reliability);
  }

  frame(frame: ObstacleFrame): EngineOutput {
    this.lastFrameAt = frame.at;
    const reliability = this.reliability.frame(frameProblem(frame.quality, frame.inferenceMs), frame.at);
    // A confident detection is still worth a warning on a poor frame; the
    // poor frame is reported separately so silence is never read as safety.
    const warning = this.policy.decide(this.tracker.update(frame.detections, frame.at, frame.cameraShift), frame.at);
    return { warning, reliability };
  }

  /** Whether a waiting warning is still true: the obstacle is still there at that level. */
  isRelevant(trackId: number, level: HazardLevel): boolean {
    return this.tracker.isRelevant(trackId, level, this.lastFrameAt);
  }

  /** Measured delay until a warning is heard; it moves the urgent threshold earlier on slow devices. */
  setLatency(seconds: number): void {
    this.tracker.setLatency(seconds);
  }

  tick(now: number): Reliability {
    return this.reliability.tick(now);
  }

  /** A fresh start (camera restarted, monitoring resumed): nothing carried over. */
  reset(now?: number): void {
    this.tracker.reset();
    this.policy.reset();
    this.reliability.reset(now);
  }
}
