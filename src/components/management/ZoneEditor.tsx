import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AppButton, AppText, BottomSheet, Card, InlineNotice, Segmented, SwitchRow, TextField } from '@/components/ui';
import { managementService } from '@/services/http/managementService';
import type { Availability, ManagementZone } from '@/types/management';
import { useAuthStore } from '@/store/authStore';
import { useLocale } from '@/hooks/useLocale';
import { spacing } from '@/theme/spacing';
import { useTheme } from '@/theme/ThemeProvider';
import { errorMessage } from '@/utils/errors';

/** Restricted to existing zone fields and APIs; no schema or login migration. */
export function ZoneEditor({zone,onClose}:{zone:ManagementZone;onClose:()=>void}) {
  const {locale,row}=useLocale(); const {colors}=useTheme(); const ar=locale==='ar';
  const user=useAuthStore(s=>s.user); const client=useQueryClient();
  const [name,setName]=useState(zone.name); const [nameAr,setNameAr]=useState(zone.nameAr);
  const [capacity,setCapacity]=useState(String(zone.capacity??'')); const [active,setActive]=useState(zone.active);
  const [availability,setAvailability]=useState<Availability>('available');
  // Do not invent opening hours when none were configured.
  const [hours,setHours]=useState(zone.operatingHours.map(h=>({...h})));
  const [rate,setRate]=useState('');
  const [increment,setIncrement]=useState('15'); const [free,setFree]=useState('0'); const [minimum,setMinimum]=useState('0'); const [notice,setNotice]=useState('');
  const mutate=useMutation({mutationFn:async(action:'details'|'availability'|'hours'|'tariff')=>{
    if(action==='details'){
      if(!name.trim()||!nameAr.trim())throw new Error(ar?'أدخل الاسم باللغتين.':'Both names are required.');
      if(capacity!==''&&(!/^\d+$/.test(capacity)||Number(capacity)<1))throw new Error(ar?'السعة عدد صحيح موجب.':'Capacity must be a positive integer.');
      return managementService.updateZone(zone.id,{name:name.trim(),nameAr:nameAr.trim(),active,...(capacity!==''?{capacity:Number(capacity)}:{})});
    }
    if(action==='availability')return managementService.updateAvailability(zone.id,availability,user?.role==='ADMIN'?'ADMIN':'OPERATOR');
    if(action==='hours')return managementService.saveHours(zone.id,hours.map(({weekday,opensAt,closesAt,closed})=>({weekday,opensAt,closesAt,closed})));
    const value=Number(rate);
    if(!rate.trim()||!Number.isFinite(value)||value<0||Math.abs(value*100-Math.round(value*100))>1e-6)throw new Error(ar?'أدخل السعر بدقة منزلتين عشريتين.':'Enter a non-negative rate with at most two decimal places.');
    // Rates are stored in minor currency units. Existing terms remain unchanged.
    const now=Date.now(); const current=zone.tariffs.filter(t=>Date.parse(t.validFrom)<=now&&(!t.validTo||Date.parse(t.validTo)>now)).sort((a,b)=>Date.parse(b.validFrom)-Date.parse(a.validFrom))[0];
    if(!current&&(!/^[0-9]+$/.test(increment)||Number(increment)<1||Number(increment)>60||!/^[0-9]+$/.test(free)||Number(free)>1440||!minimum.trim()||!Number.isFinite(Number(minimum))||Number(minimum)<0))throw new Error(ar?'تحقق من شروط التعرفة.':'Check tariff terms.');
    return managementService.saveTariff(zone.id,{name:ar?'تحديث التعرفة':'Rate update',hourlyRate:Math.round(value*100),incrementMinutes:current?.incrementMinutes??Number(increment),freeMinutes:current?.freeMinutes??Number(free),minimumCharge:current?.minimumCharge??Math.round(Number(minimum)*100),...(current?.dailyCap!=null?{dailyCap:current.dailyCap}:{}),...(current?.maxStayMinutes!=null?{maxStayMinutes:current.maxStayMinutes}:{}),validFrom:new Date().toISOString()});
  },onMutate:()=>setNotice(''),onSuccess:()=>{setNotice(ar?'تم الحفظ.':'Saved.');for(const key of ['management','admin','zones','zone'])void client.invalidateQueries({queryKey:[key]});}});
  const canManage=zone.canManageZone !== false;
  // Each section commits on its own, so its save is tonal: clear, without four equal primaries in one sheet.
  const button=(label:string,action:'details'|'availability'|'hours'|'tariff')=><AppButton variant="tonal" label={label} loading={mutate.isPending&&mutate.variables===action} disabled={mutate.isPending} onPress={()=>mutate.mutate(action)}/>;
  return <BottomSheet visible onClose={()=>{if(!mutate.isPending)onClose();}} title={ar?zone.nameAr:zone.name} scrollable>
    <View style={{gap:spacing.lg}}>
      {mutate.error?<InlineNotice tone="danger" title={ar?'تعذر الحفظ':'Unable to save'} body={errorMessage(mutate.error)}/>:null}
      {notice?<InlineNotice tone="success" title={notice}/>:null}
      {canManage ? <>
      <TextField label={ar?'الاسم بالإنجليزية':'English name'} value={name} onChangeText={setName}/>
      <TextField label={ar?'الاسم بالعربية':'Arabic name'} value={nameAr} onChangeText={setNameAr}/>
      <TextField label={ar?'السعة':'Capacity'} value={capacity} onChangeText={setCapacity} keyboardType="number-pad"/>
      <SwitchRow label={ar?'الموقف نشط':'Active zone'} value={active} onValueChange={setActive}/>
      {button(ar?'حفظ التفاصيل':'Save details','details')}
      </> : <AppText color="textSecondary">{zone.code} · {zone.capacity??'—'}</AppText>}
      {canManage || zone.canUpdateAvailability ? <Card style={{gap:spacing.md}}><AppText variant="title">{ar?'تحديث التوفر':'Update availability'}</AppText><Segmented variant="inset" value={availability} onChange={setAvailability} options={[
        {value:'available',label:ar?'متاح':'Available'},{value:'limited',label:ar?'محدود':'Limited'},{value:'full',label:ar?'ممتلئ':'Full'},{value:'unknown',label:ar?'غير معروف':'Unknown'},
      ]}/>{button(ar?'نشر التوفر':'Publish availability','availability')}</Card> : null}
      {canManage ? <>
      <Card style={{gap:spacing.md}}><AppText variant="title">{ar?'السعر بالشيكل لكل ساعة':'Hourly rate (ILS)'}</AppText>
        <TextField label={ar?'السعر الجديد':'New rate'} value={rate} onChangeText={setRate} keyboardType="decimal-pad"/>
        <AppText variant="caption">{ar?'يحافظ على شروط التعرفة الحالية، ويطبّق السعر الجديد من وقت الحفظ.':'Preserves current tariff terms; the new rate starts when saved.'}</AppText>
        {!zone.tariffs.some(t=>Date.parse(t.validFrom)<=Date.now()&&(!t.validTo||Date.parse(t.validTo)>Date.now()))?<>
          <TextField label={ar?'دقائق وحدة الاحتساب':'Billing increment (minutes)'} value={increment} onChangeText={setIncrement} keyboardType="number-pad"/>
          <TextField label={ar?'الدقائق المجانية':'Free minutes'} value={free} onChangeText={setFree} keyboardType="number-pad"/>
          <TextField label={ar?'الحد الأدنى بالشيكل':'Minimum charge (ILS)'} value={minimum} onChangeText={setMinimum} keyboardType="decimal-pad"/>
        </>:null}
        {button(ar?'حفظ التعرفة':'Save tariff','tariff')}
      </Card>
      {hours.length===7?<Card style={{gap:spacing.md}}><AppText variant="title">{ar?'ساعات العمل':'Operating hours'}</AppText>
        {hours.map((h,i)=><View key={h.weekday} style={{gap:spacing.sm}}>
          {/* Day and its Closed switch share one line; the times follow. */}
          <View style={{flexDirection:row,alignItems:'center',gap:spacing.sm,paddingTop:i===0?0:spacing.sm,borderTopWidth:i===0?0:StyleSheet.hairlineWidth*2,borderTopColor:colors.divider}}>
            <AppText variant="title" style={{flex:1}}>{(ar?['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت']:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'])[h.weekday]}</AppText>
            <AppText variant="caption" color="textSecondary">{ar?'مغلق':'Closed'}</AppText>
            <Switch
              value={h.closed}
              onValueChange={closed=>setHours(list=>list.map((x,j)=>j===i?{...x,closed}:x))}
              trackColor={{false:colors.borderStrong,true:colors.brand}}
              thumbColor={colors.surface}
              ios_backgroundColor={colors.borderStrong}
              {...({activeThumbColor:colors.surface} as object)}
              accessibilityLabel={`${(ar?['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت']:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'])[h.weekday]}: ${ar?'مغلق':'Closed'}`}
            />
          </View>
          <View style={{flexDirection:row,gap:spacing.md}}>
            <View style={{flex:1}}><TextField label={ar?'يفتح HH:mm':'Opens HH:mm'} value={h.opensAt} maxLength={5} onChangeText={opensAt=>setHours(list=>list.map((x,j)=>j===i?{...x,opensAt}:x))}/></View>
            <View style={{flex:1}}><TextField label={ar?'يغلق HH:mm':'Closes HH:mm'} value={h.closesAt} maxLength={5} onChangeText={closesAt=>setHours(list=>list.map((x,j)=>j===i?{...x,closesAt}:x))}/></View>
          </View>
        </View>)}{button(ar?'حفظ ساعات العمل':'Save hours','hours')}</Card>:<AppButton label={ar?'إعداد الأسبوع (مغلق حتى التعديل)':'Set up week (closed until edited)'} variant="secondary" onPress={()=>setHours(Array.from({length:7},(_,weekday)=>({weekday,opensAt:'00:00',closesAt:'00:00',closed:true})))}/>}
      </> : null}
    </View>
  </BottomSheet>;
}
