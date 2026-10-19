import { useMemo, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { cubicBezier } from 'react-native-reanimated';
import { duration as motionDuration } from '@/theme/motion';
import { useInstantMotion } from '@/hooks/useInstantMotion';

export interface RevealProps {
  children: ReactNode;
  /** Stagger in ms — use increasing values down a screen. */
  delay?: number;
  /** Distance travelled during the fade, in px. 0 fades only. */
  offset?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}

/** The app's signature curve (`easing.emphasized`), as a CSS timing function. */
const EMPHASIZED = cubicBezier(0.16, 1, 0.3, 1);

/**
 * The app's entrance animation: a short rise and fade on mount.
 *
 * It is a Reanimated CSS animation — real CSS keyframes on web (run by the
 * compositor) and a UI-thread animation on native — so entrances stay smooth
 * while the screen underneath is still rendering, instead of competing with it
 * for the JS thread. Remount (change `key`) to play it again.
 *
 * Whenever motion is reduced or the page is hidden, it renders the final state
 * directly: content must never depend on an animation running to be seen.
 */
export function Reveal({
  children,
  delay = 0,
  offset = 14,
  duration = motionDuration.slow,
  style,
}: RevealProps) {
  const instant = useInstantMotion();
  const keyframes = useMemo(
    () => ({
      from: { opacity: 0, transform: [{ translateY: offset }] },
      to: { opacity: 1, transform: [{ translateY: 0 }] },
    }),
    [offset],
  );

  if (instant) return <Animated.View style={style}>{children}</Animated.View>;

  return (
    <Animated.View
      style={[
        style,
        {
          animationName: keyframes,
          animationDuration: `${duration}ms`,
          animationDelay: `${delay}ms`,
          animationTimingFunction: EMPHASIZED,
          animationFillMode: 'both',
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
