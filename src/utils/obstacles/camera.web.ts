import type { ObjectDetector } from '@mediapipe/tasks-vision';
import { OBSTACLE_LABELS, type FrameDetection } from './tracker';
import { measureFrame, toGray } from './quality';
import type { ObstacleFrame } from './engine';
import type { ObstacleCamera, ObstacleCameraFailure } from './camera';

/**
 * Browser obstacle camera: the rear camera through getUserMedia, analysed on
 * the device by MediaPipe's EfficientDet-Lite0 object detector (COCO classes,
 * WebAssembly on the CPU). Frames are never recorded, stored or uploaded; only
 * the model, its runtime and one reference photo are downloaded.
 *
 * The GPU delegate is not used: in testing it loaded without error and then
 * returned no detections at all, which would look exactly like an empty path.
 * For the same reason the detector must find the person in a reference photo
 * before monitoring starts.
 */

/** Keep in step with the @mediapipe/tasks-vision version in package.json. */
const TASKS_VISION_VERSION = '0.10.35';
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
/** Google's published int8 EfficientDet-Lite0 (4.6 MB), pinned to model version 1. */
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite';
/** MediaPipe's sample portrait: one clearly visible person (detected at 0.98 in testing). */
const SELF_TEST_IMAGE = 'https://storage.googleapis.com/mediapipe-assets/portrait.jpg';
const SELF_TEST_MIN_SCORE = 0.6;

/** Analysis pacing: about 2–6 frames a second, slower when the model is slow or the battery is low. */
const MIN_INTERVAL_MS = 160;
const LOW_POWER_INTERVAL_MS = 450;
const MAX_INTERVAL_MS = 700;
const THUMB_W = 64;
const THUMB_H = 48;

let detectorPromise: Promise<ObjectDetector> | undefined;
/** The video task needs strictly increasing timestamps across every call, the self-test included. */
let lastTimestamp = 0;
const nextTimestamp = () => (lastTimestamp = Math.max(performance.now(), lastTimestamp + 1));

async function loadDetector(): Promise<ObjectDetector> {
  const vision = await import('@mediapipe/tasks-vision');
  const files = await vision.FilesetResolver.forVisionTasks(WASM_BASE);
  const detector = await vision.ObjectDetector.createFromOptions(files, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
    runningMode: 'VIDEO',
    // The tracker applies the real threshold; this only trims obvious noise.
    scoreThreshold: 0.35,
    maxResults: 10,
    categoryAllowlist: [...OBSTACLE_LABELS],
  });
  // A detector that sees nothing must never pass for a clear path.
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = SELF_TEST_IMAGE;
  await image.decode();
  const found = detector.detectForVideo(image, nextTimestamp()).detections
    .some((d) => d.categories[0]?.categoryName === 'person' && d.categories[0].score >= SELF_TEST_MIN_SCORE);
  if (!found) {
    detector.close();
    throw new Error('Obstacle detector failed its self-test');
  }
  return detector;
}

export function obstacleCameraSupported(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof WebAssembly !== 'undefined';
}

async function lowPower(): Promise<boolean> {
  try {
    const battery = await (navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean }> }).getBattery?.();
    return Boolean(battery && !battery.charging && battery.level <= 0.2);
  } catch {
    return false;
  }
}

export async function startObstacleCamera(
  onFrame: (frame: ObstacleFrame) => void,
  onFailure: (reason: ObstacleCameraFailure) => void,
): Promise<ObstacleCamera | undefined> {
  if (!obstacleCameraSupported()) {
    onFailure('unsupported');
    return undefined;
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 30 } },
    });
  } catch (e) {
    const name = (e as { name?: string }).name;
    onFailure(name === 'NotAllowedError' || name === 'SecurityError' ? 'permission-denied' : name === 'NotFoundError' ? 'unsupported' : 'camera-error');
    return undefined;
  }

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const video = document.createElement('video');
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
  const fail = (reason: ObstacleCameraFailure) => {
    if (stopped) return;
    stop();
    onFailure(reason);
  };

  const track = stream.getVideoTracks()[0];
  // A camera that says it faces the user cannot see the way ahead.
  if (!track || track.getSettings().facingMode === 'user') {
    fail(track ? 'front-camera' : 'camera-error');
    return undefined;
  }
  track.addEventListener('ended', () => fail('camera-error'));

  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.srcObject = stream;
  try {
    await video.play();
  } catch {
    fail('camera-error');
    return undefined;
  }

  let detector: ObjectDetector;
  try {
    detectorPromise ??= loadDetector();
    detector = await detectorPromise;
  } catch {
    detectorPromise = undefined;
    fail('model-error');
    return undefined;
  }
  if (stopped) return undefined;

  const canvas = document.createElement('canvas');
  canvas.width = THUMB_W;
  canvas.height = THUMB_H;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const minInterval = (await lowPower()) ? LOW_POWER_INTERVAL_MS : MIN_INTERVAL_MS;

  const step = () => {
    if (stopped) return;
    let delay = minInterval;
    if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
      const started = performance.now();
      let detections: FrameDetection[];
      try {
        const width = video.videoWidth;
        const height = video.videoHeight;
        detections = detector.detectForVideo(video, nextTimestamp()).detections.flatMap((d) => {
          const category = d.categories[0];
          const box = d.boundingBox;
          if (!category || !box) return [];
          return [{
            label: category.categoryName,
            score: category.score,
            box: { x: box.originX / width, y: box.originY / height, width: box.width / width, height: box.height / height },
          }];
        });
      } catch {
        fail('model-error');
        return;
      }
      const inferenceMs = performance.now() - started;
      let quality = { brightness: 0, contrast: 0, sharpness: 0 };
      if (context) {
        context.drawImage(video, 0, 0, THUMB_W, THUMB_H);
        quality = measureFrame(toGray(context.getImageData(0, 0, THUMB_W, THUMB_H).data), THUMB_W, THUMB_H);
      }
      onFrame({ detections, quality, inferenceMs, at: Date.now() });
      delay = Math.min(MAX_INTERVAL_MS, Math.max(minInterval, inferenceMs * 2));
    }
    timer = setTimeout(step, delay);
  };
  step();
  return { stream, stop };
}
