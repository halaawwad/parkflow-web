import { Platform, Vibration } from 'react-native';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import type { GuidanceLocale } from './instructions';
import type { ManeuverKind } from './maneuvers';
import type { SpeechEngine } from './speechQueue';
import { createNeuralSpeechEngine, type AudioPlayer, type NeuralSpeechEngine } from './neuralSpeech';
import { services } from '@/services';
import { AppError } from '@/utils/errors';

/**
 * Device glue for navigation: the speech engine behind the queue, the voice
 * picked for each language, vibration cues and keeping the screen awake.
 * Everything here fails soft — guidance must keep working on screen even when
 * a device has no voice, no vibration motor or refuses a wake lock.
 */

export interface VoiceChoice {
  language: string;
  voice?: string;
  /** False when the device has no voice for this language (the system default will be tried). */
  available: boolean;
  /**
   * A natural-sounding voice (neural / online / Google / premium). Legacy
   * desktop voices — e.g. Windows' Arabic "Naayf" — are robotic, and the web
   * app would rather stay quiet than speak with one.
   */
  natural?: boolean;
}

const NATURAL_VOICE = /natural|neural|online|google|premium|enhanced|siri/i;

const LANGUAGE: Record<GuidanceLocale, string> = { ar: 'ar-SA', en: 'en-US' };

/** Picks the best installed voice: enhanced quality first, then a Gulf/Levant/Egyptian Arabic or US English locale. */
export async function chooseVoice(locale: GuidanceLocale): Promise<VoiceChoice> {
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    const prefix = locale === 'ar' ? 'ar' : 'en';
    const candidates = voices.filter((voice) => voice.language?.toLowerCase().replace('_', '-').startsWith(prefix));
    if (!candidates.length) return { language: LANGUAGE[locale], available: false };
    const preferred = locale === 'ar' ? ['ar-sa', 'ar-jo', 'ar-ps', 'ar-ae', 'ar-eg'] : ['en-us', 'en-gb'];
    // Natural/neural voices (Edge "Online (Natural)", Google, Apple premium) sound far
    // less robotic than legacy desktop voices, so they win regardless of dialect.
    const natural = NATURAL_VOICE;
    const score = (voice: Speech.Voice) => {
      const lang = voice.language.toLowerCase().replace('_', '-');
      const rank = preferred.indexOf(lang);
      const quality = voice.quality === Speech.VoiceQuality.Enhanced || natural.test(voice.name ?? '') ? 0 : 20;
      return quality + (rank === -1 ? 5 : rank);
    };
    const best = [...candidates].sort((a, b) => score(a) - score(b))[0]!;
    // Phone voices (Android, iOS) are neural already; only desktop browsers ship robotic ones.
    const isNatural = Platform.OS !== 'web' || best.quality === Speech.VoiceQuality.Enhanced || natural.test(best.name ?? '');
    return { language: best.language, voice: best.identifier, available: true, natural: isNatural };
  } catch {
    return { language: LANGUAGE[locale], available: false };
  }
}

const STOP_CODES = /interrupted|canceled|cancelled/i;

function errorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error ?? '');
  const record = error as { error?: unknown; message?: unknown; nativeEvent?: { error?: unknown } };
  return String(record.nativeEvent?.error ?? record.error ?? record.message ?? '');
}

/**
 * Web engine on the Speech Synthesis API directly. expo-speech's web `speak`
 * awaits the voice list before queueing the utterance, so a `stop()` issued in
 * that gap cancels nothing and the "interrupted" prompt still plays. Calling the
 * browser synchronously keeps interruption exact.
 */
function createWebSpeechEngine(synth: SpeechSynthesis, voice: () => VoiceChoice, rate: () => number): SpeechEngine {
  return {
    speak(text, callbacks) {
      const choice = voice();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = choice.language;
      utterance.rate = rate();
      const match = choice.voice ? synth.getVoices().find((v) => v.voiceURI === choice.voice) : undefined;
      if (match) utterance.voice = match;
      utterance.onend = () => callbacks.onDone();
      utterance.onerror = (event) => {
        if (STOP_CODES.test(event.error)) callbacks.onStopped();
        else callbacks.onError({ error: event.error });
      };
      // Chrome can be left paused after a tab switch; an utterance queued then never starts.
      if (synth.paused) synth.resume();
      synth.speak(utterance);
    },
    stop() {
      synth.cancel();
    },
    isSpeaking() {
      return synth.speaking;
    },
  };
}

