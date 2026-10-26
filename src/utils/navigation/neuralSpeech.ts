import type { SpeechEngine } from './speechQueue';

/**
 * Speech engine that plays natural voice audio synthesised on the server, with
 * the device voice as a safety net. A navigation prompt must never be late or
 * missing, so:
 *
 * - Audio already fetched (prefetched when the route was planned) plays at once.
 * - Otherwise it waits at most `waitMs` for the server; past that, that
 *   sentence is spoken by the device voice instead (and the audio is kept for
 *   next time).
 * - When the service is not configured, unreachable or failing repeatedly, the
 *   engine stops asking and uses the device voice for the rest of the session.
 */

export interface AudioPlayer {
  play(source: string, callbacks: { onEnd: () => void; onError: (error: unknown) => void }): void;
  stop(): void;
  isPlaying(): boolean;
}

export interface NeuralSpeechOptions {
  /** Returns a playable source (object URL / data URI) for the sentence. `now` when it is about to be spoken. */
  synthesize: (text: string, priority: 'now' | 'soon') => Promise<string>;
  fallback: SpeechEngine;
  player: AudioPlayer;
  /** Releases a source evicted from the cache (e.g. URL.revokeObjectURL). */
  release?: (source: string) => void;
  /** An error after which asking again is pointless (not configured, no access, quota spent). */
  isPermanentError?: (error: unknown) => boolean;
  /** Called once when the engine gives up on natural audio for the session. */
  onUnavailable?: () => void;
  /** Longest wait for natural audio before an urgent prompt uses the device voice. */
  waitMs?: number;
  /** Same for routine prompts, which are spoken well ahead of the maneuver. */
  routineWaitMs?: number;
  cacheLimit?: number;
  timers?: {
    setTimeout: (fn: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
  };
}

export interface NeuralSpeechEngine extends SpeechEngine {
  /** Fetches audio for sentences that are likely to be spoken soon. */
  prefetch(texts: string[]): void;
  /** False once the service has been given up on for this session. */
  readonly available: boolean;
}

const BLOCKED = /notallowed|not-allowed/i;
const MAX_CONSECUTIVE_FAILURES = 3;
/** Prefetch politely: a couple of requests at a time. */
const PREFETCH_CONCURRENCY = 2;

const errorText = (error: unknown) =>
  typeof error === 'object' && error !== null
    ? String((error as { name?: unknown }).name ?? '') + String((error as { message?: unknown }).message ?? '')
    : String(error ?? '');

export function createNeuralSpeechEngine(options: NeuralSpeechOptions): NeuralSpeechEngine {
  const {
    synthesize,
    fallback,
    player,
    release,
    isPermanentError = () => false,
    onUnavailable,
    waitMs = 1200,
    routineWaitMs = 3500,
    cacheLimit = 160,
    timers = {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
  } = options;

  /** Sentence → playable source, or undefined while being fetched. */
  const cache = new Map<string, string>();
  const pending = new Map<string, Promise<string | undefined>>();
  let failures = 0;
  let disabled = false;
  let token = 0;
  let waiting = false;
  let waitTimer: unknown;

  const remember = (text: string, source: string) => {
    cache.set(text, source);
    while (cache.size > cacheLimit) {
      const oldest = cache.keys().next().value as string;
      const evicted = cache.get(oldest);
      cache.delete(oldest);
      if (evicted) release?.(evicted);
    }
  };

  const giveUp = () => {
    if (disabled) return;
    disabled = true;
    onUnavailable?.();
  };

  const load = (text: string, priority: 'now' | 'soon'): Promise<string | undefined> => {
    const hit = cache.get(text);
    if (hit) {
      // Recently used sentences stay cached.
      cache.delete(text);
      cache.set(text, hit);
      return Promise.resolve(hit);
    }
    if (disabled) return Promise.resolve(undefined);
    const inFlight = pending.get(text);
    if (inFlight) return inFlight;
    const request = synthesize(text, priority)
      .then((source) => {
        failures = 0;
        remember(text, source);
        return source;
      })
      .catch((error: unknown) => {
        failures += 1;
        if (isPermanentError(error) || failures >= MAX_CONSECUTIVE_FAILURES) giveUp();
        return undefined;
      })
      .finally(() => pending.delete(text));
    pending.set(text, request);
    return request;
  };

  const clearWait = () => {
    if (waitTimer !== undefined) timers.clearTimeout(waitTimer);
    waitTimer = undefined;
    waiting = false;
  };

  return {
    get available() {
      return !disabled;
    },

    prefetch(texts) {
      if (disabled) return;
      const queue = [...new Set(texts)].filter((text) => text && !cache.has(text) && !pending.has(text));
      const next = (): Promise<void> => {
        const text = queue.shift();
        if (!text || disabled) return Promise.resolve();
        return load(text, 'soon').then(next);
      };
      for (let i = 0; i < PREFETCH_CONCURRENCY; i++) void next();
    },

    speak(text, callbacks, speakOptions) {
      const mine = ++token;
      clearWait();
      const useFallback = () => {
        if (mine !== token) return;
        clearWait();
        fallback.speak(text, callbacks);
      };
      if (disabled && !cache.has(text)) {
        useFallback();
        return;
      }
      waiting = true;
      let settled = false;
      waitTimer = timers.setTimeout(() => {
        if (settled) return;
        settled = true;
        useFallback();
      }, speakOptions?.urgent === false ? routineWaitMs : waitMs);
      void load(text, 'now').then((source) => {
        if (settled || mine !== token) return;
        settled = true;
        clearWait();
        if (!source) {
          fallback.speak(text, callbacks);
          return;
        }
        player.play(source, {
          onEnd: () => {
            if (mine === token) callbacks.onDone();
          },
          onError: (error) => {
            if (mine !== token) return;
            // A browser autoplay block is reported (the queue shows "tap to enable");
            // anything else falls back to the device voice for this sentence.
            if (BLOCKED.test(errorText(error))) callbacks.onError({ error: 'not-allowed' });
            else fallback.speak(text, callbacks);
          },
        });
      });
    },

    stop() {
      token++;
      clearWait();
      player.stop();
      fallback.stop();
    },

    isSpeaking() {
      return waiting || player.isPlaying() || Boolean(fallback.isSpeaking?.());
    },
  };
}
