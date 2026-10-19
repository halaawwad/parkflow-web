import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { cubicBezier } from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { LogoMark } from './Logo';
import { AppText } from '@/components/ui/AppText';
import { useInstantMotion } from '@/hooks/useInstantMotion';
import { useLocale } from '@/hooks/useLocale';
import { palette } from '@/theme/colors';

/**
 * Cold-start brand moment. The mark settles onto a slowly breathing halo, the
 * wordmark rises letter by letter, the tagline follows, and the stage lifts
 * away into the app.
 *
 * Motion uses Reanimated CSS animations: real CSS keyframes on web (run by the
 * compositor) and UI-thread animations on native, so the sequence stays smooth
 * while the app mounts underneath it. It covers time the app already spends
 * loading, ends early on a tap, is skipped entirely for reduced motion, and
 * plays once per launch (once per browser session on web) — never on navigation.
 */

const WORDMARK = 'ParkFlow';
/** Time for the reveal to complete; loading may hold the stage a little longer. */
const MIN_STAGE_MS = 1700;
/** Never keep anyone waiting on the intro, whatever is still loading. */
const MAX_STAGE_MS = 4200;
const EXIT_MS = 560;
const SESSION_KEY = 'parkflow:intro-played';

const EMPHASIZED = cubicBezier(0.16, 1, 0.3, 1);
const STANDARD = cubicBezier(0.4, 0, 0.2, 1);

let playedThisLaunch = false;

function alreadyPlayed(): boolean {
  if (playedThisLaunch) return true;
  if (Platform.OS !== 'web') return false;
  try {
    return window.sessionStorage.getItem(SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

function markPlayed() {
  playedThisLaunch = true;
  if (Platform.OS !== 'web') return;
  try {
    window.sessionStorage.setItem(SESSION_KEY, '1');
  } catch {
    // Private mode: the in-memory flag still prevents replays in this tab.
  }
}

const markIn = {
  from: { opacity: 0, transform: [{ scale: 0.82 }] },
  to: { opacity: 1, transform: [{ scale: 1 }] },
};
const haloIn = {
  '0%': { opacity: 0, transform: [{ scale: 0.5 }] },
  '55%': { opacity: 1, transform: [{ scale: 1.12 }] },
  '100%': { opacity: 0.75, transform: [{ scale: 1.02 }] },
};
const riseIn = {
  from: { opacity: 0, transform: [{ translateY: 14 }] },
  to: { opacity: 1, transform: [{ translateY: 0 }] },
};
const stageOut = {
  from: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] },
  to: { opacity: 0, transform: [{ translateY: -16 }, { scale: 1.02 }] },
};

export function IntroSequence({ ready }: { ready: boolean }) {
  const instant = useInstantMotion();
  const { t } = useLocale();
  const [visible, setVisible] = useState(() => !alreadyPlayed());
  const [revealed, setRevealed] = useState(false);
  const [capped, setCapped] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    markPlayed();
    if (instant) {
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
    const done = setTimeout(() => setVisible(false), EXIT_MS);
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
          animationTimingFunction: STANDARD,
          animationFillMode: 'forwards',
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
            <RadialGradient id="introGlow" cx="50%" cy="42%" rx="75%" ry="58%">
              <Stop offset="0" stopColor={palette.emerald800} />
              <Stop offset="1" stopColor={palette.emerald950} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#introGlow)" />
        </Svg>

        <View style={styles.center} pointerEvents="none">
          <View style={styles.markWrap}>
            <Animated.View
              style={[
                styles.halo,
                {
                  animationName: haloIn,
                  animationDuration: '1500ms',
                  animationTimingFunction: EMPHASIZED,
                  animationFillMode: 'both',
                },
              ]}
            />
            <Animated.View
              style={{
                animationName: markIn,
                animationDuration: '800ms',
                animationTimingFunction: EMPHASIZED,
                animationFillMode: 'both',
              }}
            >
              <LogoMark size={92} tone="dark" />
            </Animated.View>
          </View>

          {/* The wordmark is a Latin brand name, so it always reads left to right. */}
          <View style={styles.wordmark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {WORDMARK.split('').map((char, index) => (
              <Animated.Text
                key={`${char}-${index}`}
                allowFontScaling={false}
                style={[
                  styles.letter,
                  {
                    animationName: riseIn,
                    animationDuration: '560ms',
                    animationDelay: `${340 + index * 45}ms`,
                    animationTimingFunction: EMPHASIZED,
                    animationFillMode: 'both',
                  },
                ]}
              >
                {char}
              </Animated.Text>
            ))}
          </View>

          <Animated.View
            style={{
              animationName: riseIn,
              animationDuration: '600ms',
              animationDelay: '860ms',
              animationTimingFunction: EMPHASIZED,
              animationFillMode: 'both',
            }}
          >
            <AppText variant="bodyLg" color="onDeepMuted" align="center">
              {t('brand.tagline')}
            </AppText>
          </Animated.View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stage: { zIndex: 1000, backgroundColor: palette.emerald950 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, paddingBottom: 40 },
  markWrap: { width: 200, height: 160, alignItems: 'center', justifyContent: 'center' },
  halo: {
    position: 'absolute',
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: 'rgba(121,171,151,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(199,223,211,0.14)',
  },
  // The app never flips the root layout direction, so a plain row stays left to right.
  wordmark: { flexDirection: 'row' },
  letter: {
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 38,
    lineHeight: 46,
    letterSpacing: -0.8,
    color: '#FFFFFF',
  },
});
