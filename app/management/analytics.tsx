import { useState } from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { AppButton, AppHeader, AppText, Card, EmptyState, ErrorState, Screen, Segmented, SkeletonGroup } from '@/components/ui';
import { managementService } from '@/services/http/managementService';
import { useManagementAccess } from '@/hooks/useManagementAccess';
import { useAuthStore } from '@/store/authStore';
import { useLocale } from '@/hooks/useLocale';
import { spacing } from '@/theme/spacing';
import { formatDateTime } from '@/utils/time';

/** Adapted from Abdelrahman's operator analytics, using current data contracts. */
export default function OperatorAnalytics(){
  const {locale,dateLocale,row}=useLocale();const ar=locale==='ar';const user=useAuthStore(s=>s.user);
  const access=useManagementAccess();const [period,setPeriod]=useState<'7'|'30'|'90'>('30');
  const analytics=useQuery({queryKey:['management','analytics',user?.id,period],queryFn:()=>managementService.analytics(Number(period)),enabled:Boolean(access.data?.canViewAnalytics)});
  if(access.isPending)return <Screen><SkeletonGroup count={2}/></Screen>;
  if(access.error)return <Screen><ErrorState error={access.error} onRetry={()=>void access.refetch()}/></Screen>;
  if(!access.data?.canViewAnalytics)return <Screen><AppText>{ar?'لا تملك صلاحية عرض التحليلات.':'Analytics permission required.'}</AppText></Screen>;
  return <Screen contentContainerStyle={{gap:spacing.lg}}>
    <AppHeader title={ar?'تحليلات المواقف':'Parking analytics'} trailing={<AppButton label={ar?'تحديث':'Refresh'} variant="secondary" size="sm" fullWidth={false} loading={analytics.isFetching} onPress={()=>void analytics.refetch()}/>}/>
    <Segmented value={period} onChange={setPeriod} options={['7','30','90'].map(value=>({value:value as '7'|'30'|'90',label:ar?`آخر ${value} يوم`:`Last ${value} days`}))}/>
    <AppText variant="caption" color="textSecondary">{ar?'الحجوزات المنشأة خلال الفترة، وآخر إشغال مسجّل. غياب بيانات الإشغال يظهر كغير متوفر.':'Reservations created during the period and the latest recorded occupancy. Missing occupancy is shown as unavailable.'}</AppText>
    {analytics.isPending?<SkeletonGroup count={2}/>:analytics.error?<ErrorState error={analytics.error} onRetry={()=>void analytics.refetch()}/>:analytics.data.zones.length===0?<EmptyState title={ar?'لا توجد مواقف متاحة للتحليل.':'No assigned zones available for analytics.'}/>:<View style={{gap:spacing.lg}}>
      {analytics.data.zones.map(zone=><Card key={zone.zoneId} padding="lg" style={{gap:spacing.md}}>
        <AppText variant="title">{ar?zone.nameAr:zone.name}</AppText>
        <View style={{flexDirection:row,flexWrap:'wrap',gap:spacing.md}}>
          <Metric label={ar?'الحجوزات':'Reservations'} value={String(zone.reservationConversion.total)}/>
          <Metric label={ar?'تم الدخول أو مكتمل':'Checked in or completed'} value={String(zone.reservationConversion.checkedIn)}/>
          <Metric label={ar?'نسبة الدخول':'Check-in rate'} value={zone.reservationConversion.rate==null?'—':`${Math.round(zone.reservationConversion.rate*100)}%`}/>
          <Metric label={ar?'جلسات التطبيق النشطة الآن':'Active app sessions now'} value={String(zone.activeSessions)}/>
          <Metric label={ar?'آخر إشغال مسجّل':'Last recorded occupancy'} value={zone.latestObservation?.occupancyPercent==null?'—':`${zone.latestObservation.occupancyPercent}%`}/>
          <Metric label={ar?'تحديثات التوفر خلال الفترة':'Availability samples in period'} value={String(zone.feedQuality.samples)}/>
        </View>
        <AppText variant="caption" color="textSecondary">{zone.latestObservation?`${ar?'آخر تسجيل':'Last observation'}: ${formatDateTime(zone.latestObservation.recordedAt,dateLocale)} · ${zone.latestObservation.source}`:(ar?'لا توجد قراءات إشغال مسجّلة.':'No recorded occupancy observations.')}</AppText>
        <AppText variant="caption" color="textSecondary">{ar?'جلسات التطبيق لا تمثل عدد السيارات الفعلي. نسبة الدخول محسوبة من حالات الحجوزات المسجّلة.':'App sessions are not physical vehicle counts. Check-in rate uses recorded reservation statuses.'}</AppText>
      </Card>)}
    </View>}
  </Screen>;
}
function Metric({label,value}:{label:string;value:string}){return <View style={{minWidth:125,flex:1,gap:spacing.xs}}><AppText variant="h2" numeric>{value}</AppText><AppText variant="caption" color="textSecondary">{label}</AppText></View>;}