/** Speech engine for the platform. Cancelling an utterance on web fires an "interrupted" error, which is a stop, not a failure. */
export function createSpeechEngine(voice: () => VoiceChoice, rate: () => number): SpeechEngine {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.speechSynthesis && typeof SpeechSynthesisUtterance !== 'undefined') {
    return createWebSpeechEngine(window.speechSynthesis, voice, rate);
  }
  return {
    speak(text, callbacks) {
      const choice = voice();
      Speech.speak(text, {
        language: choice.language,
        voice: choice.voice,
        rate: rate(),
        onDone: callbacks.onDone,
        onStopped: callbacks.onStopped,
        onError: (error) => {
          const code = errorCode(error);
          if (STOP_CODES.test(code)) callbacks.onStopped();
          else callbacks.onError({ error: code || 'unknown' });
        },
      });
    },
    stop() {
      void Speech.stop().catch(() => undefined);
    },
  };
}

const LEFT = new Set<ManeuverKind>(['left', 'slight-left', 'sharp-left', 'keep-left']);
const RIGHT = new Set<ManeuverKind>(['right', 'slight-right', 'sharp-right', 'keep-right']);

/**
 * Distinct vibration per direction so it can be felt without looking:
 * left = two short pulses, right = one long pulse, U-turn = three pulses.
 */
export function vibrateFor(kind: ManeuverKind | 'arrived' | 'alert'): void {
  const pattern = kind === 'arrived'
    ? [0, 120, 80, 120, 80, 300]
    : kind === 'alert' || kind === 'uturn'
      ? [0, 90, 70, 90, 70, 90]
      : LEFT.has(kind)
        ? [0, 90, 90, 90]
        : RIGHT.has(kind)
          ? [0, 320]
          : [0, 60];
  try {
    if (Platform.OS === 'web') {
      const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { vibrate?: (p: number[]) => boolean }) : undefined;
      nav?.vibrate?.(pattern.slice(1));
      return;
    }
    if (Platform.OS === 'ios') {
      // iOS ignores custom patterns; use distinct haptics instead.
      const style = RIGHT.has(kind as ManeuverKind) ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Medium;
      void Haptics.impactAsync(style).catch(() => undefined);
      if (LEFT.has(kind as ManeuverKind)) setTimeout(() => void Haptics.impactAsync(style).catch(() => undefined), 180);
      return;
    }
    Vibration.vibrate(pattern);
  } catch {
    // Vibration is an optional cue.
  }
}

type WakeLockSentinel = { release: () => Promise<void> };

/** Keeps the screen on while navigating (web Screen Wake Lock API). Returns a release function. */
export function keepScreenAwake(): () => void {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined' || typeof document === 'undefined') return () => undefined;
  const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinel> } }).wakeLock;
  if (!wakeLock) return () => undefined;
  let sentinel: WakeLockSentinel | undefined;
  let released = false;
  const acquire = () => {
    if (released || document.visibilityState !== 'visible') return;
    wakeLock.request('screen').then((lock) => {
      if (released) void lock.release().catch(() => undefined);
      else sentinel = lock;
    }).catch(() => undefined);
  };
  // The browser drops the lock when the tab is hidden; take it again on return.
  document.addEventListener('visibilitychange', acquire);
  acquire();
  return () => {
    released = true;
    document.removeEventListener('visibilitychange', acquire);
    void sentinel?.release().catch(() => undefined);
  };
}

/**
 * Mobile browsers (iOS Safari above all) only let a page make sound that a tap
 * started. Navigation speaks seconds after "Start" is tapped — once GPS and the
 * route are ready — so without this every prompt is silently dropped. Calling
 * `unlockWebAudio()` inside the tap primes both outputs: a silent utterance for
 * the browser voice and a silent clip on the one audio element that then plays
 * every natural-voice sentence (a new element would need its own tap).
 */
let sharedAudio: HTMLAudioElement | undefined;
let silentClip: string | undefined;

function webAudio(): HTMLAudioElement | undefined {
  if (Platform.OS !== 'web' || typeof Audio === 'undefined') return undefined;
  sharedAudio ??= new Audio();
  return sharedAudio;
}

/** 0.1 s of silence as a WAV object URL, built once. */
function silence(): string {
  if (silentClip) return silentClip;
  const samples = 800;
  const view = new DataView(new ArrayBuffer(44 + samples * 2));
  const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples * 2, true);
  silentClip = URL.createObjectURL(new Blob([view.buffer], { type: 'audio/wav' }));
  return silentClip;
}

