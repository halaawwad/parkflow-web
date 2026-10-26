import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { cubicBezier, type CSSAnimationProperties } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { LogoMark } from './Logo';
import { getIntroPhase, markIntroPlayed, setIntroPhase } from './introState';
import { AppText } from '@/components/ui/AppText';
import { useInstantMotion } from '@/hooks/useInstantMotion';
import { useLocale } from '@/hooks/useLocale';
import { palette } from '@/theme/colors';

/**
 * Cold-start brand moment, in four beats:
 *
 *  1. Light — a soft emerald glow gathers in the dark stage.
 *  2. Mark — the logo rises into it: opacity, a few pixels of lift, a breath of scale.
 *  3. Route — the wordmark settles, then a hairline route draws beneath it and a
 *     glint runs its length to a terminal dot, the same line-and-dot that leaves
 *     the logo's "P".
 *  4. Handoff — the lockup lifts away first, then the stage dissolves while the
 *     app underneath settles from a hair of scale (see `IntroHandoff`, `Reveal`).
 *
 * Motion uses Reanimated CSS animations: real CSS keyframes on web (run by the
 * compositor) and UI-thread animations on native, so the sequence stays smooth
 * while the app mounts underneath it. Only transforms and opacity are animated.
 * It covers time the app already spends loading, ends early on a tap, is skipped
 * entirely for reduced motion, and plays once per launch (once per browser
 * session on web) — never on navigation.
 */

const WORDMARK = 'ParkFlow';
/** Time for the reveal to complete; loading may hold the stage a little longer. */
const MIN_STAGE_MS = 1300;
/** Never keep anyone waiting on the intro, whatever is still loading. */
const MAX_STAGE_MS = 4200;
const EXIT_MS = 520;

const ROUTE_WIDTH = 132;
const GLINT_WIDTH = 56;

const EMPHASIZED = cubicBezier(0.16, 1, 0.3, 1);
const STANDARD = cubicBezier(0.4, 0, 0.2, 1);
const ACCELERATE = cubicBezier(0.4, 0, 1, 1);
/** Ease-in-out for the glint, so it reads as travelling rather than thrown. */
const GLIDE = cubicBezier(0.65, 0, 0.35, 1);

const glowIn = {
  from: { opacity: 0, transform: [{ scale: 0.86 }] },
  to: { opacity: 1, transform: [{ scale: 1 }] },
};
const markIn = {
  from: { opacity: 0, transform: [{ translateY: 12 }, { scale: 0.94 }] },
  to: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] },
};
const letterIn = {
  from: { opacity: 0, transform: [{ translateY: 10 }] },
  to: { opacity: 1, transform: [{ translateY: 0 }] },
};
const routeDraw = {
  from: { opacity: 0, transform: [{ scaleX: 0 }] },
  '25%': { opacity: 1 },
  to: { opacity: 1, transform: [{ scaleX: 1 }] },
};
const glintRun = {
  '0%': { opacity: 0, transform: [{ translateX: -GLINT_WIDTH }] },
  '20%': { opacity: 1 },
  '80%': { opacity: 1 },
  '100%': { opacity: 0, transform: [{ translateX: ROUTE_WIDTH }] },
};
const dotIn = {
  from: { opacity: 0, transform: [{ scale: 0.3 }] },
  to: { opacity: 1, transform: [{ scale: 1 }] },
};
const fadeRise = {
  from: { opacity: 0, transform: [{ translateY: 6 }] },
  to: { opacity: 1, transform: [{ translateY: 0 }] },
};
const lockupOut = {
  from: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] },
  to: { opacity: 0, transform: [{ translateY: -10 }, { scale: 0.985 }] },
};
const stageOut = {
  from: { opacity: 1 },
  to: { opacity: 0 },
};

function enter(
  name: CSSAnimationProperties['animationName'],
  durationMs: number,
  delayMs: number,
  easing = EMPHASIZED,
): CSSAnimationProperties {
  return {
    animationName: name,
    animationDuration: `${durationMs}ms`,
    animationDelay: `${delayMs}ms`,
    animationTimingFunction: easing,
    animationFillMode: 'both',
  };
}

