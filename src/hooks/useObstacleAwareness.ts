import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { Locale } from '@/i18n';
import { ObstacleAwarenessEngine } from '@/utils/obstacles/engine';
import { startObstacleCamera, type ObstacleCamera, type ObstacleCameraFailure } from '@/utils/obstacles/camera';
import { describeObstacles, statusAnnouncement, type AnnouncementPriority, type ObstacleStatus, type ObstacleUnavailable } from '@/utils/obstacles/warnings';

/**
 * Camera obstacle awareness for a walking session. Runs only while `enabled`,
 * speaks through the guidance voice (`announce`) so it never talks over a
 * turn instruction, and says so whenever it stops or cannot be trusted.
 */

const TICK_MS = 1_000;
/** A warning still waiting after this long describes a scene that has moved on. */
const STALE_WARNING_MS = 2_000;

export function useObstacleAwareness({
  enabled,
  locale,
  announce,
}: {
  enabled: boolean;
  locale: Locale;
  announce: (text: string, priority: AnnouncementPriority, options?: { immediate?: boolean; isCurrent?: () => boolean }) => void;
}) {
  const [status, setStatusState] = useState<ObstacleStatus>({ state: 'off' });
  const [paused, setPaused] = useState(false);
  /** Bumped by "try again" after a camera or model error. */
  const [attempt, setAttempt] = useState(0);
  const [stream, setStream] = useState<unknown>(undefined);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const statusRef = useRef(status);
  const announceRef = useRef(announce);
  announceRef.current = announce;
  const localeRef = useRef(locale);
  localeRef.current = locale;

  /** A failure retrying cannot fix (no camera support, permission refused): kept for the session. */
  const blockedRef = useRef<ObstacleUnavailable | undefined>(undefined);

  const setStatus = useCallback((next: ObstacleStatus) => {
    const previous = statusRef.current;
    if (previous.state === next.state && (previous as { reason?: string }).reason === (next as { reason?: string }).reason) return;
    statusRef.current = next;
    setStatusState(next);
    const message = statusAnnouncement(previous, next, localeRef.current);
    // Losing the camera mid-walk is said at once, in whatever voice is ready.
    if (message) announceRef.current(message.text, message.priority, { immediate: message.priority === 'urgent' });
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => setForeground(next === 'active'));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!enabled) {
      blockedRef.current = undefined;
      setStatus({ state: 'off' });
      return;
    }
    // Unsupported or refused: said once; retrying would only repeat it.
    if (blockedRef.current) return;
    if (paused) {
      setStatus({ state: 'paused' });
      return;
    }
    // Background: the OS takes the camera away; never pretend it is still watching.
    if (!foreground) {
      setStatus({ state: 'unavailable', reason: 'background' });
      return;
    }

    let cancelled = false;
    let camera: ObstacleCamera | undefined;
    const engine = new ObstacleAwarenessEngine();
    engine.reset(Date.now());
    if (statusRef.current.state === 'off') setStatus({ state: 'starting' });

    const onFailure = (reason: ObstacleCameraFailure) => {
      if (cancelled) return;
      if (reason === 'unsupported' || reason === 'permission-denied' || reason === 'front-camera') blockedRef.current = reason;
      setStream(undefined);
      setStatus({ state: 'unavailable', reason });
    };
    void startObstacleCamera((frame) => {
      if (cancelled) return;
      const output = engine.frame(frame);
      if (output.warning) {
        // Close and in the path cuts in over everything; the rest waits behind a turn
        // instruction, and is dropped rather than read out once it is stale.
        const at = Date.now();
        announceRef.current(describeObstacles(output.warning, localeRef.current), output.warning.priority, {
          immediate: true,
          isCurrent: () => Date.now() - at <= STALE_WARNING_MS,
        });
      }
      setStatus(output.reliability.reliable ? { state: 'active' } : { state: 'unreliable', reason: output.reliability.reason! });
    }, onFailure).then((started) => {
      if (cancelled) {
        started?.stop();
        return;
      }
      camera = started;
      if (!started) return;
      // The model download can take a while; stall detection starts once frames can flow.
      engine.reset(Date.now());
      setStream(started.stream);
    });

    const tick = setInterval(() => {
      if (cancelled || !camera) return;
      const reliability = engine.tick(Date.now());
      if (!reliability.reliable) setStatus({ state: 'unreliable', reason: reliability.reason! });
    }, TICK_MS);

    return () => {
      cancelled = true;
      clearInterval(tick);
      camera?.stop();
      setStream(undefined);
    };
  }, [enabled, paused, foreground, attempt, setStatus]);

  // A new session starts unpaused.
  useEffect(() => {
    if (!enabled) setPaused(false);
  }, [enabled]);

  return {
    status,
    paused,
    pause: useCallback(() => setPaused(true), []),
    resume: useCallback(() => setPaused(false), []),
    retry: useCallback(() => setAttempt((n) => n + 1), []),
    /** The live camera stream for the preview (web only). */
    stream,
  };
}
