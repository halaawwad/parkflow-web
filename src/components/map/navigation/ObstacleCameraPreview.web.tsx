import { createElement, useEffect, useRef } from 'react';

/** The live rear-camera picture, small. Decorative for screen readers: the spoken alerts carry the information. */
export function ObstacleCameraPreview({ stream, width, height }: { stream: unknown; width: number; height: number }) {
  const video = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const element = video.current;
    if (!element || !(stream instanceof MediaStream)) return;
    element.srcObject = stream;
    void element.play().catch(() => undefined);
    return () => {
      element.srcObject = null;
    };
  }, [stream]);
  if (!(stream instanceof MediaStream)) return null;
  return createElement('video', {
    ref: video,
    muted: true,
    playsInline: true,
    autoPlay: true,
    'aria-hidden': true,
    style: { width, height, objectFit: 'cover', borderRadius: 12, display: 'block', background: '#000' },
  });
}
