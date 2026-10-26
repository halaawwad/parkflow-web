/**
 * How fast to analyse camera frames. Each pass takes the newest frame, so a
 * backlog cannot build up; the only choice is how long to rest between passes.
 * Resting a share of the inference time keeps frames coming as fast as the
 * device manages while leaving it some idle time, and rests more when the
 * battery is low or inference slows down (a sign the device is hot and being
 * throttled).
 */

export const PACING = {
  /** Rest after a frame, as a share of its inference time (about 67 % busy). */
  idleShare: 0.5,
  /** Low battery or a throttled device (about 40 % busy). */
  restShare: 1.5,
  minIdleMs: 10,
  maxIdleMs: 700,
  /** Frames that set the device's normal inference time. */
  baselineFrames: 20,
  /** Recent frames this much slower than normal: back off; this close to normal again: resume. */
  hotFactor: 1.6,
  coolFactor: 1.2,
  recentFrames: 10,
};
export type PacingConfig = typeof PACING;

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1]!;
};

export class FramePacer {
  private baseline?: number;
  private samples: number[] = [];
  private hot = false;

  constructor(private readonly lowPower = false, private readonly config: PacingConfig = PACING) {}

  /** True while inference is running well below this device's normal speed. */
  get throttled(): boolean {
    return this.hot;
  }

  /** Rest before the next frame, given how long this one took. */
  next(inferenceMs: number): number {
    const c = this.config;
    this.samples.push(inferenceMs);
    if (this.baseline === undefined) {
      if (this.samples.length >= c.baselineFrames) {
        this.baseline = median(this.samples);
        this.samples = this.samples.slice(-c.recentFrames);
      }
    } else {
      if (this.samples.length > c.recentFrames) this.samples.shift();
      const recent = median(this.samples);
      if (!this.hot && recent >= this.baseline * c.hotFactor) this.hot = true;
      else if (this.hot && recent <= this.baseline * c.coolFactor) this.hot = false;
    }
    const share = this.lowPower || this.hot ? c.restShare : c.idleShare;
    return Math.min(c.maxIdleMs, Math.max(c.minIdleMs, inferenceMs * share));
  }
}
