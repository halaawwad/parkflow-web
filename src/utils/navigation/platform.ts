import { Platform, Vibration } from 'react-native';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import type { GuidanceLocale } from './instructions';
import type { ManeuverKind } from './maneuvers';
import type { SpeechEngine } from './speechQueue';

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
}

const LANGUAGE: Record<GuidanceLocale, string> = { ar: 'ar-SA', en: 'en-US' };

/** Picks the best installed voice: enhanced quality first, then a Gulf/Levant/Egyptian Arabic or US English locale. */
export async function chooseVoice(locale: GuidanceLocale): Promise<VoiceChoice> {
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    const prefix = locale === 'ar' ? 'ar' : 'en';
    const candidates = voices.filter((voice) => voice.language?.toLowerCase().replace('_', '-').startsWith(prefix));
    if (!candidates.length) return { language: LANGUAGE[locale], available: false };
    const preferred = locale === 'ar' ? ['ar-sa', 'ar-jo', 'ar-ps', 'ar-ae', 'ar-eg'] : ['en-us', 'en-gb'];
    const score = (voice: Speech.Voice) => {
      const lang = voice.language.toLowerCase().replace('_', '-');
      const rank = preferred.indexOf(lang);
      return (voice.quality === Speech.VoiceQuality.Enhanced ? 0 : 10) + (rank === -1 ? 5 : rank);
    };
    const best = [...candidates].sort((a, b) => score(a) - score(b))[0]!;
    return { language: best.language, voice: best.identifier, available: true };
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
