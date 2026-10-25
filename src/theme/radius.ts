/**
 * One continuous corner scale. Controls use the small end, cards the middle,
 * sheets and floating map surfaces the top.
 */
export const radius = {
  none: 0,
  xs: 8,
  sm: 12,
  md: 14,
  lg: 16,
  xl: 22,
  xxl: 26,
  /** Large floating surfaces over the map: navigation card and trip panel. */
  xxxl: 30,
  pill: 999,
} as const;

export type Radius = keyof typeof radius;
