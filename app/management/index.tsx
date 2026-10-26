import { useState } from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Users, MapPinned, Flag, ShieldCheck } from 'lucide-react-native';
import { AppButton, AppHeader, AppText, Card, ErrorState, Screen, Segmented, SkeletonGroup } from '@/components/ui';
import { AdminUsers } from '@/components/management/AdminUsers';
import { AdminAudit } from '@/components/management/AdminAudit';
import { AdminReviews } from '@/components/management/AdminReviews';
import { managementService } from '@/services/http/managementService';
import { useAuthStore } from '@/store/authStore';
import { useLocale } from '@/hooks/useLocale';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/spacing';
import { radius } from '@/theme/radius';

type Tab = 'overview' | 'users' | 'reports' | 'appeals' | 'audit';
/** Dashboard and review components adapted from Abdelrahman's management portal. */
export default function AdminDashboard() {
  const user = useAuthStore(s => s.user);
  const { locale, row, alignStart } = useLocale();
  const { colors } = useTheme();
  const ar = locale === 'ar';
  const [tab, setTab] = useState<Tab>('overview');
  const summary = useQuery({ queryKey: ['admin', 'summary', user?.id], queryFn: managementService.summary, enabled: user?.role === 'ADMIN' });
  if (user?.role !== 'ADMIN') return <Redirect href="/management/zones" />;
  if (user?.role !== 'ADMIN') return null;
  return <Screen safeTop={false} contentContainerStyle={{ gap: spacing.lg }}>
    <AppHeader title={ar ? 'لوحة الإدارة' : 'Admin dashboard'} trailing={<AppButton label={ar ? 'تحديث' : 'Refresh'} size="sm" fullWidth={false} variant="ghost" style={{ paddingHorizontal: spacing.md, backgroundColor: colors.track }} loading={summary.isFetching} onPress={() => void summary.refetch()} />} />
    <Segmented value={tab} onChange={setTab} options={[
      {value:'overview',label:ar?'نظرة عامة':'Overview'}, {value:'users',label:ar?'المستخدمون':'Users'},
      {value:'reports',label:ar?'البلاغات':'Reports'}, {value:'appeals',label:ar?'الاعتراضات':'Appeals'}, {value:'audit',label:ar?'سجل التدقيق':'Audit'},
    ]} />
    {tab === 'overview' ? summary.error ? <ErrorState error={summary.error} onRetry={() => void summary.refetch()} /> : summary.isPending ? <SkeletonGroup count={3} height={96} /> : <View style={{flexDirection:row,flexWrap:'wrap',gap:spacing.sm}}>
      {[
        {Icon:Users,value:summary.data.activeUsers,label:ar?'المستخدمون النشطون':'Active users'},
        {Icon:Users,value:summary.data.suspendedUsers,label:ar?'الحسابات الموقوفة':'Suspended users'},
        {Icon:MapPinned,value:summary.data.activeZones,label:ar?'المواقف النشطة':'Active parking zones'},
        {Icon:Flag,value:summary.data.visibleReports,label:ar?'البلاغات الظاهرة':'Visible reports'},
        {Icon:ShieldCheck,value:summary.data.openAppeals,label:ar?'الاعتراضات المفتوحة':'Open appeals'},
      ].map(({Icon,value,label})=>(
        <Card key={label} padding="md" style={{flexGrow:1,flexBasis:'45%',minWidth:140,gap:spacing.sm}}>
          <View style={{alignSelf:alignStart,width:32,height:32,borderRadius:radius.sm,alignItems:'center',justifyContent:'center',backgroundColor:colors.brandSofter}}>
            <Icon size={16} color={colors.brand} strokeWidth={2.1}/>
          </View>
          <View style={{gap:2}}>
            <AppText variant="h2" numeric>{value}</AppText>
            <AppText variant="caption" color="textSecondary" numberOfLines={2}>{label}</AppText>
          </View>
        </Card>
      ))}
    </View> : null}
    {tab === 'users' ? <AdminUsers /> : null}
    {tab === 'reports' ? <AdminReviews kind="reports" /> : null}
    {tab === 'appeals' ? <AdminReviews kind="appeals" /> : null}
    {tab === 'audit' ? <AdminAudit /> : null}
  </Screen>;
}
