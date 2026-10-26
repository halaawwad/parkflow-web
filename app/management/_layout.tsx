import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, usePathname, useRouter } from 'expo-router';
import { AppButton, AppText, Screen, Segmented } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { useLocale } from '@/hooks/useLocale';
import { useTheme } from '@/theme/ThemeProvider';
import { useManagementAccess } from '@/hooks/useManagementAccess';
import { screenPadding, spacing } from '@/theme/spacing';

/** Uses the customer's existing login. API role checks remain authoritative. */
export default function ManagementLayout() {
  const user = useAuthStore(s => s.user);
  const { locale, row } = useLocale();
  const { colors } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const ar = locale === 'ar';
  const access = useManagementAccess();
  const insets = useSafeAreaInsets();
  const allowed = access.data?.hasAccess || user?.role === 'ADMIN' || user?.role === 'PARKING_OPERATOR';
  if (!allowed && access.isPending) return <Screen><AppText>{ar?'جارٍ التحقق من الصلاحيات…':'Checking access…'}</AppText></Screen>;
  if (!allowed || !user) return <Screen><AppText variant="h2">{ar ? 'لا تملك صلاحية الدخول إلى الإدارة.' : 'Management access required.'}</AppText><AppButton label={ar ? 'العودة للخريطة' : 'Back to map'} onPress={() => router.replace('/(tabs)/map')} /></Screen>;
  const sections = [
    ...(user.role === 'ADMIN' ? [{ value: '/management', label: ar ? 'لوحة الإدارة' : 'Admin dashboard' }] : []),
    { value: '/management/zones', label: ar ? (user.role === 'ADMIN' ? 'المواقف والمؤسسات' : 'مواقفي') : (user.role === 'ADMIN' ? 'Parking & organizations' : 'My parking') },
    ...(user.role === 'ADMIN' || user.role === 'PARKING_OPERATOR' ? [{ value: '/management/smartgate', label: 'SmartGate' }] : []),
    ...(access.data?.canViewAnalytics ? [{ value: '/management/analytics', label: ar ? 'التحليلات' : 'Analytics' }] : []),
    ...(access.data?.canManageStaff ? [{ value: '/management/staff', label: ar ? 'الموظفون' : 'Staff' }] : []),
  ];
  const current = sections.find((section) => section.value !== '/management' && pathname.includes(section.value))?.value ?? '/management';
  return <View style={{ flex: 1, backgroundColor: colors.background }}>
    {/* One console header: who and where on one line, sections as a single scrolling row. */}
    <View style={{ paddingTop: insets.top + spacing.md, paddingBottom: spacing.md, gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth * 2, borderBottomColor: colors.divider, backgroundColor: colors.surface }}>
      <View style={{ flexDirection: row, alignItems: 'center', gap: spacing.md, paddingHorizontal: screenPadding }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText variant="titleLg" numberOfLines={1}>{ar ? 'إدارة ParkFlow' : 'ParkFlow management'}</AppText>
          <AppText variant="caption" color="textTertiary" numberOfLines={1}>{user.fullName}</AppText>
        </View>
        <AppButton label={ar ? 'الخريطة' : 'Map'} variant="ghost" size="sm" fullWidth={false} onPress={() => router.replace('/(tabs)/map')}
          style={{ paddingHorizontal: spacing.md, backgroundColor: colors.track }} />
      </View>
      <Segmented
        value={current}
        onChange={(next) => router.replace(next as never)}
        options={sections}
        style={{ paddingHorizontal: screenPadding }}
      />
    </View>
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
  </View>;
}
