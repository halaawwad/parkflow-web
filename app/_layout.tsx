import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as SplashScreen from 'expo-splash-screen';
import {
  useFonts,
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import {
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
} from '@expo-google-fonts/ibm-plex-sans-arabic';

import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';
import { useLocale } from '@/hooks/useLocale';
import { useAuthStore } from '@/store/authStore';
import { useBackendSync } from '@/hooks/useBackendSync';
import { usePreferencesStore } from '@/store/preferencesStore';
import { isAppError } from '@/utils/errors';
import { WebAppShell } from '@/components/layout/WebAppShell';
import { IntroSequence } from '@/components/brand/IntroSequence';
import { IntroHandoff } from '@/components/brand/IntroHandoff';
import { NotificationBanner } from '@/components/navigation/NotificationBanner';
import { BackendConnectionNotice } from '@/components/navigation/BackendConnectionNotice';
import { CrashCountdown } from '@/components/navigation/CrashCountdown';
import { useCrashDetection } from '@/hooks/useCrashDetection';

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) =>
        // Never retry a deliberate business rejection — only transient failures.
        isAppError(error) && error.code !== 'network' ? false : failureCount < 2,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: false },
  },
});

/**
 * Keeps the visible route in step with auth state.
 *
 * Signing in is not the same as finishing setup: a new account still has the
 * name and first-vehicle steps to go. The gate therefore only ejects a user
 * from onboarding once `onboardingComplete` is set, so those steps are not
 * skipped the moment a token exists.
 */
function useAuthGate(ready: boolean) {
  const router = useRouter();
  const segments = useSegments();
  const user = useAuthStore((s) => s.user);
  const authHydrated = useAuthStore((s) => s.hydrated);
  const onboardingComplete = usePreferencesStore((s) => s.onboardingComplete);

  useEffect(() => {
    if (!ready || !authHydrated) return;

    const inOnboarding = segments[0] === '(onboarding)';
    const signedIn = Boolean(user?.id && user.fullName);

    if (!signedIn && !inOnboarding) {
      router.replace('/(onboarding)/welcome');
    } else if (signedIn && onboardingComplete && inOnboarding) {
      router.replace('/(tabs)/map');
    }
  }, [ready, authHydrated, user, onboardingComplete, segments, router]);
}

function RootNavigator() {
  const { colors } = useTheme();
  const { isRTL } = useLocale();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        // New screens enter from the reading end: from the left in Arabic.
        animation: isRTL ? 'slide_from_left' : 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="(onboarding)" options={{ animation: 'fade' }} />
      <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
      <Stack.Screen name="parking" />
      <Stack.Screen name="rides" />
      <Stack.Screen name="spots" />
      <Stack.Screen name="gate" />
      <Stack.Screen name="management" />
      <Stack.Screen name="vehicles" />
      <Stack.Screen name="wallet" />
      <Stack.Screen name="activity" />
      <Stack.Screen name="violations" />
      <Stack.Screen name="profile" />
      <Stack.Screen name="notifications" options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="+not-found" />
    </Stack>
  );
}

function AppShell() {
  useBackendSync();
  useCrashDetection();
  const { colors } = useTheme();
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
    IBMPlexSansArabic_400Regular,
    IBMPlexSansArabic_500Medium,
    IBMPlexSansArabic_600SemiBold,
    IBMPlexSansArabic_700Bold,
  });

  const hydrateAuth = useAuthStore((s) => s.hydrate);
  const authHydrated = useAuthStore((s) => s.hydrated);
  const prefsHydrated = usePreferencesStore((s) => s.hydrated);
  const [splashHidden, setSplashHidden] = useState(false);

  useEffect(() => {
    void hydrateAuth();
  }, [hydrateAuth]);

  // Safety net: if storage rehydration never reports back (corrupt store, web
  // privacy mode) we still boot rather than sitting on the splash forever.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!usePreferencesStore.getState().hydrated) {
        usePreferencesStore.getState().setHydrated();
      }
    }, 2500);
    return () => clearTimeout(timer);
  }, []);

  // A font download failure must not hold the app hostage — the fallback stack
  // still renders, so we treat an error as "done loading".
  const ready = (fontsLoaded || Boolean(fontError)) && authHydrated && prefsHydrated;

  // The native splash only needs to cover font loading; the intro sequence
  // takes over from there while session state finishes hydrating.
  const fontsReady = fontsLoaded || Boolean(fontError);
  useEffect(() => {
    if (fontsReady && !splashHidden) {
      setSplashHidden(true);
      void SplashScreen.hideAsync();
    }
  }, [fontsReady, splashHidden]);

  useAuthGate(ready);

  return (
    <WebAppShell>
      {ready ? (
        <IntroHandoff>
          <RootNavigator />
        </IntroHandoff>
      ) : (
        <View style={{ flex: 1, backgroundColor: colors.deep }} />
      )}
      {ready ? <NotificationBanner /> : null}
      <BackendConnectionNotice />
      {ready ? <CrashCountdown /> : null}
      {fontsReady ? <IntroSequence ready={ready} /> : null}
    </WebAppShell>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <AppShell />
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
