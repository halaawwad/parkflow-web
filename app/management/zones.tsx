import { useState } from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { MapPinned, Search } from 'lucide-react-native';
import { AppButton, AppHeader, AppText, Card, EmptyState, ErrorState, Screen, SkeletonGroup, StatusBadge, TextField } from '@/components/ui';
import { ZoneEditor } from '@/components/management/ZoneEditor';
import { Organizations } from '@/components/management/Organizations';
import { managementService } from '@/services/http/managementService';
import { useAuthStore } from '@/store/authStore';
import { useLocale } from '@/hooks/useLocale';
import { useManagementAccess } from '@/hooks/useManagementAccess';
import { spacing } from '@/theme/spacing';
import { radius } from '@/theme/radius';
import { useTheme } from '@/theme/ThemeProvider';

export default function ManagedZones(){
  const user=useAuthStore(s=>s.user); const {locale,row,alignStart}=useLocale();const {colors}=useTheme();const ar=locale==='ar';
  const access=useManagementAccess();const allowed=Boolean(access.data?.hasAccess||user?.role==='ADMIN'||user?.role==='PARKING_OPERATOR');
  const [search,setSearch]=useState('');const [selected,setSelected]=useState<string|null>(null);
  const zones=useQuery({queryKey:['management','zones',user?.id],queryFn:managementService.zones,enabled:allowed});
  const selectedZone=zones.data?.find(zone=>zone.id===selected);
  if(!allowed)return null;
  return <Screen safeTop={false} contentContainerStyle={{gap:spacing.lg}}>
    <AppHeader title={ar?(user?.role==='ADMIN'?'المواقف والمؤسسات':'مواقفي'):(user?.role==='ADMIN'?'Parking & organizations':'My parking')} trailing={<AppButton label={ar?'تحديث':'Refresh'} variant="ghost" style={{ paddingHorizontal: spacing.md, backgroundColor: colors.track }} size="sm" fullWidth={false} loading={zones.isFetching} onPress={()=>void zones.refetch()}/>}/>
    {user?.role==='ADMIN'?<Organizations/>:null}
    <TextField label={ar?'ابحث عن موقف':'Search parking'} value={search} onChangeText={setSearch} leading={<Search size={18} color={colors.textTertiary}/>}/>
    {zones.isPending?<SkeletonGroup count={3} height={110}/>:zones.error?<ErrorState error={zones.error} onRetry={()=>void zones.refetch()}/>:<>
      {!zones.data.length?<EmptyState title={ar?'لا توجد مواقف مرتبطة بحسابك.':'No assigned parking zones.'}/>:null}
      {zones.data.filter(z=>[z.name,z.nameAr,z.code,z.city,z.cityAr].some(v=>v.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))).map(zone=><Card key={zone.id} padding="md" style={{gap:spacing.sm}}>
        <View style={{flexDirection:row,gap:spacing.md,alignItems:'center'}}>
          <View style={{width:36,height:36,borderRadius:radius.sm,alignItems:'center',justifyContent:'center',backgroundColor:colors.brandSofter}}><MapPinned size={18} color={colors.brand}/></View>
          <View style={{flex:1,minWidth:0,gap:2}}>
            <AppText variant="title" numberOfLines={1}>{ar?zone.nameAr:zone.name}</AppText>
            <AppText variant="caption" color="textTertiary" numberOfLines={1}>{/* City first: the line's first strong letter sets its direction, so Arabic stays in order. */}{ar?zone.cityAr:zone.city} · {zone.code} · {ar?'السعة':'Capacity'}: {zone.capacity??'—'}</AppText>
          </View>
          <StatusBadge size="sm" label={zone.active?(ar?'نشط':'Active'):(ar?'متوقف':'Inactive')} tone={zone.active?'success':'warning'}/>
        </View>
        <AppButton label={zone.canManageZone?(ar?'إدارة الموقف':'Manage parking'):(ar?'تفاصيل الموقف':'Parking details')} variant="ghost" size="sm" fullWidth={false} onPress={()=>setSelected(zone.id)}
          style={{alignSelf:alignStart,paddingHorizontal:spacing.md,backgroundColor:colors.track}}/>
      </Card>)}
    </>}
    {selectedZone?<ZoneEditor key={selectedZone.id} zone={selectedZone} onClose={()=>setSelected(null)}/>:null}
  </Screen>;
}
