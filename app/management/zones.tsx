import { useState } from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { MapPinned } from 'lucide-react-native';
import { AppButton, AppHeader, AppText, Card, EmptyState, ErrorState, Screen, StatusBadge, TextField } from '@/components/ui';
import { ZoneEditor } from '@/components/management/ZoneEditor';
import { Organizations } from '@/components/management/Organizations';
import { managementService } from '@/services/http/managementService';
import { useAuthStore } from '@/store/authStore';
import { useLocale } from '@/hooks/useLocale';
import { useManagementAccess } from '@/hooks/useManagementAccess';
import { spacing } from '@/theme/spacing';
import { useTheme } from '@/theme/ThemeProvider';

export default function ManagedZones(){
  const user=useAuthStore(s=>s.user); const {locale,row}=useLocale();const {colors}=useTheme();const ar=locale==='ar';
  const access=useManagementAccess();const allowed=Boolean(access.data?.hasAccess||user?.role==='ADMIN'||user?.role==='PARKING_OPERATOR');
  const [search,setSearch]=useState('');const [selected,setSelected]=useState<string|null>(null);
  const zones=useQuery({queryKey:['management','zones',user?.id],queryFn:managementService.zones,enabled:allowed});
  const selectedZone=zones.data?.find(zone=>zone.id===selected);
  if(!allowed)return null;
  return <Screen contentContainerStyle={{gap:spacing.lg}}>
    <AppHeader title={ar?(user?.role==='ADMIN'?'المواقف والمؤسسات':'مواقفي'):(user?.role==='ADMIN'?'Parking & organizations':'My parking')} trailing={<AppButton label={ar?'تحديث':'Refresh'} variant="secondary" size="sm" fullWidth={false} loading={zones.isFetching} onPress={()=>void zones.refetch()}/>}/>
    {user?.role==='ADMIN'?<Organizations/>:null}
    <TextField label={ar?'ابحث عن موقف':'Search parking'} value={search} onChangeText={setSearch}/>
    {zones.isPending?<AppText>{ar?'جارٍ التحميل…':'Loading…'}</AppText>:zones.error?<ErrorState error={zones.error} onRetry={()=>void zones.refetch()}/>:<>
      {!zones.data.length?<EmptyState title={ar?'لا توجد مواقف مرتبطة بحسابك.':'No assigned parking zones.'}/>:null}
      {zones.data.filter(z=>[z.name,z.nameAr,z.code,z.city,z.cityAr].some(v=>v.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))).map(zone=><Card key={zone.id} padding="lg" style={{gap:spacing.md}}>
        <View style={{flexDirection:row,gap:spacing.md,alignItems:'center'}}><MapPinned size={24} color={colors.brand}/><View style={{flex:1}}><AppText variant="title">{ar?zone.nameAr:zone.name}</AppText><AppText color="textSecondary">{zone.code} · {ar?zone.cityAr:zone.city}</AppText></View><StatusBadge label={zone.active?(ar?'نشط':'Active'):(ar?'متوقف':'Inactive')} tone={zone.active?'success':'warning'}/></View>
        <AppText variant="caption">{ar?'السعة':'Capacity'}: {zone.capacity??'—'}</AppText>
        <AppButton label={zone.canManageZone?(ar?'إدارة الموقف':'Manage parking'):(ar?'تفاصيل الموقف':'Parking details')} variant="secondary" onPress={()=>setSelected(zone.id)}/>
      </Card>)}
    </>}
    {selectedZone?<ZoneEditor key={selectedZone.id} zone={selectedZone} onClose={()=>setSelected(null)}/>:null}
  </Screen>;
}
