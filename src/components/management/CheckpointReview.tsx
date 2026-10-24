import { useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api,segment } from '@/services/http/apiClient';
import { AppButton, AppText, Card, ErrorState, TextField, Skeleton } from '@/components/ui';
import { useLocale } from '@/hooks/useLocale';
import { spacing } from '@/theme/spacing';
interface Candidate {id:string;nameAr:string;nameEn:string;kind:string;latitude:number;longitude:number;enabledForLiveReporting:boolean;directions:{id:string;nameAr:string;nameEn:string}[];sourceReferences:unknown[]}
function CandidateReview({candidate:c}:{candidate:Candidate}) {
 const {t,locale}=useLocale();const client=useQueryClient();
 const [expanded,setExpanded]=useState(false);const [latitude,setLatitude]=useState(String(c.latitude));const [longitude,setLongitude]=useState(String(c.longitude));
 const [directions,setDirections]=useState(c.directions.map(d=>`${d.id} | ${d.nameAr} | ${d.nameEn}`).join('\n'));
 const [reviewed,setReviewed]=useState(false);const [saved,setSaved]=useState(false);
 const mutation=useMutation({networkMode:'always',mutationFn:async(enabledForLiveReporting:boolean)=>{
  const parsed=directions.split('\n').filter(s=>s.trim()).map(line=>{const [id,nameAr,nameEn,...extra]=line.split('|').map(s=>s.trim());if(!id || !nameAr || !nameEn || extra.length)throw new Error(t('roads.directionFormat'));return {id,nameAr,nameEn};});
  if(!reviewed || !latitude.trim() || !longitude.trim() || !Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude)))throw new Error(t('roads.reviewCoordinates'));
  return api(`/admin/checkpoints/${segment(c.id)}`,{method:'PATCH',body:{latitude:Number(latitude),longitude:Number(longitude),directions:parsed,coordinatesReviewed:true,enabledForLiveReporting}});
 },onSuccess:()=>{setSaved(true);setReviewed(false);void client.invalidateQueries({queryKey:['admin','checkpoints']});void client.invalidateQueries({queryKey:['roads']});}});
 return <Card padding="md"><View style={{gap:spacing.sm}}>
  <AppButton variant="secondary" label={`${locale==='ar'?c.nameAr:c.nameEn} / ${t(c.kind==='road_gate'?'roads.roadGate':'roads.checkpointKind')} / ${t(c.enabledForLiveReporting?'roads.update':'roads.needsReview')}`} onPress={()=>setExpanded(!expanded)}/>
  {expanded?<>
   <AppText variant="caption">{t('roads.source')}</AppText>
   <AppText variant="caption" selectable>{JSON.stringify(c.sourceReferences,null,2)}</AppText>
   <TextField label={t('roads.latitude')} value={latitude} onChangeText={v=>{setLatitude(v);setReviewed(false);setSaved(false);}} keyboardType="decimal-pad" editable={!mutation.isPending}/>
   <TextField label={t('roads.longitude')} value={longitude} onChangeText={v=>{setLongitude(v);setReviewed(false);setSaved(false);}} keyboardType="decimal-pad" editable={!mutation.isPending}/>
   <TextField label={t('roads.directionFormat')} value={directions} onChangeText={v=>{setDirections(v);setReviewed(false);setSaved(false);}} multiline editable={!mutation.isPending}/>
   <AppButton variant={reviewed?'primary':'secondary'} label={`${reviewed?'[x] ':''}${t('roads.reviewCoordinates')}`} disabled={mutation.isPending} onPress={()=>{setReviewed(!reviewed);setSaved(false);}}/>
   <AppButton label={t('roads.activate')} disabled={!reviewed || mutation.isPending} loading={mutation.isPending} onPress={()=>mutation.mutate(true)}/>
   {c.enabledForLiveReporting?<AppButton variant="secondary" label={t('roads.deactivate')} disabled={!reviewed || mutation.isPending} onPress={()=>mutation.mutate(false)}/>:null}
   {mutation.isError?<ErrorState compact error={mutation.error}/>:null}
   {saved?<AppText color="successText">{t('roads.reviewed')}</AppText>:null}
  </>:null}
 </View></Card>;
}
export function CheckpointReview(){
 const {t}=useLocale();const query=useQuery({queryKey:['admin','checkpoints'],queryFn:()=>api<Candidate[]>('/admin/checkpoints')});
 return <View style={{gap:spacing.md}}><AppText variant="h2">{t('roads.reviewTitle')}</AppText>
  {query.isPending?<Skeleton height={80}/>:null}
  {query.isError?<ErrorState compact error={query.error} onRetry={()=>void query.refetch()}/>:null}
  {query.data?.map(c=><CandidateReview key={c.id} candidate={c}/>)}
 </View>;
}
