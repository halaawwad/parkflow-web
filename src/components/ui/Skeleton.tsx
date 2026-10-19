import { View, type StyleProp, type ViewStyle, type DimensionValue } from 'react-native';
import Animated, { cubicBezier, useReducedMotion } from 'react-native-reanimated';
import { useTheme } from '@/theme/ThemeProvider';
import { radius } from '@/theme/radius';
import { duration } from '@/theme/motion';

export interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  radiusToken?: keyof typeof radius;
  style?: StyleProp<ViewStyle>;
}

const breathe = {
  from: { opacity: 1 },
  to: { opacity: 0.5 },
};

/**
 * A soft breathing pulse rather than a sliding highlight — calmer when several
 * are on screen. It is an opacity-only CSS animation, so it runs off the JS
 * thread (compositor on web, UI thread on native) and stays smooth while the
 * data it stands in for is loading. Still under reduced motion.
 */
export function Skeleton({ width = '100%', height = 16, radiusToken = 'sm', style }: SkeletonProps) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();

  return (
    <Animated.View
      accessibilityRole="progressbar"
      style={[
        { width, height, borderRadius: radius[radiusToken], backgroundColor: colors.skeleton },
        !reducedMotion && {
          animationName: breathe,
          animationDuration: `${duration.pulse / 2}ms`,
          animationIterationCount: 'infinite',
          animationDirection: 'alternate',
          animationTimingFunction: cubicBezier(0.4, 0, 0.6, 1),
        },
        style,
      ]}
    />
  );
}

/** Convenience stack for list placeholders. */
export function SkeletonGroup({
  count = 3,
  height = 76,
  gap = 12,
  style,
}: {
  count?: number;
  height?: number;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ gap }, style]}>
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton key={index} height={height} radiusToken="xl" />
      ))}
    </View>
  );
}
