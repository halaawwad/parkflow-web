/**
 * One-voice-at-a-time speech for navigation. Utterances never overlap: a new
 * prompt waits for the current one. One urgent and one routine prompt may wait
 * (the newest of each kind — an older one is stale by the time it could play),
 * the urgent one plays first, and a waiting prompt whose moment has passed is
 * dropped rather than read out late. Urgent prompts ("Turn right") cut off a
 * routine one. Hazard warnings ("Stop. Obstacle close ahead") rank above both:
 * they cut off anything, and a turn instruction they cut off is said again
 * afterwards if it is still current. Every utterance has a watchdog because
 * some browsers never fire the end event, which would otherwise wedge the queue.
 *
 * The engine is injected so the queue is testable without audio.
 */

export interface SpeechEngine {
  speak(
    text: string,
    callbacks: { onDone: () => void; onStopped: () => void; onError: (error: unknown) => void },
    /** Urgent prompts ("Turn right") must start at once; routine ones may wait briefly for better audio. */
    options?: { urgent?: boolean },
  ): void;
  stop(): void;
  /** Whether audio is still playing, when the platform can say synchronously. Lets the watchdog wait for slow voices. */
  isSpeaking?(): boolean;
}

/** 'urgent' is reserved for immediate hazards; 'high' is turn guidance; 'normal' is information. */
export type SpeechPriority = 'normal' | 'high' | 'urgent';
const RANK: Record<SpeechPriority, number> = { normal: 0, high: 1, urgent: 2 };
const rankOf = (request: SpeechRequest) => RANK[request.priority ?? 'normal'];

export interface SpeechRequest {
  text: string;
  priority?: SpeechPriority;
  /** Guidance instructions are remembered for "repeat"; status messages are not. */
  instruction?: boolean;
  /** Bypass duplicate suppression (used by "repeat"). */
  force?: boolean;
  /** Checked before a waiting prompt plays; guidance for a turn already passed is dropped. */
  isCurrent?: () => boolean;
}

export interface SpeechQueueStatus {
  speaking: boolean;
  /** The platform refused to play audio (browser autoplay policy, no voice). */
  blocked: boolean;
  errors: number;
}

interface Timers {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

const defaultTimers: Timers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Same text within this window is not repeated. */
const DUPLICATE_WINDOW_MS = 6_000;

/** Expected length of one utterance: ~110 ms per character plus slack (Arabic voices run slower). */
export const estimateSpeechMs = (text: string) => Math.min(20_000, 3_000 + text.length * 110);
/** The watchdog never waits longer than this for one utterance, even if the engine claims it is still speaking. */
const MAX_UTTERANCE_MS = 30_000;

function isBlockedError(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null
    ? String((error as { error?: unknown; message?: unknown }).error ?? (error as { message?: unknown }).message ?? '')
    : String(error ?? '');
  return /not-allowed|notallowed|audio-busy|synthesis-unavailable/i.test(code);
}

export class SpeechQueue {
  private current?: { request: SpeechRequest; token: number; watchdog: unknown; startedAt: number };
  private pending: { urgent?: SpeechRequest; high?: SpeechRequest; normal?: SpeechRequest } = {};
  /** A guidance instruction a hazard warning cut off, to be said again once the warning ends. */
  private interrupted?: SpeechRequest;
  private token = 0;
  private lastSpoken?: { text: string; at: number };
  private lastInstruction?: string;
  private muted = false;
  private status: SpeechQueueStatus = { speaking: false, blocked: false, errors: 0 };

  constructor(
    private readonly engine: SpeechEngine,
    private readonly onStatus: (status: SpeechQueueStatus) => void = () => undefined,
    private readonly timers: Timers = defaultTimers,
  ) {}

  get isMuted() {
    return this.muted;
  }

  get latestInstruction() {
    return this.lastInstruction;
  }

  enqueue(request: SpeechRequest): void {
    if (request.instruction) this.lastInstruction = request.text;
    if (this.muted) return;
    const rank = rankOf(request);
    if (!request.force) {
      if (
        this.current?.request.text === request.text ||
        this.pending.urgent?.text === request.text ||
        this.pending.high?.text === request.text ||
        this.pending.normal?.text === request.text
      ) return;
      // A hazard that is still there may be repeated; its own cooldown limits how often.
      const last = this.lastSpoken;
      if (rank < RANK.urgent && last && last.text === request.text && this.timers.now() - last.at < DUPLICATE_WINDOW_MS) return;
    }
    if (!this.current) {
      this.play(request);
      return;
    }
    const currentRank = rankOf(this.current.request);
    // Hazards cut off anything below them; turn guidance cuts off information.
    if (rank > currentRank && (rank === RANK.urgent || currentRank === RANK.normal)) {
      if (rank === RANK.urgent && this.current.request.instruction) this.interrupted = this.current.request;
      this.interrupt();
      this.play(request);
      return;
    }
    if (rank === RANK.urgent) this.pending.urgent = request;
    else if (rank === RANK.high) this.pending.high = request;
    else this.pending.normal = request;
  }

