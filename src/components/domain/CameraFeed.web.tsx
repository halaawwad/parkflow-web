import { createElement, forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { View } from 'react-native';
import type { CameraFeedHandle, CameraFeedProps } from './CameraFeed';

/**
 * Web camera for unattended SmartGate. expo-camera's web stream asks the browser
 * for no particular size, which gives 640×480 — too small to read a plate a car
 * length away. This asks for 1080p, captures from the live video, reports when the
 * camera disconnects, and keeps the screen awake while it runs.
 */
export const CameraFeed = forwardRef<CameraFeedHandle, CameraFeedProps>(function CameraFeed({ active, onStatus }, ref) {
  const video = useRef<HTMLVideoElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const status = useRef(onStatus);
  status.current = onStatus;

  useImperativeHandle(ref, () => ({
    async capture() {
      const v = video.current;
      if (!v || v.readyState < 2 || !v.videoWidth) return null;
      const c = canvas.current ?? (canvas.current = document.createElement('canvas'));
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height);
      return { uri: c.toDataURL('image/jpeg', 0.85), mimeType: 'image/jpeg' };
    },
  }), []);

  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | undefined;
    let wakeLock: { release(): Promise<void> } | undefined;
    let stopped = false;
    const keepAwake = async () => {
      try { wakeLock = await (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen'); } catch { /* optional */ }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void keepAwake(); };
    status.current({ state: 'starting' });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        const track = stream.getVideoTracks()[0];
        track?.addEventListener('ended', () => status.current({ state: 'error', detail: 'disconnected' }));
        if (video.current) {
          video.current.srcObject = stream;
          await video.current.play();
        }
        const { width, height } = track?.getSettings() ?? {};
        status.current({ state: 'live', resolution: width && height ? `${width}×${height}` : undefined });
        await keepAwake();
        document.addEventListener('visibilitychange', onVisible);
      } catch (e) {
        const name = (e as { name?: string }).name;
        status.current({ state: 'error', detail: name === 'NotAllowedError' ? 'permission' : name === 'NotFoundError' ? 'no_camera' : 'unavailable' });
      }
    })();
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      void wakeLock?.release().catch(() => undefined);
      stream?.getTracks().forEach((t) => t.stop());
      if (video.current) video.current.srcObject = null;
    };
  }, [active]);

  return (
    <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
      {createElement('video', { ref: video, muted: true, playsInline: true, autoPlay: true, style: { width: '100%', height: '100%', objectFit: 'cover' } })}
    </View>
  );
});
