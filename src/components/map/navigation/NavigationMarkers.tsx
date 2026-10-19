import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useTheme } from '@/theme/ThemeProvider';

/** The car: a brand-coloured arrow on a white disc, pointing up (rotate it by the heading). */
export function NavigationArrow({ size = 46, dimmed = false }: { size?: number; dimmed?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ width: size, height: size, opacity: dimmed ? 0.55 : 1 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
      <Svg width={size} height={size} viewBox="0 0 48 48">
        <Circle cx={24} cy={24} r={21} fill={colors.surface} stroke="rgba(31,45,42,0.18)" strokeWidth={1} />
        <Path d="M24 9 L35 36 L24 30 L13 36 Z" fill={colors.brand} stroke={colors.brand} strokeWidth={2.4} strokeLinejoin="round" />
      </Svg>
    </View>
  );
}

/** Chequered-flag pin for the destination. */
export function DestinationFlag({ size = 40 }: { size?: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ width: size, height: size * 1.2 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
      <Svg width={size} height={size * 1.2} viewBox="0 0 40 48">
        <Path d="M20 47 C20 47 4 32 4 19 A16 16 0 0 1 36 19 C36 32 20 47 20 47 Z" fill={colors.deep} stroke={colors.surface} strokeWidth={2.5} />
        <Path d="M14 11 V28 M14 11 H27 L24 15 L27 19 H14" stroke={colors.onDeep} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </Svg>
    </View>
  );
}
