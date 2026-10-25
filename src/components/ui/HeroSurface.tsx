import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '@/theme/ThemeProvider';
import { radius as radii } from '@/theme/radius';
import { shadow } from '@/theme/shadows';
import { spacing } from '@/theme/spacing';

/**
 * The ParkFlow signature: faint contour lines — the curves of roads and the
 * flow the product is named after — with one thin brass line. Drawn on deep
 * emerald only. Decorative, so hidden from assistive technology.
 */
export function ContourLines({ style }: { style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width="100%" height="100%" viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice">
        <Path d="M-20 200 C 90 150, 170 230, 260 160 S 380 60, 430 90" stroke="rgba(255,255,255,0.09)" strokeWidth={1.4} fill="none" />
        <Path d="M-20 228 C 100 180, 180 250, 280 190 S 390 100, 430 124" stroke="rgba(255,255,255,0.065)" strokeWidth={1.4} fill="none" />
        <Path d="M-20 172 C 80 120, 160 206, 240 132 S 370 24, 430 56" stroke="rgba(255,255,255,0.055)" strokeWidth={1.4} fill="none" />
        <Path d="M210 -10 C 260 40, 330 50, 420 20" stroke={colors.accent} strokeOpacity={0.5} strokeWidth={1.2} fill="none" />
      </Svg>
    </View>
  );
}

/** Deep emerald card carrying the contour lines: balances, identities, hero moments. */
export function HeroSurface({
  children,
  padding = 'xxl',
  style,
  contentStyle,
}: {
  children: ReactNode;
  padding?: keyof typeof spacing;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.frame, shadow.md, style]}>
      <LinearGradient
        colors={[colors.deep, colors.deepAlt]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <ContourLines />
      {/* A hairline of light along the edge reads as a lit, finished surface. */}
      <View pointerEvents="none" style={[styles.sheen, { borderColor: 'rgba(255,255,255,0.10)' }]} />
      <View style={[{ padding: spacing[padding] }, contentStyle]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: radii.xxl, overflow: 'hidden' },
  sheen: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radii.xxl, borderWidth: StyleSheet.hairlineWidth * 2 },
});
