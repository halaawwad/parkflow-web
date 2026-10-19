import { useWindowDimensions, type DimensionValue } from 'react-native';

export const WEB_APP_MAX_WIDTH = 430;
export const WEB_VIEWPORT_HEIGHT = '100dvh' as DimensionValue;

/** From this width the web app is presented as a framed device column on a brand stage. */
const STAGE_MIN_WIDTH = 900;
/** Below this height a framed column would crop content, so it stays full height. */
const STAGE_MIN_HEIGHT = 760;
const FRAME_HEIGHT = 880;
export const WEB_FRAME_RADIUS = 36;

/**
 * Geometry of the web app column. Shared by the shell and by full-screen
 * overlays (bottom sheets) that render in a portal, so they line up exactly.
 */
export function useWebFrame(): { staged: boolean; height: DimensionValue; radius: number } {
  const { width, height } = useWindowDimensions();
  const staged = width >= STAGE_MIN_WIDTH && height >= STAGE_MIN_HEIGHT;
  return staged
    ? { staged, height: Math.min(FRAME_HEIGHT, height - 64), radius: WEB_FRAME_RADIUS }
    : { staged, height: WEB_VIEWPORT_HEIGHT, radius: 0 };
}
