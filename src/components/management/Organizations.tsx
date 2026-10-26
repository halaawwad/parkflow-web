import { useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppButton, AppText, BottomSheet, Card, ErrorState, InlineNotice, Segmented, TextField } from '@/components/ui';
import { managementService as service } from '@/services/http/managementService';
import { useAuthStore } from '@/store/authStore';
import { useLocale } from '@/hooks/useLocale';
import { spacing } from '@/theme/spacing';
import { errorMessage } from '@/utils/errors';
import { ChoiceList } from './ChoiceList';

export function Organizations(){
  const user=useAuthStore(s=>s.user);const {locale}=useLocale();const ar=locale==='ar';const client=useQueryClient();
  const [open,setOpen]=useState(false);const [tab,setTab]=useState<'organization'|'assignment'|'zone'>('organization');
  const [operatorId,setOperatorId]=useState('');const [userId,setUserId]=useState('');const [name,setName]=useState('');
  const [type,setType]=useState('garage');const [nameAr,setNameAr]=useState('');const [code,setCode]=useState('');
  const [city,setCity]=useState('');const [cityAr,setCityAr]=useState('');const [lat,setLat]=useState('');const [lng,setLng]=useState('');const [capacity,setCapacity]=useState('');
  const [saved,setSaved]=useState(false);
  const operators=useQuery({queryKey:['management','operators',user?.id],queryFn:service.operators,enabled:open&&user?.role==='ADMIN'});
  const users=useQuery({queryKey:['admin','users','assignment',user?.id],queryFn:()=>service.users(),enabled:open&&tab==='assignment'&&user?.role==='ADMIN'});
  const mutation=useMutation({mutationFn:async()=>{
    if(tab==='organization'){
      if(!name.trim())throw new Error(ar?'أدخل اسم المؤسسة.':'Enter an organization name.');
      return service.createOperator({name:name.trim(),type});
    }
    if(!operatorId)throw new Error(ar?'اختر المؤسسة.':'Choose an organization.');
    if(tab==='assignment'){
      if(!userId)throw new Error(ar?'اختر صاحب الموقف.':'Choose a parking operator account.');
      return service.assignOperator(operatorId,userId);
    }
    const latitude=Number(lat),longitude=Number(lng),count=Number(capacity);
    if(![name,nameAr,code,city,cityAr,lat,lng,capacity].every(v=>v.trim())||!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180||!Number.isInteger(count)||count<1)throw new Error(ar?'أكمل الحقول وأدخل إحداثيات وسعة صحيحة.':'Complete all fields with valid coordinates and capacity.');
    return service.createZone({operatorId,code:code.trim(),name:name.trim(),nameAr:nameAr.trim(),city:city.trim(),cityAr:cityAr.trim(),latitude,longitude,kind:'lot',capacity:count,defaultMode:'start_stop',supportedModes:['start_stop','prepaid'],active:false,supportedEntryMethods:['manual','qr','zone_code','gps']});
  },onMutate:()=>setSaved(false),onSuccess:()=>{setSaved(true);for(const key of ['management','admin','zones'])void client.invalidateQueries({queryKey:[key]});}});
  if(user?.role!=='ADMIN')return null;
  const field=(label:string,value:string,set:(s:string)=>void)=><TextField label={label} value={value} onChangeText={set}/>;
  return <>
    <AppButton label={ar?'إدارة المؤسسات وإضافة موقف':'Organizations & new parking'} variant="secondary" onPress={()=>setOpen(true)}/>
    <BottomSheet visible={open} onClose={()=>{if(!mutation.isPending)setOpen(false);}} title={ar?'المؤسسات وأصحاب المواقف':'Organizations & parking owners'} scrollable>
      <View style={{gap:spacing.lg}}>
        <Segmented value={tab} onChange={value=>{setTab(value);mutation.reset();setSaved(false);setName('');}} options={[{value:'organization',label:ar?'مؤسسة جديدة':'New organization'},{value:'assignment',label:ar?'ربط المالك':'Assign owner'},{value:'zone',label:ar?'موقف جديد':'New parking'}]}/>
        {operators.error?<ErrorState error={operators.error} onRetry={()=>void operators.refetch()}/>:null}
        {tab!=='organization'?<>
          <AppText variant="label">{ar?'اختر المؤسسة':'Select organization'}</AppText>
          <ChoiceList items={(operators.data??[]).map(op=>({id:op.id,label:op.name}))} selectedId={operatorId} onSelect={setOperatorId} disabled={mutation.isPending}/>
          {operators.isPending?<AppText>{ar?'جارٍ التحميل…':'Loading…'}</AppText>:!operators.data?.length?<AppText>{ar?'أنشئ مؤسسة أولًا.':'Create an organization first.'}</AppText>:null}
        </>:null}
        {tab==='assignment'?<>
          <AppText variant="caption">{ar?'المؤسسة تربط المالك بكل مواقفها. غيّر دور الحساب إلى مشغّل مواقف من صفحة المستخدمين أولًا.':'An organization grants access to all its zones. Set the account role to Parking operator in Users first.'}</AppText>
          {users.error?<ErrorState error={users.error} onRetry={()=>void users.refetch()}/>:null}
          {users.isPending?<AppText>{ar?'جارٍ التحميل…':'Loading…'}</AppText>:null}
          {(users.data??[]).filter(u=>u.role==='PARKING_OPERATOR'&&u.status==='ACTIVE').map(u=><AppButton key={u.id} label={u.fullName||u.email||u.id} variant={userId===u.id?'secondary':'ghost'} onPress={()=>setUserId(u.id)} disabled={mutation.isPending}/>)}
        </>:<>
          {field(ar?'الاسم بالإنجليزية':'English name',name,setName)}
          {tab==='organization'?<Segmented value={type} onChange={setType} options={[{value:'garage',label:ar?'كراج':'Garage'},{value:'municipality',label:ar?'بلدية':'Municipality'},{value:'mall',label:ar?'مول':'Mall'},{value:'hospital',label:ar?'مستشفى':'Hospital'}]}/>:<>
            {field(ar?'الاسم بالعربية':'Arabic name',nameAr,setNameAr)}{field(ar?'رمز الموقف':'Zone code',code,setCode)}
            {field(ar?'المدينة بالإنجليزية':'City (English)',city,setCity)}{field(ar?'المدينة بالعربية':'City (Arabic)',cityAr,setCityAr)}
            {field(ar?'خط العرض':'Latitude',lat,setLat)}{field(ar?'خط الطول':'Longitude',lng,setLng)}{field(ar?'السعة':'Capacity',capacity,setCapacity)}
            <Card><AppText variant="caption">{ar?'الموقف الجديد من نوع ساحة. أضف التعرفة قبل إتاحته للحجز.':'New parking is an open lot. Configure its tariff before making it bookable.'}</AppText></Card>
          </>}
        </>}
        {mutation.error?<InlineNotice tone="danger" title={ar?'تعذر الحفظ':'Unable to save'} body={errorMessage(mutation.error)}/>:null}
        {saved?<InlineNotice tone="success" title={ar?'تم الحفظ':'Saved'}/>:null}
        <AppButton label={ar?'حفظ':'Save'} loading={mutation.isPending} disabled={mutation.isPending||saved} onPress={()=>mutation.mutate()}/>
      </View>
    </BottomSheet>
  </>;
}
