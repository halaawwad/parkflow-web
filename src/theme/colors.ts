/**
 * Brand identity — "midnight emerald and brass": a deep, saturated emerald for
 * the brand, ink-green neutrals, warm porcelain light surfaces and a brass
 * accent used sparingly. Every colour the app draws must come from here —
 * never inline hex in screens.
 */

const palette = {
  // Emerald, ordered light → dark. Brand identity, hero surfaces, splash.
  emerald50: '#F1F7F4',
  emerald100: '#E2F0E9',
  emerald200: '#C3E0D2',
  emerald300: '#93C9B1',
  emerald400: '#5EAD8D',
  emerald500: '#2F8E6C',
  emerald600: '#16704F',
  emerald700: '#0F5A40',
  emerald800: '#0C4634',
  emerald900: '#0B3A2C',
  emerald950: '#072920',

  // Ink neutrals — faintly green so they sit with the brand.
  neutral900: '#13211D',
  neutral800: '#22312C',
  neutral700: '#3A4A44',
  neutral600: '#56655E',
  neutral500: '#6B7A73',
  neutral400: '#86948D',
  neutral300: '#B4C0BA',
  neutral200: '#DDE4E0',
  neutral100: '#ECF0EC',
  neutral50: '#F5F3EE',
  white: '#FFFFFF',
  black: '#000000',

  // Brass — the accent. Warmth and a premium note, never a status colour.
  brass600: '#7E5A28',
  brass500: '#B8894A',
  brass100: '#F6EDDD',

  // Amber stays the warning hue; red the danger hue; blue information.
  amber600: '#7E5A28',
  amber500: '#C8923F',
  amber100: '#F8EEDC',

  red600: '#9B3B3D',
  red500: '#B8484A',
  red100: '#F9E9E7',

  blue600: '#365F78',
  blue500: '#4A7893',
  blue100: '#E6EEF3',

  violet500: '#7A6A90',
  violet100: '#EFEBF4',
};

export type ColorScheme = {
  /** Brand */
  brand: string;
  brandPressed: string;
  brandSoft: string;
  brandSofter: string;
  onBrand: string;
  deep: string;
  deepAlt: string;
  onDeep: string;
  onDeepMuted: string;
  accent: string;

  /** Surfaces */
  background: string;
  surface: string;
  surfaceAlt: string;
  surfaceSunken: string;
  surfaceInverse: string;
  overlay: string;
  scrim: string;
  glass: string;
  glassBorder: string;

  /** Lines */
  border: string;
  borderStrong: string;
  divider: string;

  /** Text */
  text: string;
  textSecondary: string;
  textTertiary: string;
  /** Hint text inside empty inputs: clearly lighter than a typed value. */
  placeholder: string;
  textInverse: string;
  textOnColor: string;

  /** Status — availability + system feedback */
  success: string;
  successSoft: string;
  successText: string;
  warning: string;
  warningSoft: string;
  warningText: string;
  danger: string;
  dangerDeep: string;
  dangerSoft: string;
  dangerText: string;
  info: string;
  infoSoft: string;
  infoText: string;
  neutralSoft: string;
  neutralText: string;

  /** Charts / map */
  mapWater: string;
  mapLand: string;
  parkingMunicipal: string;
  parkingPrivate: string;
  parkingFree: string;
  parkingRestricted: string;
  skeleton: string;
  skeletonHighlight: string;
};

