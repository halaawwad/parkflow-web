import type { ObstacleFrame } from './engine';

/**
 * Obstacle camera on iOS and Android: not available yet. Live on-device
 * inference needs a frame-processor camera and an ML runtime in a native
 * build (e.g. VisionCamera with TensorFlow Lite or Core ML), which this
 * project does not include. Reporting "unsupported" keeps the app honest
 * instead of pretending to watch the path. The web build is in camera.web.ts.
 */

export type ObstacleCameraFailure = 'unsupported' | 'permission-denied' | 'camera-error' | 'model-error' | 'front-camera';

export interface ObstacleCamera {
  /** The live camera stream for the preview (a MediaStream on web). */
  readonly stream: unknown;
  stop(): void;
}

export function obstacleCameraSupported(): boolean {
  return false;
}

export async function startObstacleCamera(
  _onFrame: (frame: ObstacleFrame) => void,
  onFailure: (reason: ObstacleCameraFailure) => void,
): Promise<ObstacleCamera | undefined> {
  onFailure('unsupported');
  return undefined;
}
