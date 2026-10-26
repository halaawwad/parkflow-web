import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, Platform } from 'react-native';
import { watchLocation, type DevicePosition, type LocationWatch } from '@/utils/deviceLocation';
import type { Locale } from '@/i18n';
import { services } from '@/services';
import type { GeoPoint, RouteRequestOptions, RouteResult, TravelMode } from '@/types';
import { AppError } from '@/utils/errors';
import { distanceMeters } from '@/utils/geo';
import { buildNavigationRoute } from '@/utils/navigation/maneuvers';
import { arrivedPhrase, maneuverInstruction, systemPhrases } from '@/utils/navigation/instructions';
import {
  guidanceReliable,
  initialNavigationState,
  navigationReducer,
  remainingVia,
  resumeOnReturn,
  routeRequestDue,
  type LocationFix,
  type NavigationState,
} from '@/utils/navigation/session';
import { markSpoken, planAnnouncement, routeSentences, upcomingSentences } from '@/utils/navigation/voiceScheduler';
import { SpeechQueue, type SpeechPriority, type SpeechQueueStatus } from '@/utils/navigation/speechQueue';
import { chooseVoice, createNavigationVoice, keepScreenAwake, unlockWebAudio, vibrateFor, type NavigationVoice, type VoiceChoice } from '@/utils/navigation/platform';
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
  routeOptions?: Pick<RouteRequestOptions, 'mode' | 'snapDestination' | 'profile'>;
}

const TICK_MS = 2_000;
/** How long the "natural voice unavailable" notice stays up. */
const NATURAL_VOICE_NOTICE_MS = 10_000;
/** A route shown before starting is reused only if it begins this close to the first GPS fix. */
const INITIAL_ROUTE_MAX_OFFSET = 60;

