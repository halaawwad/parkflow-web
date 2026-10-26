import { Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useMutation } from '@tanstack/react-query';
import { MapPin, Wallet, BellRing } from 'lucide-react-native';
import Animated, { cubicBezier, type CSSAnimationProperties } from 'react-native-reanimated';

import { AppButton, AppText, ContourLines, Reveal } from '@/components/ui';
import { LogoMark } from '@/components/brand/Logo';
import { useTheme } from '@/theme/ThemeProvider';
import { darkColors } from '@/theme/colors';
import { spacing, screenPadding } from '@/theme/spacing';
import { useLocale } from '@/hooks/useLocale';
import { useInstantMotion } from '@/hooks/useInstantMotion';
import { services } from '@/services';
import { useAuthStore } from '@/store/authStore';
import { usePreferencesStore } from '@/store/preferencesStore';
import { errorMessage } from '@/utils/errors';
import { haptics } from '@/utils/haptics';

// Development-only shortcut: signs in as a fixed demo account, skipping email + OTP.
const devQuickLogin = __DEV__ && process.env.EXPO_PUBLIC_DEV_SKIP_EMAIL_OTP === 'true';
const DEMO_EMAIL = 'demo@parkflow.ps';
const DEMO_NAME = 'Demo Driver';

export default function WelcomeScreen() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const { t, row } = useLocale();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const instantMotion = useInstantMotion();

  const features = [
    { Icon: MapPin, label: t('onboarding.feature1') },
    { Icon: Wallet, label: t('onboarding.feature2') },
    { Icon: BellRing, label: t('onboarding.feature3') },
  ];

  const goToEmail = () => router.push('/(onboarding)/email');

  const completeOnboarding = usePreferencesStore((state) => state.completeOnboarding);
  const setUser = useAuthStore((state) => state.setUser);
  const quickLogin = useMutation({
    mutationFn: async () => {
      const result = await services.auth.devLogin({ email: DEMO_EMAIL });
      if (!result.user.fullName) {
        setUser(await services.auth.completeProfile({ userId: result.user.id, fullName: DEMO_NAME }));
      }
    },
    onSuccess: () => {
      haptics.success();
      completeOnboarding();
      router.replace('/(tabs)/map');
    },
    onError: () => haptics.error(),
  });

  // The first screen is the brand: deep emerald, contour lines and brass, in both themes.
  return (
    <View style={{ flex: 1, backgroundColor: colors.deepAlt }}>
      <StatusBar style="light" />

      {/* Scrolls on short screens so every action stays on the deep stage. */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }} bounces={false} showsVerticalScrollIndicator={false}>
      <LinearGradient
        colors={[colors.deep, colors.deepAlt, colors.deepAlt]}
        locations={[0, 0.6, 1]}
        style={{ flexGrow: 1, minHeight: height }}
      >
        <ContourLines style={{ height: height * 0.62, bottom: undefined }} />
        {/* Soft light bloom behind the mark. */}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: height * 0.04,
            alignSelf: 'center',
            width: 320,
            height: 320,
            borderRadius: 160,
            backgroundColor: colors.brand,
            opacity: isDark ? 0.08 : 0.16,
            ...(Platform.OS === 'web' ? ({ filter: 'blur(60px)' } as object) : null),
          }}
        />

        <View
          style={{
            flex: 1,
            paddingTop: insets.top + spacing.xxxl,
            paddingBottom: insets.bottom + spacing.xl,
            paddingHorizontal: screenPadding,
          }}
        >
          <Reveal delay={80} duration={620} offset={20} style={{ alignItems: 'center' }}>
            <Animated.View style={[styles.logoStage, !instantMotion && logoFloatStyle]}>
              <Animated.View pointerEvents="none" style={[styles.logoGlow, !instantMotion && glowPulseStyle]} />
              <Animated.View pointerEvents="none" style={[styles.orbit, !instantMotion && orbitTurnStyle]}>
                <View style={[styles.orbitDot, { backgroundColor: colors.accent }]} />
              </Animated.View>
              <View style={styles.logoShadow}>
                <LogoMark size={80} tone="light" />
              </View>
            </Animated.View>
          </Reveal>

          <Reveal delay={210} duration={580} style={{ marginTop: spacing.xl, gap: spacing.sm }}>
            <AppText variant="display" align="center" color="onDeep">
              {t('brand.name')}
            </AppText>
            <AppText
              variant="h3"
              align="center"
              style={{ color: colors.accent, marginTop: spacing.xs }}
            >
              {t('brand.tagline')}
            </AppText>
            <AppText
              variant="body"
              align="center"
              color="onDeepMuted"
              style={{ maxWidth: 300, alignSelf: 'center' }}
            >
              {t('brand.subtitle')}
            </AppText>
          </Reveal>

          <View style={{ flex: 1 }} />

          {/* An itinerary, not a set of inputs: numbered stops on hairlines. */}
          <Reveal delay={360} duration={560} style={{ marginBottom: spacing.xxl }}>
            {features.map(({ Icon, label }, index) => (
              <View
                key={label}
                style={{
                  flexDirection: row,
                  alignItems: 'center',
                  gap: spacing.md,
                  paddingVertical: spacing.md + 2,
                  borderTopWidth: StyleSheet.hairlineWidth * 2,
                  borderColor: 'rgba(255,255,255,0.09)',
                  ...(index === features.length - 1 ? { borderBottomWidth: StyleSheet.hairlineWidth * 2 } : null),
                }}
              >
                <AppText variant="caption" numeric style={{ color: colors.accent, width: 20 }}>
                  {String(index + 1).padStart(2, '0')}
                </AppText>
                <AppText variant="title" weight="medium" color="onDeep" style={{ flex: 1 }}>
                  {label}
                </AppText>
                <Icon size={17} color="rgba(255,255,255,0.55)" strokeWidth={1.9} />
              </View>
            ))}
          </Reveal>

          <Reveal delay={520} duration={560} style={{ gap: spacing.sm }}>
            <AppButton
              label={t('onboarding.getStarted')}
              onPress={goToEmail}
              variant="inverse"
              testID="welcome-get-started"
            />
            <AppButton
              label={t('onboarding.login')}
              onPress={goToEmail}
              variant="ghostInverse"
              style={{ height: 44 }}
            />
            {devQuickLogin ? (
              <AppButton
                label={t('onboarding.quickLogin')}
                onPress={() => quickLogin.mutate()}
                loading={quickLogin.isPending}
                variant="ghostInverse"
                style={{ height: 44 }}
                testID="welcome-quick-login"
              />
            ) : null}
            {quickLogin.isError ? (
              <AppText variant="caption" align="center" style={{ color: darkColors.dangerText }}>
                {errorMessage(quickLogin.error)}
              </AppText>
            ) : null}
          </Reveal>
        </View>
      </LinearGradient>
      </ScrollView>
    </View>
  );
}


