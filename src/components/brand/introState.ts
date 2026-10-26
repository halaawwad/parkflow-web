import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

/**
 * Where the cold-start intro is, shared so the app underneath can time its own
 * entrance to the moment the intro lifts.
 *
 *  - `covering`: the intro stage is up and the app is mounting beneath it.
 *  - `handoff`: the stage is fading out; content beneath should settle in now.
 *  - `done`: no intro on screen (it finished, was skipped, or never plays).
 *
 * It starts as `done` whenever the intro will not play (already shown this
 * launch / browser session), so ordinary navigation never waits on it.
 */
export type IntroPhase = 'covering' | 'handoff' | 'done';

const SESSION_KEY = 'parkflow:intro-played';

let playedThisLaunch = false;

function alreadyPlayed(): boolean {
  if (playedThisLaunch) return true;
  if (Platform.OS !== 'web') return false;
  try {
    return window.sessionStorage.getItem(SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

let phase: IntroPhase = alreadyPlayed() ? 'done' : 'covering';
const listeners = new Set<() => void>();

export function markIntroPlayed() {
  playedThisLaunch = true;
  if (Platform.OS !== 'web') return;
  try {
    window.sessionStorage.setItem(SESSION_KEY, '1');
  } catch {
    // Private mode: the in-memory flag still prevents replays in this tab.
  }
}

export function setIntroPhase(next: IntroPhase) {
  if (phase === next || phase === 'done') return;
  phase = next;
  listeners.forEach((listener) => listener());
}

export function getIntroPhase(): IntroPhase {
  return phase;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useIntroPhase(): IntroPhase {
  return useSyncExternalStore(subscribe, getIntroPhase, getIntroPhase);
}
