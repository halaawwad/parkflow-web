import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppButton, AppHeader, AppText, BottomSheet, Card, EmptyState, ErrorState, InlineNotice, Screen, SkeletonGroup, SwitchRow, TextField } from '@/components/ui';
import { managementService as service } from '@/services/http/managementService';
import type { StaffMember } from '@/types/management';
import { useManagementAccess } from '@/hooks/useManagementAccess';
import { useAuthStore } from '@/store/authStore';
import { useLocale } from '@/hooks/useLocale';
import { spacing } from '@/theme/spacing';
import { errorMessage } from '@/utils/errors';
import { ChoiceList } from '@/components/management/ChoiceList';

export default function StaffManagement(){
  const {locale}=useLocale();const ar=locale==='ar';const access=useManagementAccess();const user=useAuthStore(s=>s.user);
  const organizations=useQuery({queryKey:['management','owned-organizations',user?.id],queryFn:service.ownedOrganizations,enabled:Boolean(access.data?.canManageStaff)});
  const [selected,setSelected]=useState('');
  const operatorId=organizations.data?.some(o=>o.id===selected)?selected:organizations.data?.[0]?.id;
  if(access.isPending)return <Screen safeTop={false}><SkeletonGroup count={2}/></Screen>;
  if(access.error)return <Screen safeTop={false}><ErrorState error={access.error} onRetry={()=>void access.refetch()}/></Screen>;
  if(!access.data?.canManageStaff)return <Screen safeTop={false}><AppText>{ar?'إدارة الموظفين متاحة للمالك والأدمن فقط.':'Only owners and admins can manage staff.'}</AppText></Screen>;
  return <Screen safeTop={false} contentContainerStyle={{gap:spacing.lg}}>
    <AppHeader title={ar?'إدارة الموظفين':'Staff management'}/>
    <AppText variant="bodySm" color="textSecondary">{ar?'الصلاحيات تشمل مواقف المؤسسة المختارة فقط. الموظف لا يصبح مالكًا ولا يمكنه إدارة الموظفين.':'Permissions apply only to the selected organization’s zones. Staff do not become owners and cannot manage other staff.'}</AppText>
    {organizations.isPending?<SkeletonGroup count={2}/>:organizations.error?<ErrorState error={organizations.error} onRetry={()=>void organizations.refetch()}/>:<>
      <ChoiceList items={organizations.data.map(o=>({id:o.id,label:o.name}))} selectedId={operatorId} onSelect={setSelected}/>
      {operatorId?<StaffEditor key={`${user?.id}:${operatorId}`} operatorId={operatorId}/>:<EmptyState title={ar?'لا توجد مؤسسات مرتبطة بحسابك.':'No owned organizations.'}/>}
    </>}
  </Screen>;
}

