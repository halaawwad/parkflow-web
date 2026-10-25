import { Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useMutation } from '@tanstack/react-query';
import { MapPin, Wallet, BellRing } from 'lucide-react-native';

import { AppButton, AppText, ContourLines, Reveal } from '@/components/ui';
import { LogoMark } from '@/components/brand/Logo';
import { useTheme } from '@/theme/ThemeProvider';
import { darkColors } from '@/theme/colors';
import { spacing, screenPadding } from '@/theme/spacing';
import { radius } from '@/theme/radius';
import { useLocale } from '@/hooks/useLocale';
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
          <Reveal delay={80} style={{ alignItems: 'center' }}>
            <LogoMark size={92} tone="light" />
          </Reveal>

          <Reveal delay={180} style={{ marginTop: spacing.xxxl, gap: spacing.md }}>
            <AppText variant="display" align="center" color="onDeep">
              {t('brand.name')}
            </AppText>
            <AppText
              variant="h2"
              align="center"
              style={{ color: colors.accent, letterSpacing: -0.2 }}
            >
              {t('brand.tagline')}
            </AppText>
            <AppText
              variant="bodyLg"
              align="center"
              color="onDeepMuted"
              style={{ maxWidth: 320, alignSelf: 'center' }}
            >
              {t('brand.subtitle')}
            </AppText>
          </Reveal>

          <View style={{ flex: 1 }} />

          <Reveal delay={300} style={{ gap: spacing.sm, marginBottom: spacing.xxl }}>
            {features.map(({ Icon, label }, index) => (
              <View
                key={label}
                style={{
                  flexDirection: row,
                  alignItems: 'center',
                  gap: spacing.md,
                  paddingVertical: spacing.sm,
                  paddingHorizontal: spacing.md,
                  borderRadius: radius.lg,
                  // Frosted glass over the deep stage.
                  backgroundColor: 'rgba(255,255,255,0.06)',
                  borderWidth: StyleSheet.hairlineWidth * 2,
                  borderColor: 'rgba(255,255,255,0.10)',
                  ...(Platform.OS === 'web' ? ({ backdropFilter: 'blur(12px)' } as object) : null),
                }}
              >
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: radius.sm,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(255,255,255,0.10)',
                  }}
                >
                  <Icon size={16} color={colors.accent} strokeWidth={2.2} />
                </View>
                <AppText variant="title" color="onDeep" style={{ flex: 1 }}>
                  {label}
                </AppText>
                <AppText variant="caption" color="onDeepMuted" numeric>
                  {String(index + 1).padStart(2, '0')}
                </AppText>
              </View>
            ))}
          </Reveal>

          <Reveal delay={420} style={{ gap: spacing.sm }}>
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