export const lightColors: ColorScheme = {
  brand: palette.emerald600,
  brandPressed: palette.emerald700,
  brandSoft: palette.emerald100,
  brandSofter: palette.emerald50,
  onBrand: palette.white,
  deep: palette.emerald900,
  deepAlt: palette.emerald950,
  onDeep: palette.white,
  onDeepMuted: 'rgba(255,255,255,0.78)',
  accent: palette.brass500,

  background: palette.neutral50,
  surface: palette.white,
  surfaceAlt: palette.neutral100,
  surfaceSunken: '#EDEBE4',
  surfaceInverse: palette.emerald900,
  overlay: 'rgba(7,24,19,0.48)',
  scrim: 'rgba(7,24,19,0.06)',
  glass: 'rgba(255,255,255,0.86)',
  glassBorder: 'rgba(19,33,29,0.07)',

  border: 'rgba(19,33,29,0.10)',
  borderStrong: 'rgba(19,33,29,0.20)',
  divider: 'rgba(19,33,29,0.07)',

  text: palette.neutral900,
  textSecondary: palette.neutral600,
  // Still 4.5:1 on white: used for small supporting text.
  textTertiary: palette.neutral500,
  placeholder: palette.neutral400,
  textInverse: palette.white,
  textOnColor: palette.white,

  success: palette.emerald600,
  successSoft: palette.emerald100,
  successText: palette.emerald700,
  warning: palette.amber500,
  warningSoft: palette.amber100,
  warningText: palette.amber600,
  danger: palette.red500,
  dangerDeep: '#843235',
  dangerSoft: palette.red100,
  dangerText: palette.red600,
  info: palette.blue500,
  infoSoft: palette.blue100,
  infoText: palette.blue600,
  neutralSoft: palette.neutral100,
  neutralText: palette.neutral600,

  mapWater: '#D8E7E7',
  mapLand: '#EEF0E8',
  parkingMunicipal: '#22785A',
  parkingPrivate: '#36719F',
  parkingFree: '#148783',
  parkingRestricted: '#C76E0B',
  skeleton: palette.neutral200,
  skeletonHighlight: palette.neutral100,
};

export const darkColors: ColorScheme = {
  brand: '#7CCBA9',
  brandPressed: '#9ED9BF',
  brandSoft: 'rgba(124,203,169,0.15)',
  brandSofter: 'rgba(124,203,169,0.08)',
  onBrand: palette.emerald950,
  deep: '#0F3A2E',
  deepAlt: '#0A2A21',
  onDeep: palette.white,
  onDeepMuted: 'rgba(255,255,255,0.76)',
  accent: '#D6AE72',

  background: '#0C1613',
  surface: '#14211D',
  surfaceAlt: '#1B2B26',
  surfaceSunken: '#101C18',
  surfaceInverse: palette.white,
  overlay: 'rgba(0,0,0,0.62)',
  scrim: 'rgba(255,255,255,0.05)',
  glass: 'rgba(20,33,29,0.88)',
  glassBorder: 'rgba(255,255,255,0.08)',

  border: 'rgba(255,255,255,0.09)',
  borderStrong: 'rgba(255,255,255,0.18)',
  divider: 'rgba(255,255,255,0.06)',

  text: '#ECF3EF',
  textSecondary: '#A4B6AE',
  textTertiary: '#8FA39A',
  placeholder: '#64786F',
  textInverse: palette.neutral900,
  textOnColor: palette.white,

  success: '#5EBB93',
  successSoft: 'rgba(124,203,169,0.14)',
  successText: '#9ED9BF',
  warning: '#D9A55A',
  warningSoft: 'rgba(217,165,90,0.15)',
  warningText: '#EBC88F',
  danger: '#E39893',
  dangerDeep: '#843235',
  dangerSoft: 'rgba(227,152,147,0.15)',
  dangerText: '#F2B8B2',
  info: '#79A7C2',
  infoSoft: 'rgba(121,167,194,0.15)',
  infoText: '#B5D0E0',
  neutralSoft: '#1B2B26',
  neutralText: '#A4B6AE',

  mapWater: '#1F3A3E',
  mapLand: '#14211D',
  parkingMunicipal: '#5DB689',
  parkingPrivate: '#6EA7D8',
  parkingFree: '#41B9B2',
  parkingRestricted: '#EFA349',
  skeleton: '#1F302A',
  skeletonHighlight: '#2A3F37',
};

export { palette };
