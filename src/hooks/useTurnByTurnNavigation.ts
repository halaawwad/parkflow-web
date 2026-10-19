import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, Platform } from 'react-native';
import * as Location from 'expo-location';
import type { Locale } from '@/i18n';
import { services } from '@/services';
import type { GeoPoint, RouteRequestOptions, RouteResult } from '@/types';
import { AppError } from '@/utils/errors';
import { distanceMeters } from '@/utils/geo';
import { buildNavigationRoute } from '@/utils/navigation/maneuvers';
import { arrivedPhrase, maneuverInstruction, systemPhrases } from '@/utils/navigation/instructions';
import {
  guidanceReliable,
  initialNavigationState,
  navigationReducer,
  remainingVia,
  routeRequestDue,
  type LocationFix,
  type NavigationState,
} from '@/utils/navigation/session';
import { markSpoken, planAnnouncement } from '@/utils/navigation/voiceScheduler';
import { SpeechQueue, type SpeechQueueStatus } from '@/utils/navigation/speechQueue';
import { chooseVoice, createSpeechEngine, keepScreenAwake, vibrateFor, type VoiceChoice } from '@/utils/navigation/platform';
import { useNavigationSessionStore } from '@/store/navigationSessionStore';

/**
 * Live turn-by-turn session: owns the GPS watcher, routing requests, the voice
 * queue and device cues, and feeds everything through the pure session reducer
 * (`utils/navigation/session.ts`). One instance lives on the map screen.
 */

export interface NavigationTarget {
  destination: GeoPoint;
  name: string;
  via?: GeoPoint[];
  /** A route already on screen. Used when it starts where the driver is, so guidance begins instantly. */
  initialRoute?: RouteResult;
  routeOptions?: Pick<RouteRequestOptions, 'mode' | 'snapDestination'>;
}

const TICK_MS = 2_000;
/** A route shown before starting is reused only if it begins this close to the first GPS fix. */
const INITIAL_ROUTE_MAX_OFFSET = 60;

function toFix(position: Location.LocationObject): LocationFix {
  const { coords } = position;
  const finite = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  return {
    point: { latitude: coords.latitude, longitude: coords.longitude },
    accuracy: finite(coords.accuracy),
    heading: finite(coords.heading),
    speed: finite(coords.speed),
    timestamp: position.timestamp || Date.now(),
  };
}

const isOfflineError = (error: unknown) =>
  (error instanceof AppError && error.code === 'network') ||
  (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.onLine === false);

