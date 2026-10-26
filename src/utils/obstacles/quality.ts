/**
 * Whether the camera can be trusted right now. A dark, covered, blurred or
 * stalled camera sees nothing — which must never be mistaken for a clear
 * path. Thresholds are first estimates for a 64×48 greyscale thumbnail and
 * still need calibrating on real devices.
 */

export interface FrameQuality {
  /** Mean brightness, 0–255. */
  brightness: number;
  /** Standard deviation of brightness: near zero for a covered lens or a blank wall. */
  contrast: number;
  /** Mean absolute Laplacian: low when the picture is blurred. */
  sharpness: number;
}

/** RGBA pixels (canvas ImageData) to luma. */
export function toGray(rgba: ArrayLike<number>): Uint8Array {
  const gray = new Uint8Array(Math.floor(rgba.length / 4));
  for (let i = 0; i < gray.length; i++) {
    gray[i] = Math.round(0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!);
  }
  return gray;
}

export function measureFrame(gray: ArrayLike<number>, width: number, height: number): FrameQuality {
  const count = width * height;
  if (!count || gray.length < count) return { brightness: 0, contrast: 0, sharpness: 0 };
  let sum = 0;
  for (let i = 0; i < count; i++) sum += gray[i]!;
  const brightness = sum / count;
  let variance = 0;
  for (let i = 0; i < count; i++) variance += (gray[i]! - brightness) ** 2;
  let laplacian = 0;
  let inner = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      laplacian += Math.abs(4 * gray[i]! - gray[i - 1]! - gray[i + 1]! - gray[i - width]! - gray[i + width]!);
      inner++;
    }
  }
  return { brightness, contrast: Math.sqrt(variance / count), sharpness: inner ? laplacian / inner : 0 };
}

export type Unreliability = 'dark' | 'obscured' | 'blurred' | 'slow' | 'stalled';

export const RELIABILITY = {
  minBrightness: 30,
  minContrast: 10,
  minSharpness: 2,
  /** Slower than this per frame, warnings would arrive too late to act on. */
  maxInferenceMs: 900,
  /** No analysed frame for this long: the camera or model has stopped. */
  stallMs: 2_500,
  /** A problem must last this long before the walker is told (one bad frame is noise). */
  badForMs: 1_200,
  /** And must be gone this long before monitoring counts as reliable again. */
  goodForMs: 2_000,
};
export type ReliabilityConfig = typeof RELIABILITY;

export function frameProblem(quality: FrameQuality, inferenceMs: number, c: ReliabilityConfig = RELIABILITY): Unreliability | undefined {
  if (quality.brightness < c.minBrightness) return 'dark';
  if (quality.contrast < c.minContrast) return 'obscured';
  if (quality.sharpness < c.minSharpness) return 'blurred';
  if (inferenceMs > c.maxInferenceMs) return 'slow';
  return undefined;
}

export interface Reliability {
  reliable: boolean;
  reason?: Unreliability;
}

/** Debounces frame problems into a reliable / unreliable state, and notices a stalled camera. */
export class ReliabilityMonitor {
  private state: Reliability = { reliable: true };
  private problemSince?: number;
  private problem?: Unreliability;
  private goodSince?: number;
  private lastFrameAt?: number;

  constructor(private readonly config: ReliabilityConfig = RELIABILITY) {}

  get current(): Reliability {
    return this.state;
  }

  /** One analysed frame. */
  frame(problem: Unreliability | undefined, now: number): Reliability {
    this.lastFrameAt = now;
    if (problem) {
      this.goodSince = undefined;
      if (this.problem !== problem) {
        this.problem = problem;
        this.problemSince ??= now;
      }
      if (now - (this.problemSince ?? now) >= this.config.badForMs) this.state = { reliable: false, reason: problem };
      else if (!this.state.reliable) this.state = { reliable: false, reason: problem };
    } else {
      this.problemSince = undefined;
      this.problem = undefined;
      this.goodSince ??= now;
      if (!this.state.reliable && now - this.goodSince >= this.config.goodForMs) this.state = { reliable: true };
    }
    return this.state;
  }

  /** Called on a timer: frames that stop arriving are a problem too. */
  tick(now: number): Reliability {
    if (this.lastFrameAt !== undefined && now - this.lastFrameAt >= this.config.stallMs) {
      this.state = { reliable: false, reason: 'stalled' };
      this.goodSince = undefined;
    }
    return this.state;
  }

  reset(now?: number): void {
    this.state = { reliable: true };
    this.problemSince = undefined;
    this.problem = undefined;
    this.goodSince = undefined;
    this.lastFrameAt = now;
  }
}
