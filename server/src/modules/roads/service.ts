import { observe, type Observation } from './live';
import { reward } from './rewards';
import { db,atomic,lock } from '../../database/client';
import type { Availability, CheckpointStatus } from '@prisma/client';
import { assert,requireValue } from '../../utils/errors';
import { event } from '../../realtime/outbox';
import { settlePoints } from '../trust/rewards';
import { checkpointPassages } from './passages';
export { checkpoints } from './live';
/** Keep the existing service entry point; old callers must now supply reviewed observation evidence. */
export async function reportRoad(userId:string,checkpointId:string,status:CheckpointStatus,input?:Observation){
 assert(input,'VALIDATION','Select entrance or exit, observation time and an explicit location choice');
 return observe(userId,checkpointId,{...input,status});
}

export async function feed(limit=25){return (await db.checkpointReport.findMany({where:{hidden:false,directionId:{in:checkpointPassages.map(p=>p.id)},checkpoint:{active:true},OR:[{parentId:null},{parent:{hidden:false}}]},take:limit,orderBy:{reportedAt:'desc'},include:{checkpoint:true}})).map(r=>({id:r.id,checkpointId:r.checkpointId,status:r.status,directionId:r.directionId,observedAt:r.observedAt,reportedAt:r.reportedAt,checkpointNameAr:r.checkpoint.nameAr,checkpointNameEn:r.checkpoint.nameEn}));}
export async function reportZone(userId:string,zoneId:string,availability:Availability){return atomic(async tx=>{await lock(tx,`report:${userId}:${zoneId}`);requireValue(await tx.parkingZone.findFirst({where:{id:zoneId,active:true}}));
 assert(!await tx.parkingReport.findFirst({where:{userId,zoneId,reportedAt:{gt:new Date(Date.now()-60000)}}}),'REPORT_COOLDOWN','Wait a minute before reporting this place again',429);
 const report=await tx.parkingReport.create({data:{userId,zoneId,availability}});const points=await reward(tx,userId,zoneId,report.id,'zone_report');await event(tx,'parking.availability.updated',{zoneId});return {report,points};});}
export async function zoneReports(zoneId:string){return db.parkingReport.findMany({where:{zoneId,reportedAt:{gte:new Date(Date.now()-7200000)}},orderBy:{reportedAt:'desc'},take:100});}
export async function verifyPoints(now=new Date()){const pending=await db.pointsEntry.findMany({where:{state:'pending',createdAt:{lte:new Date(now.getTime()-900000)}},take:500});for(const entry of pending){await atomic(async tx=>{const end=new Date(entry.createdAt.getTime()+900000);let conflicting=false;
 if(entry.roadReportId){const original=await tx.checkpointReport.findUniqueOrThrow({where:{id:entry.roadReportId}});conflicting=original.hidden||!!await tx.checkpointReport.findFirst({where:{checkpointId:entry.placeId,directionId:original.directionId,userId:{not:entry.userId},hidden:false,status:{not:original.status},reportedAt:{gt:entry.createdAt,lte:end}}});}
 else if(entry.parkingReportId){const original=await tx.parkingReport.findUniqueOrThrow({where:{id:entry.parkingReportId}});conflicting=!!await tx.parkingReport.findFirst({where:{zoneId:entry.placeId,userId:{not:entry.userId},availability:{not:original.availability},reportedAt:{gt:entry.createdAt,lte:end}}});}
 // A map incident stands unless other drivers said it was not there.
 else if(entry.incidentReportId){const original=await tx.roadReport.findUniqueOrThrow({where:{id:entry.incidentReportId}});conflicting=original.status==='disputed'||original.status==='resolved'||original.rejectionCount>original.confirmationCount;}
 await settlePoints(tx,entry,!conflicting,now);});}}
