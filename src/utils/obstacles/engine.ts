import { ObstacleTracker, type FrameDetection, type Proximity, type TrackingConfig } from './tracker';
import { frameProblem, ReliabilityMonitor, type FrameQuality, type Reliability, type ReliabilityConfig } from './quality';
import { WarningPolicy, type WarningTiming } from './warnings';

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
}

export interface EngineOutput {
  warning?: Proximity;
  reliability: Reliability;
}

export class ObstacleAwarenessEngine {
  private readonly tracker: ObstacleTracker;
  private readonly policy: WarningPolicy;
  private readonly reliability: ReliabilityMonitor;

  constructor(config: { tracking?: TrackingConfig; timing?: WarningTiming; reliability?: ReliabilityConfig } = {}) {
    this.tracker = new ObstacleTracker(config.tracking);
    this.policy = new WarningPolicy(config.timing);
    this.reliability = new ReliabilityMonitor(config.reliability);
  }

  frame(frame: ObstacleFrame): EngineOutput {
    const reliability = this.reliability.frame(frameProblem(frame.quality, frame.inferenceMs), frame.at);
    // A confident detection is still worth a warning on a poor frame; the
    // poor frame is reported separately so silence is never read as safety.
    const warning = this.policy.decide(this.tracker.update(frame.detections, frame.at), frame.at);
    return { warning, reliability };
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
