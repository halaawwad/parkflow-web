import { View } from 'react-native';
import { Stack, usePathname, useRouter } from 'expo-router';
import { AppButton, AppText, Screen } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { useLocale } from '@/hooks/useLocale';
import { useTheme } from '@/theme/ThemeProvider';
import { useManagementAccess } from '@/hooks/useManagementAccess';
import { spacing } from '@/theme/spacing';

/** Uses the customer's existing login. API role checks remain authoritative. */
export default function ManagementLayout() {
  const user = useAuthStore(s => s.user);
  const { locale, row } = useLocale();
  const { colors } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const ar = locale === 'ar';
  const access = useManagementAccess();
  const allowed = access.data?.hasAccess || user?.role === 'ADMIN' || user?.role === 'PARKING_OPERATOR';
  if (!allowed && access.isPending) return <Screen><AppText>{ar?'جارٍ التحقق من الصلاحيات…':'Checking access…'}</AppText></Screen>;
  if (!allowed || !user) return <Screen><AppText variant="h2">{ar ? 'لا تملك صلاحية الدخول إلى الإدارة.' : 'Management access required.'}</AppText><AppButton label={ar ? 'العودة للخريطة' : 'Back to map'} onPress={() => router.replace('/(tabs)/map')} /></Screen>;
  return <View style={{ flex: 1, backgroundColor: colors.background }}>
    <View style={{ padding: spacing.lg, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }}>
      <View style={{ flexDirection: row, flexWrap: 'wrap', alignItems: 'center', gap: spacing.md }}>
        <View style={{ flex: 1, minWidth: 180 }}><AppText variant="title">{ar ? 'إدارة ParkFlow' : 'ParkFlow management'}</AppText><AppText variant="caption" color="textSecondary">{user.fullName}</AppText></View>
        <AppButton label={ar ? 'الخريطة' : 'Map'} variant="ghost" size="sm" fullWidth={false} onPress={() => router.replace('/(tabs)/map')} />
      </View>
      <View style={{ flexDirection: row, flexWrap: 'wrap', gap: spacing.sm }}>
        {user.role === 'ADMIN' ? <AppButton label={ar ? 'لوحة الإدارة' : 'Admin dashboard'} size="sm" fullWidth={false} variant={pathname === '/management' ? 'secondary' : 'ghost'} onPress={() => router.replace('/management')} /> : null}
        <AppButton label={ar ? (user.role === 'ADMIN' ? 'المواقف والمؤسسات' : 'مواقفي') : (user.role === 'ADMIN' ? 'Parking & organizations' : 'My parking')} size="sm" fullWidth={false} variant={pathname.includes('/zones') ? 'secondary' : 'ghost'} onPress={() => router.replace('/management/zones')} />
        {access.data?.canViewAnalytics ? <AppButton label={ar?'التحليلات':'Analytics'} size="sm" fullWidth={false} variant={pathname.includes('/analytics')?'secondary':'ghost'} onPress={()=>router.replace('/management/analytics')}/> : null}
        {access.data?.canManageStaff ? <AppButton label={ar?'الموظفون':'Staff'} size="sm" fullWidth={false} variant={pathname.includes('/staff')?'secondary':'ghost'} onPress={()=>router.replace('/management/staff')}/> : null}
      </View>
    </View>
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
  </View>;
}