export function useTurnByTurnNavigation(locale: Locale) {
  const [state, dispatch] = useReducer(navigationReducer, initialNavigationState);
  const stateRef = useRef<NavigationState>(state);
  stateRef.current = state;
  const targetRef = useRef<NavigationTarget | undefined>(undefined);
  const requestRef = useRef(0);
  const inFlightRef = useRef(false);
  const spokenRef = useRef(new Set<string>());
  const [muted, setMutedState] = useState(false);
  const [vibration, setVibration] = useState(true);
  const [following, setFollowing] = useState(true);
  const [liveMessage, setLiveMessage] = useState('');
  const [voiceStatus, setVoiceStatus] = useState<SpeechQueueStatus>({ speaking: false, blocked: false, errors: 0 });
  const [voice, setVoice] = useState<VoiceChoice>({ language: locale === 'ar' ? 'ar-SA' : 'en-US', available: true });
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const vibrationRef = useRef(vibration);
  vibrationRef.current = vibration;
  const backgroundRef = useRef(AppState.currentState !== 'active');
  const screenReaderRef = useRef(false);
  const setActive = useNavigationSessionStore((s) => s.setActive);

  const queueRef = useRef<SpeechQueue | undefined>(undefined);
  if (!queueRef.current) {
    queueRef.current = new SpeechQueue(
      createSpeechEngine(() => voiceRef.current, () => (localeRef.current === 'ar' ? 0.92 : 0.98)),
      setVoiceStatus,
    );
  }
  const queue = queueRef.current;

  // Unmount (or a dev remount) silences speech; the queue itself stays usable.
  useEffect(() => () => queue.clear(), [queue]);

  useEffect(() => {
    let cancelled = false;
    void chooseVoice(locale).then((choice) => {
      if (!cancelled) setVoice(choice);
    });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  useEffect(() => {
    void AccessibilityInfo.isScreenReaderEnabled().then((enabled) => {
      screenReaderRef.current = enabled;
    }).catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', (enabled) => {
      screenReaderRef.current = enabled;
    });
    return () => subscription.remove();
  }, []);

  /** Speaks (unless muted or backgrounded) and mirrors the message to assistive technology. */
  const say = useCallback(
    (text: string, options: { priority?: 'normal' | 'high'; instruction?: boolean; isCurrent?: () => boolean } = {}) => {
      setLiveMessage(text);
      if (backgroundRef.current) return;
      queue.enqueue({ text, priority: options.priority, instruction: options.instruction, isCurrent: options.isCurrent });
      // A screen-reader user with voice muted still hears guidance through their reader.
      if (queue.isMuted && screenReaderRef.current && Platform.OS !== 'web') {
        AccessibilityInfo.announceForAccessibility(text);
      }
    },
    [queue],
  );

  const navigating = state.status !== 'idle';
  useEffect(() => {
    setActive(navigating);
  }, [navigating, setActive]);
  useEffect(() => () => setActive(false), [setActive]);

  // ---- GPS ---------------------------------------------------------------
  const watching = (state.status === 'locating' || state.status === 'routing' || state.status === 'active' || state.status === 'rerouting') && !state.paused;
  useEffect(() => {
    if (!watching) return;
    let subscription: Location.LocationSubscription | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (permission.status !== 'granted') {
          dispatch({ type: 'permission-denied' });
          return;
        }
        const sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
          (position) => dispatch({ type: 'fix', fix: toFix(position), now: Date.now() }),
          (reason) => {
            if (/denied|permission/i.test(reason)) dispatch({ type: 'permission-denied' });
            else dispatch({ type: 'location-unavailable' });
          },
        );
        if (cancelled) sub.remove();
        else subscription = sub;
      } catch (error) {
        if (cancelled) return;
        dispatch(/denied|permission/i.test(String((error as Error)?.message)) ? { type: 'permission-denied' } : { type: 'location-unavailable' });
      }
    })();
    const tick = setInterval(() => dispatch({ type: 'tick', now: Date.now() }), TICK_MS);
    return () => {
      cancelled = true;
      clearInterval(tick);
      subscription?.remove();
    };
  }, [watching]);

  // Keep the screen on for the whole session.
  useEffect(() => (navigating && state.status !== 'error' ? keepScreenAwake() : undefined), [navigating, state.status]);

  // Background: stay quiet (the OS stops foreground location anyway); resume cleanly.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      const background = next !== 'active';
      if (background === backgroundRef.current) return;
      backgroundRef.current = background;
      if (background) queue.clear();
      else if (stateRef.current.status === 'active') {
        spokenRef.current.clear();
        dispatch({ type: 'resume', now: Date.now() });
      }
    });
    return () => subscription.remove();
  }, [queue]);

  // ---- Routing -----------------------------------------------------------
  const requestRoute = useCallback(async () => {
    const current = stateRef.current;
    const target = targetRef.current;
    const fix = current.lastGoodFix;
    if (!target || !fix || inFlightRef.current) return;
    const now = Date.now();
    const via = current.route ? remainingVia(current) : target.via ?? [];

    // Reuse the route already on screen when it starts where the driver is.
    if (current.status === 'locating' && target.initialRoute) {
      const initial = buildNavigationRoute(target.initialRoute, via);
      target.initialRoute = undefined;
      if (initial && distanceMeters(initial.line[0]!, fix.point) <= INITIAL_ROUTE_MAX_OFFSET) {
        dispatch({ type: 'route-requested', now });
        dispatch({ type: 'route-ready', route: initial, now });
        return;
      }
    }

    const request = ++requestRef.current;
    inFlightRef.current = true;
    dispatch({ type: 'route-requested', now });
    const reroute = Boolean(current.route);
    if (reroute) say(systemPhrases.rerouting(localeRef.current));
    try {
      const result = await services.routing.getRoute(fix.point, target.destination, {
        ...target.routeOptions,
        steps: true,
        via: via.length ? via : undefined,
        // Start the new route in the direction the car is already moving.
        originBearing: current.speed >= 2 && current.heading !== undefined ? Math.round(current.heading) % 360 : undefined,
      });
      if (request !== requestRef.current) return;
      const route = buildNavigationRoute(result, via);
      if (!route) {
        dispatch({ type: 'route-failed', reason: reroute ? 'offline' : 'no-guidance', now: Date.now() });
        return;
      }
      spokenRef.current.clear();
      dispatch({ type: 'route-ready', route, now: Date.now() });
    } catch (error) {
      if (request !== requestRef.current) return;
      dispatch({ type: 'route-failed', reason: isOfflineError(error) ? 'offline' : 'error', now: Date.now() });
    } finally {
      if (request === requestRef.current) inFlightRef.current = false;
    }
  }, [say]);

  useEffect(() => {
    if (routeRequestDue(state, Date.now())) void requestRoute();
  }, [state, requestRoute]);

  // ---- Voice, vibration and status announcements ------------------------
  const previous = useRef<NavigationState>(initialNavigationState);
  useEffect(() => {
    const prev = previous.current;
    previous.current = state;
    const lang = localeRef.current;
    const route = state.route;

    if (state.status === 'arrived' && prev.status !== 'arrived') {
      const arrival = route?.maneuvers[route.maneuvers.length - 1];
      queue.clear();
      say(arrivedPhrase(arrival?.side, lang), { priority: 'high', instruction: true });
      if (vibrationRef.current) vibrateFor('arrived');
      return;
    }
    if (state.status === 'active' && state.epoch === 1 && prev.epoch === 0) say(systemPhrases.start(lang));
    else if (state.epoch > prev.epoch && prev.epoch > 0) say(systemPhrases.rerouted(lang));

    if (state.wrongWay && !prev.wrongWay) {
      say(systemPhrases.wrongWay(lang), { priority: 'high' });
      if (vibrationRef.current) vibrateFor('alert');
    }
    if (state.route && state.signal !== 'good' && prev.signal === 'good') {
      // Never keep reading out instructions that may no longer be true.
      queue.clear();
      say(state.signal === 'lost' ? systemPhrases.signalLost(lang) : systemPhrases.weakSignal(lang), { priority: 'high' });
    } else if (state.signal === 'good' && prev.signal !== 'good' && state.route) {
      say(systemPhrases.signalRestored(lang));
    }
    if (state.offline && !prev.offline) say(systemPhrases.offline(lang));

    // A stop on a multi-stop route was just passed.
    if (route && prev.route === route && prev.progress && state.progress && state.progress.nextIndex > prev.progress.nextIndex) {
      const passed = route.maneuvers.slice(prev.progress.nextIndex, state.progress.nextIndex).find((m) => m.kind === 'waypoint');
      if (passed) say(arrivedPhrase(passed.side, lang, true), { priority: 'high' });
    }

    if (!guidanceReliable(state) || !route || state.offRouteCount > 0) return;
    const announcement = planAnnouncement({ route, progress: state.progress!, speed: state.speed, spoken: spokenRef.current, locale: lang });
    if (!announcement) return;
    markSpoken(spokenRef.current, announcement);
    // If this has to wait behind another prompt, drop it once the driver is past that maneuver.
    const isCurrent = () => {
      const now = stateRef.current;
      return now.route === route && guidanceReliable(now) && (now.progress?.nextIndex ?? 0) <= announcement.maneuverIndex;
    };
    say(announcement.text, { priority: announcement.priority, instruction: true, isCurrent });
    if (announcement.tier === 'now' && vibrationRef.current) {
      vibrateFor(route.maneuvers[state.progress!.nextIndex]!.kind);
    }
  }, [state, queue, say]);

  // ---- Controls ----------------------------------------------------------
  const start = useCallback(
    (target: NavigationTarget) => {
      requestRef.current++;
      inFlightRef.current = false;
      spokenRef.current.clear();
      queue.reset();
      targetRef.current = { ...target };
      setFollowing(true);
      setLiveMessage('');
      dispatch({ type: 'start', now: Date.now() });
    },
    [queue],
  );

  const stop = useCallback(() => {
    requestRef.current++;
    inFlightRef.current = false;
    targetRef.current = undefined;
    queue.reset();
    setLiveMessage(systemPhrases.stopped(localeRef.current));
    dispatch({ type: 'stop' });
  }, [queue]);

  const pause = useCallback(() => {
    queue.clear();
    say(systemPhrases.paused(localeRef.current));
    dispatch({ type: 'pause' });
  }, [queue, say]);

  const resume = useCallback(() => {
    spokenRef.current.clear();
    say(systemPhrases.resumed(localeRef.current));
    dispatch({ type: 'resume', now: Date.now() });
  }, [say]);

  const setMuted = useCallback(
    (next: boolean) => {
      queue.setMuted(next);
      setMutedState(next);
    },
    [queue],
  );

  /** Repeats the current instruction; falls back to describing the next maneuver if nothing was said yet. */
  const repeat = useCallback(() => {
    const current = stateRef.current;
    if (queue.isMuted) {
      queue.setMuted(false);
      setMutedState(false);
    }
    if (queue.repeat()) return;
    const route = current.route;
    const progress = current.progress;
    if (route && progress) {
      const maneuver = route.maneuvers[progress.nextIndex]!;
      say(maneuverInstruction(maneuver, localeRef.current), { priority: 'high', instruction: true });
    }
  }, [queue, say]);

  /** Retries after an error (e.g. the user granted location permission in settings). */
  const retry = useCallback(() => {
    const target = targetRef.current;
    if (target) start(target);
  }, [start]);

  return {
    state,
    target: targetRef.current,
    start,
    stop,
    pause,
    resume,
    retry,
    muted,
    setMuted,
    repeat,
    vibration,
    setVibration,
    following,
    setFollowing,
    liveMessage,
    voiceStatus,
    voice,
  };
}

export type TurnByTurnNavigation = ReturnType<typeof useTurnByTurnNavigation>;
