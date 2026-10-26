import { Platform, type TextStyle } from 'react-native';

/**
 * Plus Jakarta Sans is loaded at boot and covers Latin plus the shekel sign.
 * Scripts it does not carry (Arabic) are substituted per glyph by the platform's
 * own text engine, so no explicit fallback stack is needed here — and React
 * Native could not parse a comma-separated list on device anyway.
 */
export const fontFamily = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
} as const;

/**
 * Arabic face. IBM Plex Sans Arabic carries Latin glyphs too, so mixed strings
 * ("Toyota Corolla", plate numbers) stay in one family. It has no 800 weight;
 * extrabold maps to bold.
 */
export const arabicFontFamily = {
  regular: 'IBMPlexSansArabic_400Regular',
  medium: 'IBMPlexSansArabic_500Medium',
  semibold: 'IBMPlexSansArabic_600SemiBold',
  bold: 'IBMPlexSansArabic_700Bold',
  extrabold: 'IBMPlexSansArabic_700Bold',
} as const;

/** Arabic needs taller lines for its ascenders and descenders. */
export const ARABIC_LINE_HEIGHT_SCALE = 1.14;

/**
 * Font for a weight in the current script. Letter spacing must stay at zero for
 * Arabic: a connected script breaks apart when its letters are spread.
 */
export function typeFace(isRTL: boolean, weight: FontWeightToken): string {
  return isRTL ? arabicFontFamily[weight] : fontFamily[weight];
}

export const systemFallback = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
}) as string;

export type FontWeightToken = keyof typeof fontFamily;

export type TypographyVariant =
  | 'displayXl'
  | 'display'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'titleLg'
  | 'title'
  | 'bodyLg'
  | 'body'
  | 'bodySm'
  | 'label'
  | 'caption'
  | 'overline'
  | 'button'
  | 'buttonSm';

type VariantStyle = Pick<TextStyle, 'fontSize' | 'lineHeight' | 'letterSpacing' | 'textTransform'> & {
  weight: FontWeightToken;
};

export const typography: Record<TypographyVariant, VariantStyle> = {
  /**
   * A deliberately restrained scale: hierarchy comes from weight, colour and
   * space as much as size, so titles never crowd the content they introduce.
   */
  /** The active-parking timer. Tabular figures are applied by AppText. */
  displayXl: { fontSize: 44, lineHeight: 52, letterSpacing: -1.2, weight: 'semibold' },
  display: { fontSize: 32, lineHeight: 40, letterSpacing: -0.9, weight: 'semibold' },
  h1: { fontSize: 26, lineHeight: 34, letterSpacing: -0.6, weight: 'bold' },
  h2: { fontSize: 20, lineHeight: 28, letterSpacing: -0.35, weight: 'semibold' },
  h3: { fontSize: 17, lineHeight: 24, letterSpacing: -0.2, weight: 'semibold' },
  titleLg: { fontSize: 16, lineHeight: 22, letterSpacing: -0.15, weight: 'semibold' },
  title: { fontSize: 15, lineHeight: 21, letterSpacing: -0.1, weight: 'semibold' },
  bodyLg: { fontSize: 16, lineHeight: 24, weight: 'regular' },
  body: { fontSize: 15, lineHeight: 22, weight: 'regular' },
  bodySm: { fontSize: 13, lineHeight: 19, weight: 'regular' },
  label: { fontSize: 13, lineHeight: 18, letterSpacing: -0.05, weight: 'semibold' },
  caption: { fontSize: 12, lineHeight: 16, letterSpacing: 0.05, weight: 'medium' },
  overline: { fontSize: 11, lineHeight: 14, letterSpacing: 1.2, textTransform: 'uppercase', weight: 'semibold' },
  button: { fontSize: 15, lineHeight: 22, letterSpacing: -0.1, weight: 'semibold' },
  buttonSm: { fontSize: 14, lineHeight: 20, letterSpacing: -0.05, weight: 'semibold' },
};

/** Caps text growth so premium layouts survive large accessibility text sizes. */
export const maxFontSizeMultiplier = 1.35;