const PREMIUM_EASE = cubicBezier(0.16, 1, 0.3, 1);
const logoFloat = { from: { transform: [{ translateY: 0 }] }, to: { transform: [{ translateY: -6 }] } };
const glowPulse = { from: { opacity: 0.58, transform: [{ scale: 0.94 }] }, to: { opacity: 0.9, transform: [{ scale: 1.1 }] } };
const orbitTurn = { from: { transform: [{ rotate: '0deg' }] }, to: { transform: [{ rotate: '360deg' }] } };

const logoFloatStyle: CSSAnimationProperties = { animationName: logoFloat, animationDuration: '2600ms', animationTimingFunction: PREMIUM_EASE, animationIterationCount: 'infinite', animationDirection: 'alternate' };
const glowPulseStyle: CSSAnimationProperties = { animationName: glowPulse, animationDuration: '2400ms', animationTimingFunction: PREMIUM_EASE, animationIterationCount: 'infinite', animationDirection: 'alternate' };
const orbitTurnStyle: CSSAnimationProperties = { animationName: orbitTurn, animationDuration: '14000ms', animationTimingFunction: 'linear', animationIterationCount: 'infinite' };

const styles = StyleSheet.create({
  logoStage: { width: 126, height: 112, alignItems: 'center', justifyContent: 'center' },
  logoGlow: { position: 'absolute', width: 116, height: 116, borderRadius: 58, backgroundColor: 'rgba(83,196,151,0.18)', ...(Platform.OS === 'web' ? ({ filter: 'blur(18px)' } as object) : null) },
  orbit: { position: 'absolute', width: 110, height: 110, borderRadius: 55, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.13)' },
  orbitDot: { position: 'absolute', top: -2, left: 52, width: 5, height: 5, borderRadius: 3 },
  logoShadow: { borderRadius: 22, ...(Platform.OS === 'web' ? ({ boxShadow: '0 18px 42px rgba(0,0,0,0.30)' } as object) : { shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 18, shadowOffset: { width: 0, height: 12 }, elevation: 10 }) },
});
