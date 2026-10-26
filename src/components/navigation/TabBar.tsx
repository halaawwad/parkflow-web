import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useEffect } from 'react';
import { Map, Receipt, Car, Wallet, User, HeartHandshake } from 'lucide-react-native';

import { AppText } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, screenPadding } from '@/theme/spacing';
import { radius } from '@/theme/radius';
import { shadow } from '@/theme/shadows';
import { duration, spring } from '@/theme/motion';
import { useLocale } from '@/hooks/useLocale';
import type { TranslationKey } from '@/i18n';
import { haptics } from '@/utils/haptics';
import { useNavigationSessionStore } from '@/store/navigationSessionStore';

const ICONS: Record<string, typeof Map> = {
  map: Map,
  share: HeartHandshake,
  activity: Receipt,
  vehicles: Car,
  wallet: Wallet,
  profile: User,
};

const LABELS: Record<string, TranslationKey> = {
  map: 'tabs.map',
  share: 'tabs.share',
  activity: 'tabs.activity',
  vehicles: 'tabs.vehicles',
  wallet: 'tabs.wallet',
  profile: 'tabs.profile',
};

function TabItem({
  routeName,
  focused,
  compact,
  onPress,
}: {
  routeName: string;
  focused: boolean;
  /** Narrow phones: six labels only fit when the type steps down a size. */
  compact: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useLocale();
  const Icon = ICONS[routeName] ?? Map;
  const labelKey = LABELS[routeName];

  const active = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    active.value = focused
      ? withSpring(1, spring.press)
      : withTiming(0, { duration: duration.fast });
  }, [focused, active]);

  // The icon lifts slightly and the pill fades in — no bouncing labels.
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -active.value * 2 }],
  }));

  const pillStyle = useAnimatedStyle(() => ({
    opacity: active.value,
    transform: [{ scale: 0.8 + active.value * 0.2 }],
  }));

  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.9}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={labelKey ? t(labelKey) : routeName}
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
        paddingVertical: spacing.sm,
        minHeight: 52,
      }}
    >
      <View style={{ width: 44, height: 26, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              width: 44,
              height: 26,
              borderRadius: radius.pill,
              backgroundColor: colors.brandSoft,
            },
            pillStyle,
          ]}
        />
        <Animated.View style={iconStyle}>
          <Icon
            size={20}
            color={focused ? colors.brand : colors.textTertiary}
            strokeWidth={focused ? 2.3 : 1.9}
          />
        </Animated.View>
      </View>

      <AppText
        variant="caption"
        weight={focused ? 'semibold' : 'medium'}
        numberOfLines={1}
        style={{
          color: focused ? colors.brand : colors.textTertiary,
          fontSize: compact ? 10 : 11,
          lineHeight: 14,
          letterSpacing: compact ? -0.1 : 0,
        }}
      >
        {labelKey ? t(labelKey) : routeName}
      </AppText>
    </PressableScale>
  );
}

/**
 * Floating tab bar. It sits above the map rather than cutting a band out of it,
 * which is what keeps the map-first feel.
 */
export function TabBar({ state, navigation }: BottomTabBarProps) {
  const { colors } = useTheme();
  const { row } = useLocale();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const compact = width < 360;
  // Turn-by-turn navigation owns the whole screen.
  const navigating = useNavigationSessionStore((s) => s.active);
  if (navigating) return null;

  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: compact ? spacing.md : screenPadding,
        paddingBottom: Math.max(insets.bottom, spacing.md),
      }}
      pointerEvents="box-none"
    >
      <View
        style={[
          {
            flexDirection: row,
            alignItems: 'center',
            backgroundColor: colors.glass,
            borderRadius: radius.xxl,
            paddingHorizontal: spacing.xs,
            paddingVertical: spacing.xs,
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: colors.glassBorder,
          },
          // Frosted over the map and lists on web; native keeps the near-opaque glass colour.
          Platform.OS === 'web' ? ({ backdropFilter: 'blur(18px) saturate(1.4)' } as object) : null,
          shadow.md,
        ]}
      >
        {state.routes.map((route, index) => {
          const focused = state.index === index;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (focused || event.defaultPrevented) return;
            haptics.select();
            navigation.navigate(route.name);
          };

          return (
            <TabItem key={route.key} routeName={route.name} focused={focused} compact={compact} onPress={onPress} />
          );
        })}
      </View>
    </View>
  );
}
