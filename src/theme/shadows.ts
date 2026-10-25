import { Platform, type ViewStyle } from 'react-native';

type Level = 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/**
 * Two-layer depth: a tight contact shadow that grounds a surface plus a soft,
 * wide ambient one that lifts it. Web renders both; native platforms take the
 * ambient layer (iOS) or an elevation (Android).
 */
const INK = '#0B1F18';

const ios: Record<Level, ViewStyle> = {
  none: {},
  xs: { shadowColor: INK, shadowOpacity: 0.06, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  sm: { shadowColor: INK, shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  md: { shadowColor: INK, shadowOpacity: 0.09, shadowRadius: 22, shadowOffset: { width: 0, height: 10 } },
  lg: { shadowColor: INK, shadowOpacity: 0.12, shadowRadius: 32, shadowOffset: { width: 0, height: 16 } },
  xl: { shadowColor: INK, shadowOpacity: 0.16, shadowRadius: 48, shadowOffset: { width: 0, height: 24 } },
};

const android: Record<Level, ViewStyle> = {
  none: {},
  xs: { elevation: 1, shadowColor: INK },
  sm: { elevation: 3, shadowColor: INK },
  md: { elevation: 5, shadowColor: INK },
  lg: { elevation: 8, shadowColor: INK },
  xl: { elevation: 12, shadowColor: INK },
};

const web: Record<Level, ViewStyle> = {
  none: {},
  xs: { boxShadow: '0 1px 2px rgba(11,31,24,0.06)' } as ViewStyle,
  sm: { boxShadow: '0 1px 2px rgba(11,31,24,0.05), 0 6px 16px -4px rgba(11,31,24,0.08)' } as ViewStyle,
  md: { boxShadow: '0 1px 3px rgba(11,31,24,0.06), 0 12px 28px -8px rgba(11,31,24,0.14)' } as ViewStyle,
  lg: { boxShadow: '0 2px 6px rgba(11,31,24,0.06), 0 22px 44px -12px rgba(11,31,24,0.20)' } as ViewStyle,
  xl: { boxShadow: '0 4px 10px rgba(11,31,24,0.08), 0 32px 64px -16px rgba(11,31,24,0.28)' } as ViewStyle,
};

export const shadow: Record<Level, ViewStyle> = Platform.select({
  ios,
  android,
  default: web,
}) as Record<Level, ViewStyle>;

/** Coloured depth for the primary CTA — used sparingly. */
export const brandGlow: ViewStyle = Platform.select({
  ios: { shadowColor: '#16704F', shadowOpacity: 0.22, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
  android: { elevation: 4, shadowColor: '#16704F' },
  default: {
    // The inset line is a hairline of light along the top edge: a lit, machined button.
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.16), 0 1px 2px rgba(11,58,44,0.20), 0 10px 24px -8px rgba(22,112,79,0.45)',
  } as ViewStyle,
}) as ViewStyle;

export type ShadowLevel = Level;