/** Call synchronously inside a tap (Start, Resume, Repeat, Unmute). Safe to call often. */
export function unlockWebAudio(): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try {
    const synth = window.speechSynthesis;
    if (synth && typeof SpeechSynthesisUtterance !== 'undefined' && !synth.speaking) {
      const primer = new SpeechSynthesisUtterance(' ');
      primer.volume = 0;
      synth.speak(primer);
    }
  } catch {
    // The browser voice is optional.
  }
  try {
    const audio = webAudio();
    if (audio && (audio.paused || audio.ended)) {
      audio.src = silence();
      void audio.play().catch(() => undefined);
    }
  } catch {
    // Natural voice falls back to the browser voice when audio cannot play.
  }
}

/** Plays natural-voice sentences on the single, tap-unlocked audio element. */
function createWebAudioPlayer(): AudioPlayer {
  let token = 0;
  let playing = false;
  return {
    play(source, callbacks) {
      const audio = webAudio();
      if (!audio) {
        callbacks.onError(new Error('audio unavailable'));
        return;
      }
      const mine = ++token;
      playing = true;
      audio.onended = () => {
        if (mine !== token) return;
        playing = false;
        callbacks.onEnd();
      };
      audio.onerror = () => {
        if (mine !== token) return;
        playing = false;
        callbacks.onError(audio.error ?? new Error('audio error'));
      };
      audio.src = source;
      audio.play().catch((error: unknown) => {
        // stop() or a newer sentence interrupted this one: not a failure to report.
        if (mine !== token) return;
        playing = false;
        callbacks.onError(error);
      });
    },
    stop() {
      token++;
      playing = false;
      const audio = sharedAudio;
      if (audio) {
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
      }
    },
    isPlaying() {
      return playing && Boolean(sharedAudio && !sharedAudio.paused && !sharedAudio.ended);
    },
  };
}

function base64ToObjectUrl(base64: string, mimeType: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

/**
 * No server, no key, no access, or the voice quota is spent: stop asking for
 * this session. Giving up on a spent quota (429) keeps the rest of the trip in
 * one consistent voice instead of alternating between natural and device
 * speech sentence by sentence.
 */
function isPermanentVoiceError(error: unknown): boolean {
  if (!(error instanceof AppError)) return false;
  const status = Number(error.details?.status);
  // The API client reports any 5xx as a generic network error without the server's code,
  // so a 503 (not configured, or provider down) is recognised by status.
  return ['VOICE_NOT_CONFIGURED', 'VOICE_RATE_LIMITED'].includes(String(error.details?.serverCode))
    || [401, 403, 404, 429, 503].includes(status);
}

export type NavigationVoice = SpeechEngine & Pick<NeuralSpeechEngine, 'prefetch' | 'available' | 'retry'>;

/**
 * The voice navigation speaks with. On web: natural server-synthesised speech
 * (Gemini), falling back sentence by sentence to the browser voice. On device:
 * the platform voice, which on current Android and iOS is already a natural
 * neural voice.
 */
export function createNavigationVoice(
  voice: () => VoiceChoice,
  rate: () => number,
  locale: () => GuidanceLocale,
  /** Natural speech was given up on for this session; the device voice takes over. */
  onNaturalUnavailable?: () => void,
): NavigationVoice {
  const device = createSpeechEngine(voice, rate);
  if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof Audio === 'undefined') {
    return Object.assign(device, { prefetch: () => undefined, available: false, retry: () => undefined });
  }
  // On web the device voice stands in only when it sounds natural. A robotic
  // one is never used: the sentence stays on screen and in the live region.
  const naturalDevice = () => voice().natural === true;
  const fallback: SpeechEngine = {
    speak(text, callbacks, options) {
      // Obstacle warnings are the exception: heard at once in any voice beats silence.
      if (naturalDevice() || options?.immediate) device.speak(text, callbacks);
      else callbacks.onDone();
    },
    stop: () => device.stop(),
    isSpeaking: () => Boolean(device.isSpeaking?.()),
  };
  return createNeuralSpeechEngine({
    synthesize: (text, priority) => services.voice.speak(text, locale(), priority).then((r) => base64ToObjectUrl(r.audio, r.mimeType)),
    fallback,
    // With no natural device voice to step in, wait longer for the natural audio.
    waitMs: () => (naturalDevice() ? 1200 : 4000),
    routineWaitMs: () => (naturalDevice() ? 3500 : 9000),
    player: createWebAudioPlayer(),
    release: (source) => URL.revokeObjectURL(source),
    isPermanentError: isPermanentVoiceError,
    onUnavailable: onNaturalUnavailable,
  });
}