function StaffEditor({operatorId}:{operatorId:string}){
  const {locale}=useLocale();const ar=locale==='ar';const client=useQueryClient();const user=useAuthStore(s=>s.user);
  const [email,setEmail]=useState('');const [viewAnalytics,setViewAnalytics]=useState(false);const [updateAvailability,setUpdateAvailability]=useState(false);
  const [remove,setRemove]=useState<StaffMember|null>(null);const [notice,setNotice]=useState('');
  const members=useQuery({queryKey:['management','staff',user?.id,operatorId],queryFn:()=>service.staff(operatorId)});
  const mutation=useMutation({mutationFn:async(action:{type:'add'}|{type:'update';member:StaffMember;canViewAnalytics:boolean;canUpdateAvailability:boolean}|{type:'remove';member:StaffMember})=>{
    if(action.type==='add')return service.addStaff(operatorId,{email:email.trim().toLowerCase(),canViewAnalytics:viewAnalytics,canUpdateAvailability:updateAvailability});
    if(action.type==='remove')return service.removeStaff(operatorId,action.member.userId);
    return service.updateStaff(operatorId,action.member.userId,{canViewAnalytics:action.canViewAnalytics,canUpdateAvailability:action.canUpdateAvailability});
  },onMutate:()=>setNotice(''),onSuccess:(_,action)=>{
    if(action.type==='add'){setEmail('');setViewAnalytics(false);setUpdateAvailability(false);}
    setRemove(null);setNotice(ar?'تم حفظ صلاحيات الموظفين.':'Staff permissions saved.');void client.invalidateQueries({queryKey:['management']});void client.invalidateQueries({queryKey:['admin','audit']});
  }});
  return <View style={{gap:spacing.lg}}>
    {mutation.error?<InlineNotice tone="danger" title={ar?'تعذر الحفظ':'Unable to save'} body={errorMessage(mutation.error)}/>:null}
    {notice?<InlineNotice tone="success" title={notice}/>:null}
    <Card padding="lg" style={{gap:spacing.md}}>
      <AppText variant="title">{ar?'إضافة موظف':'Add staff member'}</AppText>
      <AppText variant="caption" color="textSecondary">{ar?'يجب أن يسجّل الموظف حسابًا في ParkFlow أولًا. أدخل بريده المسجّل؛ لا يتم إرسال دعوة.':'The employee must register with ParkFlow first. Enter their registered email; no invitation is sent.'}</AppText>
      <TextField label={ar?'البريد المسجّل':'Registered email'} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" maxLength={254}/>
      <SwitchRow label={ar?'عرض التحليلات':'View analytics'} value={viewAnalytics} onValueChange={setViewAnalytics} disabled={mutation.isPending}/>
      <SwitchRow label={ar?'تحديث توفر المواقف':'Update parking availability'} value={updateAvailability} onValueChange={setUpdateAvailability} disabled={mutation.isPending}/>
      <AppButton label={ar?'إضافة الموظف':'Add employee'} loading={mutation.isPending&&mutation.variables?.type==='add'} disabled={mutation.isPending||!email.trim()} onPress={()=>mutation.mutate({type:'add'})}/>
    </Card>
    {members.isPending?<SkeletonGroup count={2}/>:members.error?<ErrorState error={members.error} onRetry={()=>void members.refetch()}/>:members.data.length===0?<EmptyState title={ar?'لم تضف موظفين لهذه المؤسسة.':'No staff assigned to this organization.'}/>:members.data.map(member=><MemberRow key={member.userId} member={member} busy={mutation.isPending} onSave={(canViewAnalytics,canUpdateAvailability)=>mutation.mutate({type:'update',member,canViewAnalytics,canUpdateAvailability})} onRemove={()=>setRemove(member)}/>)}
    <BottomSheet visible={Boolean(remove)} onClose={()=>{if(!mutation.isPending)setRemove(null);}} title={ar?'إزالة الموظف؟':'Remove staff member?'}>
      <View style={{gap:spacing.md}}><AppText>{ar?'سيُلغى وصول الموظف لهذه المؤسسة فقط، وسيبقى حسابه ومعلوماته الأخرى كما هي.':'This removes access to this organization only. The account and its other assignments remain intact.'}</AppText>
        <AppButton label={ar?'تأكيد الإزالة':'Confirm removal'} variant="danger" loading={mutation.isPending} disabled={mutation.isPending} onPress={()=>remove&&mutation.mutate({type:'remove',member:remove})}/>
      </View>
    </BottomSheet>
  </View>;
}

/** Member-card pattern adapted from PR #4's OperatorEditor. */
function MemberRow({member,busy,onSave,onRemove}:{member:StaffMember;busy:boolean;onSave:(analytics:boolean,availability:boolean)=>void;onRemove:()=>void}){
  const {locale,row}=useLocale();const ar=locale==='ar';
  const [analytics,setAnalytics]=useState(member.canViewAnalytics);const [availability,setAvailability]=useState(member.canUpdateAvailability);
  useEffect(()=>{setAnalytics(member.canViewAnalytics);setAvailability(member.canUpdateAvailability);},[member.canViewAnalytics,member.canUpdateAvailability]);
  return <Card padding="lg" tone="sunken" style={{gap:spacing.md}}>
    <AppText variant="title">{member.user.fullName||member.user.email||member.userId}</AppText>
    <AppText variant="caption" color="textSecondary">{member.user.email} · {member.user.status==='SUSPENDED'?(ar?'حساب موقوف':'Suspended account'):(ar?'موظف':'Staff')}</AppText>
    <SwitchRow label={ar?'عرض التحليلات':'View analytics'} value={analytics} onValueChange={setAnalytics} disabled={busy}/>
    <SwitchRow label={ar?'تحديث التوفر':'Update availability'} value={availability} onValueChange={setAvailability} disabled={busy}/>
    <View style={{flexDirection:row,flexWrap:'wrap',gap:spacing.md}}>
      <AppButton label={ar?'حفظ الصلاحيات':'Save permissions'} size="sm" variant="secondary" fullWidth={false} disabled={busy||(analytics===member.canViewAnalytics&&availability===member.canUpdateAvailability)} onPress={()=>onSave(analytics,availability)}/>
      <AppButton label={ar?'إزالة العضوية':'Remove member'} size="sm" variant="danger" fullWidth={false} disabled={busy} onPress={onRemove}/>
    </View>
  </Card>;
}
