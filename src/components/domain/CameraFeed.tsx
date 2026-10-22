import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { PlateFrame } from '@/types';

export interface CameraFeedHandle {
  /** One frame from the live camera, or null when it is not ready yet. */
  capture(): Promise<PlateFrame | null>;
}

export interface CameraStatus {
  state: 'starting' | 'live' | 'error';
  /** permission | no_camera | unavailable | disconnected */
  detail?: string;
  resolution?: string;
}

export interface CameraFeedProps {
  active: boolean;
  onStatus: (status: CameraStatus) => void;
}

/** Phone camera for SmartGate (full-resolution photos). The web version is CameraFeed.web.tsx. */
export const CameraFeed = forwardRef<CameraFeedHandle, CameraFeedProps>(function CameraFeed({ active, onStatus }, ref) {
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const status = useRef(onStatus);
  status.current = onStatus;

  useEffect(() => {
    if (!active || !permission) return;
    if (!permission.granted) {
      if (permission.canAskAgain) void requestPermission();
      else status.current({ state: 'error', detail: 'permission' });
      return;
    }
    status.current({ state: 'starting' });
  }, [active, permission, requestPermission]);

  useImperativeHandle(ref, () => ({
    async capture() {
      try {
        const photo = await camera.current?.takePictureAsync({ quality: 0.8, shutterSound: false });
        return photo?.uri ? { uri: photo.uri, mimeType: 'image/jpeg' } : null;
      } catch {
        return null; // Busy or not ready; the next frame will try again.
      }
    },
  }), []);

  if (!active || !permission?.granted) return null;
  return (
    <CameraView ref={camera} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} facing="back" animateShutter={false} mute
      onCameraReady={() => status.current({ state: 'live' })} onMountError={() => status.current({ state: 'error', detail: 'unavailable' })} />
  );
});