export function IntroSequence({ ready }: { ready: boolean }) {
  const instant = useInstantMotion();
  const { t } = useLocale();
  const [visible, setVisible] = useState(() => getIntroPhase() === 'covering');
  const [revealed, setRevealed] = useState(false);
  const [capped, setCapped] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    markIntroPlayed();
    if (instant) {
      setIntroPhase('done');
      setVisible(false);
      return;
    }
    const reveal = setTimeout(() => setRevealed(true), MIN_STAGE_MS);
    const cap = setTimeout(() => setCapped(true), MAX_STAGE_MS);
    return () => {
      clearTimeout(reveal);
      clearTimeout(cap);
    };
  }, [visible, instant]);

  // Leave once the reveal has played and the app underneath is ready (or the cap is hit).
  useEffect(() => {
    if (visible && !exiting && revealed && (ready || capped)) setExiting(true);
  }, [visible, exiting, revealed, ready, capped]);

  useEffect(() => {
    if (!exiting) return;
    setIntroPhase('handoff');
    const done = setTimeout(() => {
      setIntroPhase('done');
      setVisible(false);
    }, EXIT_MS);
    return () => clearTimeout(done);
  }, [exiting]);

  if (!visible || instant) return null;

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        styles.stage,
        exiting && {
          animationName: stageOut,
          animationDuration: `${EXIT_MS}ms`,
          animationDelay: '80ms',
          animationTimingFunction: STANDARD,
          animationFillMode: 'both',
        },
      ]}
      pointerEvents={exiting ? 'none' : 'auto'}
    >
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={() => ready && setExiting(true)}
        accessibilityRole="image"
        accessibilityLabel={`ParkFlow. ${t('brand.tagline')}`}
      >
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
          <Defs>
            <RadialGradient id="introStage" cx="50%" cy="44%" rx="80%" ry="62%">
              <Stop offset="0" stopColor={palette.emerald900} />
              <Stop offset="1" stopColor={palette.emerald950} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#introStage)" />
        </Svg>

        <Animated.View
          style={[styles.center, exiting && enter(lockupOut, 300, 0, ACCELERATE)]}
          pointerEvents="none"
        >
          <View style={styles.markWrap}>
            {/* Ambient light: a soft bloom, not a shape, so it reads as depth. */}
            <Animated.View style={[styles.glow, enter(glowIn, 1100, 0)]}>
              <Svg width={GLOW_SIZE} height={GLOW_SIZE}>
                <Defs>
                  <RadialGradient id="introGlow" cx="50%" cy="50%" r="50%">
                    <Stop offset="0" stopColor={palette.emerald400} stopOpacity={0.34} />
                    <Stop offset="0.45" stopColor={palette.emerald500} stopOpacity={0.12} />
                    <Stop offset="1" stopColor={palette.emerald600} stopOpacity={0} />
                  </RadialGradient>
                </Defs>
                <Circle cx={GLOW_SIZE / 2} cy={GLOW_SIZE / 2} r={GLOW_SIZE / 2} fill="url(#introGlow)" />
              </Svg>
            </Animated.View>
            <Animated.View style={[styles.mark, enter(markIn, 780, 100)]}>
              <LogoMark size={84} tone="dark" />
            </Animated.View>
          </View>

          {/* The wordmark is a Latin brand name, so it always reads left to right. */}
          <View style={styles.wordmark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {WORDMARK.split('').map((char, index) => (
              <Animated.Text
                key={`${char}-${index}`}
                allowFontScaling={false}
                style={[styles.letter, enter(letterIn, 520, 300 + index * 30)]}
              >
                {char}
              </Animated.Text>
            ))}
          </View>

          {/* The route: a hairline drawn left to right, a glint running it, a dot where it arrives. */}
          <View style={styles.route} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Animated.View style={[styles.routeTrack, enter(routeDraw, 560, 560)]} />
            <View style={styles.routeClip}>
              <Animated.View style={[styles.glint, enter(glintRun, 640, 600, GLIDE)]}>
                <LinearGradient
                  colors={['rgba(255,255,255,0)', '#FFFFFF', 'rgba(255,255,255,0)']}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={StyleSheet.absoluteFill}
                />
              </Animated.View>
            </View>
            <Animated.View style={[styles.routeDot, enter(dotIn, 420, 1060)]} />
          </View>

          <Animated.View style={enter(fadeRise, 520, 820)}>
            <AppText variant="body" color="onDeepMuted" align="center" style={styles.tagline}>
              {t('brand.tagline')}
            </AppText>
          </Animated.View>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const GLOW_SIZE = 340;

const styles = StyleSheet.create({
  stage: { zIndex: 1000, backgroundColor: palette.emerald950 },
  // Optical centre sits a little above the true centre, as a held phone sees it.
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 48 },
  markWrap: { width: 160, height: 120, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  glow: {
    position: 'absolute',
    width: GLOW_SIZE,
    height: GLOW_SIZE,
    top: (120 - GLOW_SIZE) / 2,
    left: (160 - GLOW_SIZE) / 2,
  },
  mark: {
    // A long, low shadow lifts the tile off the stage without a hard edge.
    boxShadow: '0 12px 28px rgba(0,0,0,0.3)',
    borderRadius: 18,
  },
  // The app never flips the root layout direction, so a plain row stays left to right.
  wordmark: { flexDirection: 'row' },
  letter: {
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 36,
    lineHeight: 44,
    letterSpacing: -0.9,
    color: '#FFFFFF',
  },
  route: {
    width: ROUTE_WIDTH + 10,
    height: 8,
    marginTop: 16,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  routeTrack: {
    position: 'absolute',
    left: 0,
    width: ROUTE_WIDTH,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: 'rgba(147,201,177,0.34)',
    transformOrigin: 'left center',
  },
  routeClip: {
    position: 'absolute',
    left: 0,
    width: ROUTE_WIDTH,
    height: 2,
    borderRadius: 1,
    overflow: 'hidden',
  },
  glint: { width: GLINT_WIDTH, height: 2 },
  routeDot: {
    position: 'absolute',
    left: ROUTE_WIDTH + 2,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: palette.emerald200,
  },
  tagline: { letterSpacing: 0.4 },
});
