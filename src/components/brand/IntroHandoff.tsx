import { useState, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { cubicBezier } from 'react-native-reanimated';
import { getIntroPhase, useIntroPhase } from './introState';
import { useInstantMotion } from '@/hooks/useInstantMotion';

const EMPHASIZED = cubicBezier(0.16, 1, 0.3, 1);

/** The app arrives from a hair closer than rest, as if the stage were a lens pulling back. */
const settle = {
  from: { transform: [{ scale: 1.03 }] },
  to: { transform: [{ scale: 1 }] },
};

/**
 * Wraps the app so it settles into place as the intro dissolves above it.
 *
 * Only what mounts beneath the intro plays this, once; afterwards the wrapper is
 * an inert view. The fill mode is `backwards`, so no transform stays on the app
 * once the settle ends (a lingering transform would re-anchor fixed overlays).
 * The element type never changes, so the app is never remounted by it.
 */
export function IntroHandoff({ children }: { children: ReactNode }) {
  const instant = useInstantMotion();
  const phase = useIntroPhase();
  const [held] = useState(() => getIntroPhase() === 'covering');
  const animate = held && !instant;

  return (
    <Animated.View
      style={[
        styles.fill,
        animate && {
          animationName: settle,
          animationDuration: '900ms',
          animationTimingFunction: EMPHASIZED,
          animationFillMode: 'backwards',
          animationPlayState: phase === 'covering' ? 'paused' : 'running',
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
