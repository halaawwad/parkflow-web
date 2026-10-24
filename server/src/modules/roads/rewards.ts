import type { Tx } from '../../database/client';
import { announcePoints } from '../trust/rewards';
export async function reward(tx:Tx,userId:string,placeId:string,refId:string,reason:'road_report'|'zone_report'){
 const last=await tx.pointsEntry.findFirst({where:{userId,placeId,createdAt:{gt:new Date(Date.now()-1800000)}}});if(last)return undefined;
 const p=await tx.pointsEntry.create({data:{userId,placeId,reason,points:5,...(reason==='road_report'?{roadReportId:refId}:{parkingReportId:refId})}});const notification=await announcePoints(tx,p);return {...p,refId,notification};
}
