import { Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, BellRing, MapPin, Navigation, Wallet } from 'lucide-react-native';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Path, Stop } from 'react-native-svg';
import Animated, { cubicBezier, type CSSAnimationProperties } from 'react-native-reanimated';

import { LogoMark } from '@/components/brand/Logo';
import { AppButton, AppText, PressableScale, Reveal } from '@/components/ui';
import { useInstantMotion } from '@/hooks/useInstantMotion';
import { useLocale } from '@/hooks/useLocale';
import { services } from '@/services';
import { useAuthStore } from '@/store/authStore';
import { usePreferencesStore } from '@/store/preferencesStore';
import { darkColors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { errorMessage } from '@/utils/errors';
import { haptics } from '@/utils/haptics';

const devQuickLogin = __DEV__ && process.env.EXPO_PUBLIC_DEV_SKIP_EMAIL_OTP === 'true';
const DEMO_EMAIL = 'demo@parkflow.ps';
const DEMO_NAME = 'Demo Driver';
const EASE = cubicBezier(0.16, 1, 0.3, 1);

const drift = { from: { transform: [{ translateX: -18 }, { translateY: 0 }, { scale: 1 }] }, to: { transform: [{ translateX: 20 }, { translateY: 12 }, { scale: 1.08 }] } };
const breathe = { from: { opacity: 0.42, transform: [{ scale: 0.9 }] }, to: { opacity: 0.9, transform: [{ scale: 1.12 }] } };
const orbit = { from: { transform: [{ rotate: '0deg' }] }, to: { transform: [{ rotate: '360deg' }] } };
const float = { from: { transform: [{ translateY: 3 }] }, to: { transform: [{ translateY: -7 }] } };
const routeSweep = { from: { transform: [{ translateX: -150 }] }, to: { transform: [{ translateX: 230 }] } };

const loop = (name: CSSAnimationProperties['animationName'], duration: number, alternate = true): CSSAnimationProperties => ({
  animationName: name,
  animationDuration: `${duration}ms`,
  animationTimingFunction: alternate ? EASE : 'linear',
  animationIterationCount: 'infinite',
  animationDirection: alternate ? 'alternate' : 'normal',
});

export default function WelcomeExperience() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { t, row } = useLocale();
  const instant = useInstantMotion();
  const setUser = useAuthStore((state) => state.setUser);
  const completeOnboarding = usePreferencesStore((state) => state.completeOnboarding);

  const goToEmail = () => router.push('/(onboarding)/email');
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

  const compact = height < 760;
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <LinearGradient colors={['#061F19', '#073B2E', '#041B16']} locations={[0, 0.48, 1]} style={StyleSheet.absoluteFill} />

      <Animated.View pointerEvents="none" style={[styles.aurora, styles.auroraOne, !instant && loop(drift, 7600)]} />
      <Animated.View pointerEvents="none" style={[styles.aurora, styles.auroraTwo, !instant && loop(drift, 9200)]} />

      <Animated.View pointerEvents="none" style={[styles.mapCanvas, !instant && loop(drift, 14000)]}>
        <Svg width="100%" height="100%" viewBox="0 0 430 850" preserveAspectRatio="xMidYMid slice">
          <Defs>
            <SvgGradient id="road" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#56D6A4" stopOpacity={0.02} />
              <Stop offset="0.5" stopColor="#56D6A4" stopOpacity={0.18} />
              <Stop offset="1" stopColor="#D6A84B" stopOpacity={0.06} />
            </SvgGradient>
          </Defs>
          <Path d="M-80 190 C70 80 170 300 310 160 S520 110 490 -20" stroke="url(#road)" strokeWidth="2" fill="none" />
          <Path d="M-60 560 C120 430 215 650 510 390" stroke="rgba(154,218,192,0.10)" strokeWidth="2" fill="none" />
          <Path d="M-90 690 C80 560 230 805 500 590" stroke="rgba(154,218,192,0.07)" strokeWidth="2" fill="none" />
          <Path d="M45 -70 C80 140 280 110 250 320 S80 490 180 930" stroke="rgba(255,255,255,0.045)" strokeWidth="1.5" fill="none" />
          <Circle cx="310" cy="160" r="4" fill="#D6A84B" fillOpacity={0.75} />
          <Circle cx="177" cy="524" r="3" fill="#65DDB0" fillOpacity={0.7} />
        </Svg>
      </Animated.View>

      <ScrollView contentContainerStyle={[styles.scroll, { minHeight: height, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 18 }]} showsVerticalScrollIndicator={false} bounces={false}>
        <View style={styles.content}>
          <Reveal delay={80} duration={680} offset={24} style={styles.hero}>
            <Animated.View style={[styles.logoUniverse, !instant && loop(float, 2800)]}>
              <Animated.View style={[styles.logoHalo, !instant && loop(breathe, 2500)]} />
              <Animated.View style={[styles.orbitOuter, !instant && loop(orbit, 18000, false)]}>
                <View style={styles.satellite} />
              </Animated.View>
              <Animated.View style={[styles.orbitInner, !instant && loop(orbit, 11000, false)]}>
                <View style={styles.satelliteSmall} />
              </Animated.View>
              <View style={styles.logoPlate}><LogoMark size={82} tone="light" /></View>
            </Animated.View>

            <AppText variant="display" align="center" color="onDeep" style={styles.wordmark}>ParkFlow</AppText>
            <AppText variant="h2" align="center" style={styles.tagline}>{t('brand.tagline')}</AppText>
            {!compact ? <AppText variant="body" align="center" color="onDeepMuted" style={styles.subtitle}>{t('brand.subtitle')}</AppText> : null}
          </Reveal>

          <Reveal delay={300} duration={620} offset={18} style={styles.routeCard}>
            <View style={styles.routeTop}>
              <View style={styles.routePin}><MapPin size={16} color="#06261E" strokeWidth={2.4} /></View>
              <View style={{ flex: 1 }}>
                <AppText variant="title" color="onDeep" align="right">أقرب موقف مناسب إلك</AppText>
              </View>
            </View>
            <View style={styles.routeRail}>
              <View style={styles.routeBase} />
              <Animated.View style={[styles.routeLight, !instant && loop(routeSweep, 3200, false)]} />
              <View style={styles.routeStart} />
              <Navigation size={15} color="#D6A84B" fill="#D6A84B" style={styles.routeEnd} />
            </View>
            <View style={styles.metrics}>
              <Metric number="01" icon={<MapPin size={15} color="#8EC9B2" />} label={t('onboarding.feature1')} />
              <View style={styles.metricDivider} />
              <Metric number="02" icon={<Wallet size={15} color="#8EC9B2" />} label={t('onboarding.feature2')} />
              <View style={styles.metricDivider} />
              <Metric number="03" icon={<BellRing size={15} color="#8EC9B2" />} label={t('onboarding.feature3')} />
            </View>
          </Reveal>

          <Reveal delay={500} duration={580} style={styles.actions}>
            <PressableScale onPress={goToEmail} accessibilityRole="button" accessibilityLabel={t('onboarding.getStarted')} style={styles.primaryButton}>
              <LinearGradient colors={['#FDFBF6', '#E8F3EE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.primaryFill}>
                <AppText variant="title" style={styles.primaryText}>{t('onboarding.getStarted')}</AppText>
                <View style={styles.arrowDisc}><ArrowLeft size={17} color="#F7F4EC" strokeWidth={2.5} /></View>
              </LinearGradient>
            </PressableScale>
            <AppButton label={t('onboarding.login')} onPress={goToEmail} variant="ghostInverse" style={{ height: 44 }} />
            {devQuickLogin ? <AppButton label={t('onboarding.quickLogin')} onPress={() => quickLogin.mutate()} loading={quickLogin.isPending} variant="ghostInverse" style={{ height: 40 }} /> : null}
            {quickLogin.isError ? <AppText variant="caption" align="center" style={{ color: darkColors.dangerText }}>{errorMessage(quickLogin.error)}</AppText> : null}
          </Reveal>
        </View>
      </ScrollView>
    </View>
  );
}

function Metric({ number, icon, label }: { number: string; icon: React.ReactNode; label: string }) {
  return <View style={styles.metric}><AppText variant="caption" numeric style={styles.metricNumber}>{number}</AppText>{icon}<AppText variant="bodySm" color="onDeep" numberOfLines={2} style={styles.metricLabel}>{label}</AppText></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#041B16', overflow: 'hidden' },
  scroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  content: { width: '100%', maxWidth: 510, gap: 18 },
  aurora: { position: 'absolute', width: 430, height: 430, borderRadius: 215, opacity: 0.15, ...(Platform.OS === 'web' ? ({ filter: 'blur(70px)' } as object) : null) },
  auroraOne: { backgroundColor: '#30C58B', top: -230, left: -100 },
  auroraTwo: { backgroundColor: '#BF843A', right: -270, top: 150, opacity: 0.09 },
  mapCanvas: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0.9 },
  hero: { alignItems: 'center' },
  logoUniverse: { width: 142, height: 134, alignItems: 'center', justifyContent: 'center' },
  logoHalo: { position: 'absolute', width: 130, height: 130, borderRadius: 65, backgroundColor: 'rgba(75,215,160,0.16)', ...(Platform.OS === 'web' ? ({ filter: 'blur(18px)' } as object) : null) },
  orbitOuter: { position: 'absolute', width: 128, height: 128, borderRadius: 64, borderWidth: 1, borderColor: 'rgba(218,235,228,0.12)' },
  orbitInner: { position: 'absolute', width: 106, height: 106, borderRadius: 53, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(214,168,75,0.20)' },
  satellite: { position: 'absolute', width: 7, height: 7, borderRadius: 4, backgroundColor: '#D6A84B', top: 15, right: 12, boxShadow: '0 0 12px rgba(214,168,75,.8)' },
  satelliteSmall: { position: 'absolute', width: 4, height: 4, borderRadius: 2, backgroundColor: '#7DE0B9', bottom: 7, left: 20 },
  logoPlate: { borderRadius: 23, boxShadow: '0 22px 50px rgba(0,0,0,.42)' },
  wordmark: { marginTop: 12, fontSize: 40, letterSpacing: -1.4, textShadowColor: 'rgba(0,0,0,.35)', textShadowOffset: { width: 0, height: 8 }, textShadowRadius: 18 },
  tagline: { color: '#E2B761', marginTop: 3 },
  subtitle: { maxWidth: 330, marginTop: 7, lineHeight: 23 },
  routeCard: { padding: 16, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(192,232,216,.16)', backgroundColor: 'rgba(7,45,35,.76)', boxShadow: '0 24px 70px rgba(0,0,0,.28)', ...(Platform.OS === 'web' ? ({ backdropFilter: 'blur(18px)' } as object) : null) },
  routeTop: { flexDirection: 'row', direction: 'ltr', alignItems: 'center', gap: 11 },
  routePin: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#73D3AD' },
  routeRail: { height: 28, justifyContent: 'center', marginVertical: 10, overflow: 'hidden' },
  routeBase: { height: 1, marginHorizontal: 7, backgroundColor: 'rgba(126,204,173,.2)' },
  routeLight: { position: 'absolute', left: 20, width: 110, height: 2, backgroundColor: '#6EE2B5', boxShadow: '0 0 10px rgba(110,226,181,.9)' },
  routeStart: { position: 'absolute', left: 5, width: 7, height: 7, borderRadius: 4, backgroundColor: '#6EE2B5' },
  routeEnd: { position: 'absolute', right: 2, transform: [{ rotate: '-32deg' }] },
  metrics: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,.1)', paddingTop: 5 },
  metric: { minHeight: 38, flexDirection: 'row', direction: 'ltr', alignItems: 'center', gap: 10, paddingVertical: 7 },
  metricNumber: { color: '#D6A84B', fontSize: 10, width: 22 },
  metricLabel: { flex: 1, textAlign: 'right' },
  metricDivider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,.08)' },
  actions: { gap: 7 },
  primaryButton: { height: 58, borderRadius: 18, overflow: 'hidden', boxShadow: '0 18px 40px rgba(0,0,0,.28)' },
  primaryFill: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 58 },
  primaryText: { color: '#07362A', textAlign: 'center' },
  arrowDisc: { position: 'absolute', left: 16, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0B4938' },
});

