import { useState } from 'react';
import { View } from 'react-native';
import * as Location from 'expo-location';
import { AppButton, AppText, TextField, ErrorState } from '@/components/ui';
import { useLocale } from '@/hooks/useLocale';
import { useConfirmCheckpoint, useReportCheckpoint } from '@/hooks/useCommunity';
import { useUserId } from '@/hooks/useSession';
import type { CheckpointState, CheckpointReportStatus, CheckpointObservation } from '@/types/road';
import { spacing } from '@/theme/spacing';

const statuses:CheckpointReportStatus[]=['open','congested','severe','closed'];
const skipLocationInDevelopment = __DEV__ && process.env.EXPO_PUBLIC_DEV_SKIP_CHECKPOINT_LOCATION === 'true';
async function capture():Promise<CheckpointObservation['location']> {
 try {
  if(!(await Location.requestForegroundPermissionsAsync()).granted)return undefined;
  const position=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.Balanced});
  const {latitude,longitude,accuracy}=position.coords;
  return accuracy==null ? undefined : {latitude,longitude,accuracy,capturedAt:new Date(position.timestamp).toISOString()};
 } catch {return undefined;}
}
export function CheckpointLiveDetails({checkpoint:cp}:{checkpoint:CheckpointState}) {
 const {t,locale,row}=useLocale();const userId=useUserId();
 const report=useReportCheckpoint(),confirm=useConfirmCheckpoint();
 const [directionId,setDirection]=useState('');const [status,setStatus]=useState<CheckpointReportStatus>();
 const [note,setNote]=useState('');const [editing,setEditing]=useState(false);
 const [locating,setLocating]=useState(false);const [needsUnverified,setNeedsUnverified]=useState(false);
 const [pendingConfirmation,setPendingConfirmation]=useState<string>();
 const [success,setSuccess]=useState(false);const [failure,setFailure]=useState<unknown>();
 const busy=locating || report.isPending || confirm.isPending;
 const send=async(unverified=false,reportId?:string)=>{
  if(busy || !userId || !directionId || (!reportId && !status))return;
  setSuccess(false);setFailure(undefined);setLocating(true);
  try {
   unverified = unverified || skipLocationInDevelopment;
   const location=unverified ? undefined : await Promise.race([capture(),new Promise<undefined>(resolve=>setTimeout(()=>resolve(undefined),15000))]);
   if(!location && !unverified){setNeedsUnverified(true);setPendingConfirmation(reportId);return;}
   const input={checkpointId:cp.id,directionId,observedAt:new Date().toISOString(),unverified,location};
   if(reportId)await confirm.mutateAsync({...input,reportId});
   else await report.mutateAsync({...input,status:status!,note:note.trim() || undefined});
   setSuccess(true);setNeedsUnverified(false);setPendingConfirmation(undefined);setEditing(false);setNote('');
  }catch(error){setFailure(error);setNeedsUnverified(true);setPendingConfirmation(reportId);}
  finally{setLocating(false);}
 };
 return <View style={{gap:spacing.md}}>
  <AppText variant="caption">{t('roads.community')}</AppText>
  {(cp.directions??[]).map(d=><View key={d.id} style={{gap:spacing.xs}}>
   <AppText variant="title">{t(d.id==='entrance'?'roads.entrance':'roads.exit')}</AppText>
   <AppText>{t(`roads.status.${d.status}`)} / {t(`roads.${d.confidence}`)}</AppText>
   <AppText variant="caption">{t('roads.confirmations',{count:d.confirmationCount})}</AppText>
   {d.lastObservedAt?<AppText variant="caption">{t('roads.lastObservation',{time:new Date(d.lastObservedAt).toLocaleString(locale)})}</AppText>:null}
   {d.reports.map(r=><View key={r.id} style={{gap:spacing.xs}}>
    <AppText variant="caption">{t(`roads.status.${r.status}`)}{r.note?` / ${r.note}`:''}{!r.locationVerified?` / ${t('roads.unverifiedLocation')}`:''}</AppText>
    {!r.isConfirmation?<AppButton size="sm" variant="secondary" label={t('roads.same')} disabled={busy || !userId} onPress={()=>{setDirection(d.id);setPendingConfirmation(r.id);setNeedsUnverified(false);setSuccess(false);setFailure(undefined);setEditing(false);}}/>:null}
   </View>)}
   <AppButton size="sm" variant="secondary" label={t('roads.changed')} disabled={busy || !userId} onPress={()=>{setDirection(d.id);setEditing(true);setPendingConfirmation(undefined);setNeedsUnverified(false);setSuccess(false);setFailure(undefined);}}/>
  </View>)}
  <AppButton label={t('roads.update')} disabled={busy || !userId} onPress={()=>{setEditing(true);setPendingConfirmation(undefined);setSuccess(false);setFailure(undefined);}}/>
  {editing?<View style={{gap:spacing.sm}}>
   <AppText>{t('roads.direction')}</AppText>
   {(cp.directions??[]).map(d=><AppButton key={d.id} label={t(d.id==='entrance'?'roads.entrance':'roads.exit')} size="sm" variant={directionId===d.id?'primary':'secondary'} disabled={busy} onPress={()=>{setDirection(d.id);setNeedsUnverified(false);}}/>)}
   <View style={{flexDirection:row,flexWrap:'wrap',gap:spacing.xs}}>{statuses.map(s=><AppButton key={s} fullWidth={false} size="sm" label={t(`roads.status.${s}`)} variant={status===s?'primary':'secondary'} disabled={busy} onPress={()=>{setStatus(s);setSuccess(false);}}/>)}</View>
   <TextField label={t('roads.note')} maxLength={200} value={note} onChangeText={setNote} editable={!busy}/>
  </View>:null}
  {editing || pendingConfirmation?<View style={{gap:spacing.sm}}>
   {!skipLocationInDevelopment?<AppText variant="caption">{t('roads.locationHelp')}</AppText>:null}
   <AppButton label={pendingConfirmation?t('roads.same'):t('roads.submit')} loading={busy} disabled={!directionId || !userId || (!pendingConfirmation && !status)} onPress={()=>void send(false,pendingConfirmation)}/>
  </View>:null}
  {needsUnverified && !skipLocationInDevelopment?<View style={{gap:spacing.sm}}><AppText>{t('roads.unverifiedHelp')}</AppText><AppButton variant="secondary" label={t('roads.unverifiedSubmit')} loading={busy} disabled={!directionId || !userId || (!pendingConfirmation && !status)} onPress={()=>void send(true,pendingConfirmation)}/></View>:null}
  {failure?<><AppText>{t('roads.failedDraft')}</AppText><ErrorState compact error={failure}/></>:null}
  {success?<AppText color="successText">{t('roads.reportThanks')}</AppText>:null}
 </View>;
}