  /** Speaks the latest guidance instruction again, even if it was just said. */
  repeat(): boolean {
    if (!this.lastInstruction || this.muted) return false;
    this.pending = {};
    this.interrupted = undefined;
    if (this.current) this.interrupt();
    this.play({ text: this.lastInstruction, priority: 'high', instruction: true, force: true });
    return true;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) {
      this.pending = {};
      this.interrupted = undefined;
      if (this.current) this.interrupt();
    }
  }

  /** Drops queued and playing speech (e.g. when guidance becomes unreliable). */
  clear(): void {
    this.pending = {};
    this.interrupted = undefined;
    if (this.current) this.interrupt();
  }

  /** Starts a fresh session: silence, and forget what was said so "repeat" cannot replay a previous trip. */
  reset(): void {
    this.clear();
    this.lastInstruction = undefined;
    this.lastSpoken = undefined;
  }

  private play(request: SpeechRequest) {
    const token = ++this.token;
    const startedAt = this.timers.now();
    const watchdog = this.timers.setTimeout(() => this.onWatchdog(token), estimateSpeechMs(request.text));
    this.current = { request, token, watchdog, startedAt };
    this.lastSpoken = { text: request.text, at: this.timers.now() };
    this.setStatus({ speaking: true });
    try {
      this.engine.speak(request.text, {
        onDone: () => {
          if (token === this.token && this.status.blocked) this.setStatus({ blocked: false });
          this.finish(token);
        },
        onStopped: () => this.finish(token),
        onError: (error) => {
          if (token !== this.token) return;
          this.setStatus({ errors: this.status.errors + 1, blocked: this.status.blocked || isBlockedError(error) });
          this.finish(token);
        },
      }, { urgent: rankOf(request) >= RANK.high });
    } catch (error) {
      this.setStatus({ errors: this.status.errors + 1, blocked: isBlockedError(error) });
      this.finish(token);
    }
  }

  /** The end event is late or lost. Keep waiting while the engine is audibly speaking, else move on. */
  private onWatchdog(token: number) {
    const current = this.current;
    if (!current || current.token !== token) return;
    let speaking = false;
    try {
      speaking = Boolean(this.engine.isSpeaking?.());
    } catch {
      speaking = false;
    }
    if (speaking && this.timers.now() - current.startedAt < MAX_UTTERANCE_MS) {
      current.watchdog = this.timers.setTimeout(() => this.onWatchdog(token), 1_000);
      return;
    }
    this.finish(token);
  }

  private interrupt() {
    const current = this.current;
    if (!current) return;
    this.timers.clearTimeout(current.watchdog);
    this.current = undefined;
    this.token++;
    try {
      this.engine.stop();
    } catch {
      // Stopping is best effort.
    }
    this.setStatus({ speaking: false });
  }

  private finish(token: number) {
    if (!this.current || this.current.token !== token) return;
    this.timers.clearTimeout(this.current.watchdog);
    this.current = undefined;
    const next = this.takePending();
    if (next && !this.muted) this.play(next);
    else this.setStatus({ speaking: false });
  }

  private takePending(): SpeechRequest | undefined {
    const valid = (request?: SpeechRequest) => Boolean(request && (!request.isCurrent || request.isCurrent()));
    const { urgent, high, normal } = this.pending;
    if (valid(urgent)) {
      this.pending.urgent = undefined;
      return urgent;
    }
    this.pending.urgent = undefined;
    // A newer turn instruction replaces the one a hazard cut off.
    if (valid(high)) {
      this.pending.high = undefined;
      if (high!.instruction) this.interrupted = undefined;
      return high;
    }
    this.pending.high = undefined;
    const resumed = this.interrupted;
    this.interrupted = undefined;
    if (valid(resumed)) return { ...resumed!, force: true };
    this.pending = {};
    return valid(normal) ? normal : undefined;
  }

  private setStatus(patch: Partial<SpeechQueueStatus>) {
    const next = { ...this.status, ...patch };
    if (next.speaking === this.status.speaking && next.blocked === this.status.blocked && next.errors === this.status.errors) return;
    this.status = next;
    this.onStatus(next);
  }
}