function toFix(position: DevicePosition): LocationFix {
  const finite = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  return {
    point: { latitude: position.latitude, longitude: position.longitude },
    accuracy: finite(position.accuracy),
    heading: finite(position.heading),
    speed: finite(position.speed),
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
  const [following, setFollowingState] = useState(true);
  /** Map shows the whole remaining route instead of following the user. */
  const [overview, setOverview] = useState(false);
  const [liveMessage, setLiveMessage] = useState('');
  const [voiceStatus, setVoiceStatus] = useState<SpeechQueueStatus>({ speaking: false, blocked: false, errors: 0 });
  /** Briefly true after natural speech is given up on, so the switch to the device voice is explained once. */
  const [naturalVoiceNotice, setNaturalVoiceNotice] = useState(false);
  /** Natural speech was given up on for this session (sticky, unlike the notice). */
  const [naturalVoiceLost, setNaturalVoiceLost] = useState(false);
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

  const voiceEngineRef = useRef<NavigationVoice | undefined>(undefined);
  const queueRef = useRef<SpeechQueue | undefined>(undefined);
  if (!queueRef.current) {
    voiceEngineRef.current = createNavigationVoice(
      () => voiceRef.current,
      () => (localeRef.current === 'ar' ? 0.92 : 0.98),
      () => localeRef.current,
      () => {
        setNaturalVoiceLost(true);
        setNaturalVoiceNotice(true);
      },
    );
    queueRef.current = new SpeechQueue(voiceEngineRef.current, setVoiceStatus);
  }
  const queue = queueRef.current;

  useEffect(() => {
    if (!naturalVoiceNotice) return;
    const timer = setTimeout(() => setNaturalVoiceNotice(false), NATURAL_VOICE_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [naturalVoiceNotice]);

  // Unmount (or a dev remount) silences speech; the queue itself stays usable.
  useEffect(() => () => queue.clear(), [queue]);

  useEffect(() => {
    let cancelled = false;
    const pick = () => {
      void chooseVoice(locale).then((choice) => {
        if (!cancelled) setVoice(choice);
      });
    };
    pick();
    // Browsers fill their voice list after load; pick again once it arrives so a
    // natural voice (e.g. Edge's "Online (Natural)") is not missed.
    const synth = Platform.OS === 'web' && typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    synth?.addEventListener?.('voiceschanged', pick);
    return () => {
      cancelled = true;
      synth?.removeEventListener?.('voiceschanged', pick);
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
    (text: string, options: { priority?: SpeechPriority; instruction?: boolean; isCurrent?: () => boolean } = {}) => {
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
    let subscription: LocationWatch | undefined;
    let cancelled = false;
    void watchLocation(
      (position) => {
        if (!cancelled) dispatch({ type: 'fix', fix: toFix(position), now: Date.now() });
      },
      (error) => {
        if (!cancelled) dispatch(error === 'denied' ? { type: 'permission-denied' } : { type: 'location-unavailable' });
      },
    ).then((watch) => {
      if (cancelled) watch?.remove();
      else subscription = watch;
    });
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
  // Only a real absence re-announces where the user is: a blip (a call banner, a
  // quick app switch) must not replay the instruction they just heard.
  useEffect(() => {
    let backgroundSince = 0;
    const subscription = AppState.addEventListener('change', (next) => {
      const background = next !== 'active';
      if (background === backgroundRef.current) return;
      backgroundRef.current = background;
      if (background) {
        backgroundSince = Date.now();
        queue.clear();
      } else if (resumeOnReturn(stateRef.current, Date.now() - backgroundSince)) {
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
    // An accurate fix, or (after a short wait) the best one a computer or indoor phone can give.
    const fix = current.lastGoodFix ?? current.bestFix;
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
    if (reroute) say(systemPhrases.rerouting(localeRef.current, current.profile));
    try {
      const result = await services.routing.getRoute(fix.point, target.destination, {
        ...target.routeOptions,
        steps: true,
        via: via.length ? via : undefined,
        // Start the new route in the direction the car is already moving (walkers can turn on the spot).
        originBearing: current.profile === 'driving' && current.speed >= 2 && current.heading !== undefined ? Math.round(current.heading) % 360 : undefined,
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

  // ---- Natural voice prefetch -------------------------------------------
  // The "turn now" prompts and status lines are known once the route is: fetch
  // their audio up front so the urgent ones play instantly.
  useEffect(() => {
    const route = state.route;
    const voice = voiceEngineRef.current;
    if (!route || !voice?.available) return;
    const lang = localeRef.current;
    const arrival = route.maneuvers[route.maneuvers.length - 1];
    voice.prefetch([
      ...routeSentences(route, lang),
      arrivedPhrase(arrival?.side, lang),
      systemPhrases.rerouted(lang),
      systemPhrases.weakSignal(lang),
      systemPhrases.signalRestored(lang),
    ]);
  }, [state.route]);

  // Distance prompts depend on speed, so they are fetched just ahead of time:
  // the next maneuver's likely "in … metres" lines and the "continue for …"
  // line that follows it. The engine skips anything already cached.
  const progressForPrefetch = state.progress;
  const routeForPrefetch = state.route;
  const speedForPrefetch = state.speed;
  useEffect(() => {
    const voice = voiceEngineRef.current;
    if (!voice?.available || !routeForPrefetch || !progressForPrefetch) return;
    voice.prefetch(upcomingSentences({ route: routeForPrefetch, progress: progressForPrefetch, speed: speedForPrefetch, locale: localeRef.current }));
  }, [routeForPrefetch, progressForPrefetch, speedForPrefetch]);

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
    if (state.status === 'active' && state.epoch === 1 && prev.epoch === 0) say(systemPhrases.start(lang, state.profile));
    else if (state.epoch > prev.epoch && prev.epoch > 0) say(systemPhrases.rerouted(lang));

    if (state.wrongWay && !prev.wrongWay) {
      say(systemPhrases.wrongWay(lang, state.profile), { priority: 'high' });
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
      // Must run inside the Start tap: mobile browsers only allow sound a tap started.
      unlockWebAudio();
      queue.reset();
      // Each trip gives the natural voice a fresh chance; a spent quota may be back.
      voiceEngineRef.current?.retry();
      setNaturalVoiceLost(false);
      setNaturalVoiceNotice(false);
      targetRef.current = { ...target };
      const profile = target.routeOptions?.profile ?? 'driving';
      voiceEngineRef.current?.prefetch([systemPhrases.start(localeRef.current, profile), systemPhrases.rerouting(localeRef.current, profile)]);
      setFollowingState(true);
      setOverview(false);
      setLiveMessage('');
      dispatch({ type: 'start', now: Date.now(), profile });
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
    unlockWebAudio();
    spokenRef.current.clear();
    say(systemPhrases.resumed(localeRef.current));
    dispatch({ type: 'resume', now: Date.now() });
  }, [say]);

  const setMuted = useCallback(
    (next: boolean) => {
      if (!next) unlockWebAudio();
      queue.setMuted(next);
      setMutedState(next);
    },
    [queue],
  );

  /** Repeats the current instruction; falls back to describing the next maneuver if nothing was said yet. */
  const repeat = useCallback(() => {
    unlockWebAudio();
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

  /**
   * Switches between driving and walking mid-trip: same destination, a fresh
   * route from the new profile. The route already on screen is not reused —
   * it was planned for the other mode.
   */
  const switchProfile = useCallback(
    (profile: TravelMode) => {
      const target = targetRef.current;
      if (!target || stateRef.current.profile === profile) return;
      start({
        destination: target.destination,
        name: target.name,
        // Trip-need stops are planned for a car; a walk goes straight to the destination.
        via: profile === 'walking' ? undefined : target.via,
        routeOptions: { ...target.routeOptions, profile },
      });
    },
    [start],
  );

  /**
   * Speaks a message from outside guidance (a spoken request, obstacle
   * awareness) through the guidance queue, so two voices never overlap.
   */
  const announce = useCallback((text: string, priority: SpeechPriority = 'normal') => say(text, { priority }), [say]);

  /** Following and the full-route overview are exclusive camera modes. */
  const setFollowing = useCallback((next: boolean) => {
    setFollowingState(next);
    if (next) setOverview(false);
  }, []);
  const showOverview = useCallback(() => {
    setFollowingState(false);
    setOverview(true);
  }, []);

  return {
    state,
    target: targetRef.current,
    start,
    stop,
    pause,
    resume,
    retry,
    switchProfile,
    profile: state.profile,
    overview,
    showOverview,
    muted,
    setMuted,
    repeat,
    announce,
    vibration,
    setVibration,
    following,
    setFollowing,
    liveMessage,
    voiceStatus,
    voice,
    naturalVoiceNotice,
    naturalVoiceLost,
    /** Natural server voice in use (web, configured, reachable). */
    naturalVoice: Boolean(voiceEngineRef.current?.available),
  };
}

export type TurnByTurnNavigation = ReturnType<typeof useTurnByTurnNavigation>;
