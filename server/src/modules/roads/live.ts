import { broadcastCheckpointChange } from '../../realtime/socket';
import { reward } from './rewards';
import type { CheckpointReport, RoadCheckpoint, CheckpointStatus } from '@prisma/client';
import { db, atomic, lock } from '../../database/client';
import { env } from '../../config/env';
import { event } from '../../realtime/outbox';
import { assert, requireValue } from '../../utils/errors';
import { checkpointPassages } from './passages';

export interface Direction { id: string; nameAr: string; nameEn: string }
export const freshnessMs = env.CHECKPOINT_FRESHNESS_MINUTES * 60_000;
export function directionsOf(_cp: RoadCheckpoint): Direction[] {
  return checkpointPassages;
}
function aggregate(rows: CheckpointReport[], now: number, persistentSample = false) {
  // A person contributes only their newest observation; no majority or latest-report winner.
  const people = new Map<string, CheckpointReport>();
  for (const r of [...rows].sort((a,b) => b.observedAt.getTime()-a.observedAt.getTime() || b.reportedAt.getTime()-a.reportedAt.getTime() || a.id.localeCompare(b.id))) {
    if (r.observedAt.getTime() <= now && (persistentSample || r.observedAt.getTime() + freshnessMs > now) && !people.has(r.userId)) people.set(r.userId,r);
  }
  const fresh = [...people.values()];
  const statuses = new Set(fresh.map(r=>r.status));
  const status = statuses.size > 1 ? 'conflicting' as const : fresh[0]?.status ?? 'unknown' as const;
  const confirmed = statuses.size === 1 && fresh.filter(r=>r.locationVerified).length >= 2;
  return { status, confidence: status === 'conflicting' ? 'conflicting' : !fresh.length ? 'unknown' : confirmed ? 'confirmed' : 'unconfirmed',
    reportCount: fresh.length, confirmationCount: statuses.size===1 ? Math.max(0,fresh.length-1) : 0,
    lastObservedAt: fresh[0]?.observedAt.toISOString() ?? null,
    // Only expose report IDs, never reporters or submitted positions.
    reports: fresh.map(r=>({id:r.id,isConfirmation:!!r.parentId,status:r.status,note:r.note,observedAt:r.observedAt.toISOString(),locationVerified:r.locationVerified})),
    expiresAt: fresh.length && !persistentSample ? new Date(Math.min(...fresh.map(r=>r.observedAt.getTime()+freshnessMs))).toISOString() : null };
}
export async function checkpoints() {
  const now = Date.now();
  // Only the development samples persist. Fresh driver observations take precedence.
  const sampleUser = env.NODE_ENV === 'development'
    ? await db.user.findUnique({where:{email:'checkpoint-demo@parkflow.local'},select:{id:true}})
    : null;
  const rows = await db.roadCheckpoint.findMany({where:{active:true,enabledForLiveReporting:true},include:{reports:{where:{
    hidden:false,directionId:{in:checkpointPassages.map(p=>p.id)},
    AND:[
      {OR:[{observedAt:{gt:new Date(now-freshnessMs)}},...(sampleUser?[{userId:sampleUser.id,id:{startsWith:'demo-checkpoint-'}}]:[])]},
      {OR:[{parentId:null},{parent:{hidden:false}}]},
    ],
  }}}});
  return rows.map(cp=>{
    const directions = directionsOf(cp).map(d=>{
      const reports = cp.reports.filter(r=>r.directionId===d.id && (!cp.reviewedAt || r.observedAt>=cp.reviewedAt));
      const isSample = (r:CheckpointReport) => !!sampleUser && r.userId===sampleUser.id && r.id.startsWith('demo-checkpoint-');
      const freshReports = reports.filter(r=>!isSample(r) && r.observedAt.getTime()<=now && r.observedAt.getTime()+freshnessMs>now);
      const persistentSample = !!sampleUser && !freshReports.length;
      return {...d,...aggregate(persistentSample ? reports.filter(isSample) : freshReports,now,persistentSample)};
    });
    const states = new Set(directions.map(d=>d.status));
    const status = states.size === 1 ? directions[0].status : directions.some(d=>d.status==='conflicting') ? 'conflicting' as const : 'unknown' as const;
    const confirmed = directions.length > 0 && directions.every(d=>d.confidence==='confirmed') && states.size===1;
    const observations = directions.flatMap(d=>d.lastObservedAt?[d.lastObservedAt]:[]).sort().reverse();
    return {id:cp.id,nameAr:cp.nameAr,nameEn:cp.nameEn,kind:cp.kind,sourceReferences:cp.sourceReferences,
      location:{latitude:cp.latitude,longitude:cp.longitude},enabledForLiveReporting:cp.enabledForLiveReporting,
      directions,status,assumed:!confirmed,reportCount:directions.reduce((n,d)=>n+d.reportCount,0),
      minutesSinceReport: observations.length ? Math.floor((now-Date.parse(observations[0]))/60000) : undefined,
      generatedAt:new Date(now).toISOString(),freshnessMinutes:env.CHECKPOINT_FRESHNESS_MINUTES};
  });
}
export interface Observation {
  directionId: string; status?: CheckpointStatus; observedAt: string; note?: string;
  unverified: boolean;
  location?: { latitude:number; longitude:number; accuracy:number; capturedAt:string };
}
function distance(a:{latitude:number;longitude:number},b:{latitude:number;longitude:number}) {
  const rad=(n:number)=>n*Math.PI/180;
  const h=Math.sin(rad(b.latitude-a.latitude)/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(rad(b.longitude-a.longitude)/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
export async function observe(userId:string,checkpointId:string,input:Observation,parentId?:string) {
  const result=await atomic(async tx=>{
    await lock(tx,`checkpoint:${checkpointId}`);
    await lock(tx,`checkpoint-user:${userId}`);
    const cp=requireValue(await tx.roadCheckpoint.findFirst({where:{id:checkpointId,active:true}}));
    assert(cp.enabledForLiveReporting && directionsOf(cp).some(d=>d.id===input.directionId),'VALIDATION','Reporting is disabled or entrance/exit was not selected');
    const now=Date.now(), observed=Date.parse(input.observedAt);
    assert(Number.isFinite(observed) && (!cp.reviewedAt || observed>=cp.reviewedAt.getTime()) && observed<=now && observed>now-freshnessMs,'VALIDATION','Observation must be within the freshness window and not in the future');
    assert(!await tx.checkpointReport.findFirst({where:{userId,reportedAt:{gt:new Date(now-60000)}}}),'REPORT_COOLDOWN','Wait a minute before another checkpoint observation',429);
    let status=input.status;
    if(parentId){
      const original=requireValue(await tx.checkpointReport.findFirst({where:{id:parentId,checkpointId,directionId:input.directionId,hidden:false,parentId:null}}));
      assert(original.userId!==userId,'VALIDATION','Cannot confirm your own report');
      assert(observed>=original.observedAt.getTime() && original.observedAt.getTime()+freshnessMs>now,'VALIDATION','Report expired; submit a new observation');
      assert(!await tx.checkpointReport.findUnique({where:{parentId_userId:{parentId,userId}}}),'CONFLICT','Already confirmed this report',409);
      status=original.status;
    }
    assert(status,'VALIDATION','Select a status');
    const loc=input.location;
    const locationVerified=!!loc && Date.parse(loc.capturedAt)<=now && Date.parse(loc.capturedAt)>=now-120000
      && Math.abs(Date.parse(loc.capturedAt)-observed)<=120000 && loc.accuracy<=200
      && distance(cp,loc)+loc.accuracy<=env.CHECKPOINT_RADIUS_METERS;
    assert(locationVerified || input.unverified,'LOCATION_REQUIRED','Insufficient location evidence; explicitly submit as unverified');
    const r=await tx.checkpointReport.create({data:{userId,checkpointId,directionId:input.directionId,status:status!,observedAt:new Date(observed),note:input.note,locationVerified,parentId}});
    const expiry=new Date(observed+freshnessMs);
    await tx.roadCheckpoint.update({where:{id:cp.id},data:{nextExpiryAt:!cp.nextExpiryAt || cp.nextExpiryAt<new Date(now) || cp.nextExpiryAt>expiry ? expiry : cp.nextExpiryAt}});
    const points=parentId ? undefined : await reward(tx,userId,checkpointId,r.id,'road_report');
    await event(tx,'checkpoint.updated',{checkpointId});
    return {points,event:{id:r.id,checkpointId,status:r.status,reportedAt:r.reportedAt,observedAt:r.observedAt,checkpointNameAr:cp.nameAr,checkpointNameEn:cp.nameEn,locationVerified}};
  });
  broadcastCheckpointChange(checkpointId);
  return result;
}
// Existing maintenance worker broadcasts expiry even when no users post.
export async function expireCheckpoints() {
  const now=new Date();
  const due=await db.roadCheckpoint.findMany({where:{nextExpiryAt:{lte:now}},select:{id:true}});
  for(const cp of due) {await atomic(async tx=>{
    await lock(tx,`checkpoint:${cp.id}`);
    const next=await tx.checkpointReport.findFirst({where:{checkpointId:cp.id,hidden:false,observedAt:{gt:new Date(now.getTime()-freshnessMs)}},orderBy:{observedAt:'asc'}});
    await tx.roadCheckpoint.update({where:{id:cp.id},data:{nextExpiryAt:next ? new Date(next.observedAt.getTime()+freshnessMs) : null}});
    await event(tx,'checkpoint.updated',{checkpointId:cp.id});
  });broadcastCheckpointChange(cp.id);}
}
