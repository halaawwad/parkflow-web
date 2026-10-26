import { useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api,segment } from '@/services/http/apiClient';
import { Check, ChevronDown, ChevronUp } from 'lucide-react-native';
import { AppButton, AppText, Card, ErrorState, InlineNotice, PressableScale, StatusBadge, TextField, Skeleton } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius } from '@/theme/radius';
import { errorMessage, isAppError } from '@/utils/errors';
import { useLocale } from '@/hooks/useLocale';
import { spacing } from '@/theme/spacing';
interface Candidate {id:string;nameAr:string;nameEn:string;kind:string;latitude:number;longitude:number;enabledForLiveReporting:boolean;sourceReferences:unknown[]}
function CandidateReview({candidate:c}:{candidate:Candidate}) {
 const {t,locale,row}=useLocale();const {colors}=useTheme();const client=useQueryClient();
 const [expanded,setExpanded]=useState(false);const [latitude,setLatitude]=useState(String(c.latitude));const [longitude,setLongitude]=useState(String(c.longitude));
 const [reviewed,setReviewed]=useState(false);const [saved,setSaved]=useState(false);
 const mutation=useMutation({networkMode:'always',mutationFn:async(enabledForLiveReporting:boolean)=>{
  if(!reviewed || !latitude.trim() || !longitude.trim() || !Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude)))throw new Error(t('roads.reviewCoordinates'));
  if(Math.abs(Number(latitude))>90 || Math.abs(Number(longitude))>180)throw new Error(locale==='ar'?'خط العرض يجب أن يكون بين ‎-90 و90، وخط الطول بين ‎-180 و180.':'Latitude must be between -90 and 90; longitude between -180 and 180.');
  return api(`/admin/checkpoints/${segment(c.id)}`,{method:'PATCH',body:{latitude:Number(latitude),longitude:Number(longitude),coordinatesReviewed:true,enabledForLiveReporting}});
 },onSuccess:()=>{setSaved(true);setReviewed(false);void client.invalidateQueries({queryKey:['admin','checkpoints']});void client.invalidateQueries({queryKey:['roads']});}});
 return <Card padding="md"><View style={{gap:spacing.sm}}>
  {/* A list row, not a button: name, then kind and review state, with a disclosure chevron. */}
  <PressableScale
   onPress={()=>setExpanded(!expanded)}
   haptic="select"
   scaleTo={0.99}
   accessibilityRole="button"
   accessibilityState={{expanded}}
   accessibilityLabel={`${locale==='ar'?c.nameAr:c.nameEn} / ${t(c.kind==='road_gate'?'roads.roadGate':'roads.checkpointKind')} / ${t(c.enabledForLiveReporting?'roads.approved':'roads.needsReview')}`}
   style={{flexDirection:row,alignItems:'center',gap:spacing.md,minHeight:44}}
  >
   <View style={{flex:1,minWidth:0,gap:spacing.xs}}>
    <AppText variant="title" numberOfLines={1}>{locale==='ar'?c.nameAr:c.nameEn}</AppText>
    <View style={{flexDirection:row,alignItems:'center',gap:spacing.sm,flexWrap:'wrap'}}>
     <AppText variant="caption" color="textTertiary">{t(c.kind==='road_gate'?'roads.roadGate':'roads.checkpointKind')}</AppText>
     <StatusBadge size="sm" label={t(c.enabledForLiveReporting?'roads.approved':'roads.needsReview')} tone={c.enabledForLiveReporting?'success':'warning'}/>
    </View>
   </View>
   {expanded?<ChevronUp size={18} color={colors.textTertiary}/>:<ChevronDown size={18} color={colors.textTertiary}/>}
  </PressableScale>
  {expanded?<>
   <AppText variant="caption" color="textTertiary" style={{marginTop:spacing.xs}}>{t('roads.source')}</AppText>
   <View style={{padding:spacing.md,borderRadius:radius.md,backgroundColor:colors.background}}>
    <AppText variant="caption" color="textSecondary" selectable forceLtrAlign>{JSON.stringify(c.sourceReferences,null,2)}</AppText>
   </View>
   <TextField label={t('roads.latitude')} value={latitude} onChangeText={v=>{setLatitude(v);setReviewed(false);setSaved(false);}} keyboardType="decimal-pad" editable={!mutation.isPending}/>
   <TextField label={t('roads.longitude')} value={longitude} onChangeText={v=>{setLongitude(v);setReviewed(false);setSaved(false);}} keyboardType="decimal-pad" editable={!mutation.isPending}/>
   <AppText variant="caption" color="textSecondary">{t('roads.approvalHelp')}</AppText>
   {/* The confirmation is a checkbox, so it reads as a statement the reviewer ticks. */}
   <PressableScale
    onPress={()=>{setReviewed(!reviewed);setSaved(false);}}
    disabled={mutation.isPending}
    haptic="select"
    scaleTo={0.99}
    accessibilityRole="checkbox"
    accessibilityState={{checked:reviewed,disabled:mutation.isPending}}
    accessibilityLabel={t('roads.reviewCoordinates')}
    style={{flexDirection:row,alignItems:'center',gap:spacing.md,minHeight:48,paddingHorizontal:spacing.md,borderRadius:radius.md,backgroundColor:reviewed?colors.brandSoft:colors.track}}
   >
    <View style={{width:22,height:22,borderRadius:radius.xs,borderWidth:1.5,borderColor:reviewed?colors.brand:colors.borderStrong,backgroundColor:reviewed?colors.brand:colors.surface,alignItems:'center',justifyContent:'center'}}>
     {reviewed?<Check size={14} color={colors.onBrand} strokeWidth={3}/>:null}
    </View>
    <AppText variant="label" style={{flex:1}} color={reviewed?'successText':'text'}>{t('roads.reviewCoordinates')}</AppText>
   </PressableScale>
   <AppButton label={t('roads.activate')} disabled={!reviewed || mutation.isPending} loading={mutation.isPending} onPress={()=>mutation.mutate(true)}/>
   {c.enabledForLiveReporting?<AppButton variant="secondary" label={t('roads.deactivate')} disabled={!reviewed || mutation.isPending} onPress={()=>mutation.mutate(false)}/>:null}
   {mutation.isError?<InlineNotice tone="danger" title={t('common.somethingWrong')} body={!isAppError(mutation.error) && mutation.error instanceof Error ? mutation.error.message : errorMessage(mutation.error)}/>:null}
   {saved?<AppText variant="label" color="successText">{t('roads.reviewed')}</AppText>:null}
  </>:null}
 </View></Card>;
}
export function CheckpointReview(){
 const {t}=useLocale();const query=useQuery({queryKey:['admin','checkpoints'],queryFn:()=>api<Candidate[]>('/admin/checkpoints')});
 return <View style={{gap:spacing.sm}}><AppText variant="h3">{t('roads.reviewTitle')}</AppText>
  {query.isPending?<Skeleton height={80}/>:null}
  {query.isError?<ErrorState compact error={query.error} onRetry={()=>void query.refetch()}/>:null}
  {query.data?.map(c=><CandidateReview key={c.id} candidate={c}/>)}
 </View>;
}
