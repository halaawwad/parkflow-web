import type { ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Circle, G, Path, Text as SvgText } from 'react-native-svg';
import type { ManeuverKind } from '@/utils/navigation/maneuvers';

/**
 * Turn arrows drawn for this app on a 48-unit grid: a thick stem from the
 * bottom (where the driver is) bending into the new direction, with an open
 * arrowhead. Left-hand variants mirror the right-hand drawing, so every pair
 * is exactly symmetrical. Directions are never mirrored for RTL — left is left.
 * U-turns are drawn turning left, as traffic in Palestine drives on the right.
 */

type Shape = { stem: string; head: string; ghost?: string };

const RIGHT_SHAPES: Partial<Record<ManeuverKind, Shape>> = {
  straight: { stem: 'M24 42 V9', head: 'M14 19 L24 9 L34 19' },
  right: { stem: 'M16 42 V27 Q16 18 25 18 H38', head: 'M30 10 L38 18 L30 26' },
  'slight-right': { stem: 'M19 42 V29 L34 13', head: 'M23 12 H35 V24' },
  'sharp-right': { stem: 'M16 42 V15 L35 34', head: 'M35 22 V34 H23' },
  'keep-right': { stem: 'M24 42 V30 L34 13', head: 'M25 12 H35 V22', ghost: 'M24 30 L14 13' },
  uturn: { stem: 'M32 42 V21 Q32 11 24 11 Q16 11 16 21 V37', head: 'M8 30 L16 38 L24 30' },
};

const MIRRORED: Partial<Record<ManeuverKind, ManeuverKind>> = {
  left: 'right',
  'slight-left': 'slight-right',
  'sharp-left': 'sharp-right',
  'keep-left': 'keep-right',
};

/** Decorative: the instruction text next to the icon is what assistive technology reads. */
const Hidden = ({ children }: { children: ReactNode }) => (
  <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
    {children}
  </View>
);

export function ManeuverIcon(props: Parameters<typeof ManeuverGlyph>[0]) {
  return (
    <Hidden>
      <ManeuverGlyph {...props} />
    </Hidden>
  );
}

function ManeuverGlyph({
  kind,
  exit,
  size = 56,
  color,
  ghostColor,
}: {
  kind: ManeuverKind;
  exit?: number;
  size?: number;
  color: string;
  /** Colour of the untaken branch on keep-left/right forks. */
  ghostColor?: string;
}) {
  const stroke = { stroke: color, strokeWidth: 4.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };

  if (kind === 'arrive' || kind === 'waypoint') {
    return (
      <Svg width={size} height={size} viewBox="0 0 48 48">
        <Path d="M24 44 C24 44 10 31 10 20 A14 14 0 0 1 38 20 C38 31 24 44 24 44 Z" fill={color} />
        {kind === 'arrive' ? (
          <Path d="M19 14 V27 M19 14 H30 L27.5 17.5 L30 21 H19" stroke={ghostColor ?? '#fff'} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        ) : (
          <Circle cx={24} cy={20} r={5} fill={ghostColor ?? '#fff'} />
        )}
      </Svg>
    );
  }

  if (kind === 'depart') {
    return (
      <Svg width={size} height={size} viewBox="0 0 48 48">
        <Path d="M24 6 L38 40 L24 32 L10 40 Z" fill={color} stroke={color} strokeWidth={2} strokeLinejoin="round" />
      </Svg>
    );
  }

  if (kind === 'roundabout') {
    return (
      <Svg width={size} height={size} viewBox="0 0 48 48">
        <Circle cx={24} cy={22} r={9} {...stroke} strokeWidth={3.6} />
        <Path d="M24 44 V31" {...stroke} />
        <Path d="M30.5 15.5 L38 8" {...stroke} />
        <Path d="M30 8 H38 V16" {...stroke} />
        {exit ? (
          <SvgText x={24} y={26.5} fontSize={12} fontFamily="PlusJakartaSans_700Bold" fill={color} textAnchor="middle">
            {String(exit)}
          </SvgText>
        ) : null}
      </Svg>
    );
  }

  const mirrored = MIRRORED[kind];
  const shape = RIGHT_SHAPES[mirrored ?? kind] ?? RIGHT_SHAPES.straight!;
  // U-turns are drawn turning left.
  const flip = Boolean(mirrored);
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <G transform={flip ? 'translate(48 0) scale(-1 1)' : undefined}>
        {shape.ghost ? <Path d={shape.ghost} {...stroke} stroke={ghostColor ?? color} opacity={ghostColor ? 1 : 0.35} /> : null}
        <Path d={shape.stem} {...stroke} />
        <Path d={shape.head} {...stroke} />
      </G>
    </Svg>
  );
}
