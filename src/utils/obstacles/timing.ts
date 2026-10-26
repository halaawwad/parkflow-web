/**
 * How long obstacle warnings take on this device, from the camera frame to
 * the first sound. Kept as rolling medians so the warning threshold can
 * include the real delay instead of a guess. True "obstacle appeared" time is
 * unknowable in the app (only that it was first detected); benchmarks with
 * annotated footage measure that part.
 */

const WINDOW = 20;

const median = (values: number[]) => {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1]!;
};

export interface WarningTimingSample {
  /** When the camera frame that first showed the obstacle was taken. */
  firstSeenAt: number;
  /** When the frame that triggered the warning was taken. */
  frameAt: number;
  /** When the warning was decided (after inference). */
  decidedAt: number;
  /** When speech started. */
  speechAt: number;
}

export interface WarningTimingSummary {
  /** First detection → warning decided (confirmation frames and inference). */
  detectionMs?: number;
  /** Warning decided → speech started (queue and voice start-up). */
  speechStartMs?: number;
  /** First detection → speech started. */
  totalMs?: number;
  samples: number;
}

export class WarningTimings {
  private detection: number[] = [];
  private speech: number[] = [];
  private total: number[] = [];
  private lag: number[] = [];

  record(sample: WarningTimingSample): void {
    const push = (list: number[], value: number) => {
      if (!Number.isFinite(value) || value < 0) return;
      list.push(value);
      if (list.length > WINDOW) list.shift();
    };
    push(this.detection, sample.decidedAt - sample.firstSeenAt);
    push(this.speech, sample.speechAt - sample.decidedAt);
    push(this.total, sample.speechAt - sample.firstSeenAt);
    push(this.lag, sample.speechAt - sample.frameAt);
  }

  summary(): WarningTimingSummary {
    return { detectionMs: median(this.detection), speechStartMs: median(this.speech), totalMs: median(this.total), samples: this.total.length };
  }

  /** Seconds from a camera frame to the warning it triggers being heard: the delay a warning must allow for. */
  latencySeconds(): number | undefined {
    const lag = median(this.lag);
    return lag === undefined ? undefined : lag / 1000;
  }
}
