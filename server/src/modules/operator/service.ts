import { db, atomic, json, type Tx } from '../../database/client';
import { assert, requireValue } from '../../utils/errors';
import type { Actor } from '../admin/service';
import { event } from '../../realtime/outbox';

type Database = Tx | typeof db;
type Permission = 'view' | 'analytics' | 'availability';
type Grants = {canViewAnalytics:boolean;canUpdateAvailability:boolean};
const includeUser={select:{id:true,fullName:true,email:true,status:true}} as const;

function scope(a:Actor,permission:Permission) {
  return a.role==='ADMIN'?{}:{OR:[
    ...(a.role==='PARKING_OPERATOR'?[{operator:{users:{some:{userId:a.userId}}}}]:[]),
    {operator:{staff:{some:{userId:a.userId,...(permission==='analytics'?{canViewAnalytics:true}:permission==='availability'?{canUpdateAvailability:true}:{})}}}},
  ]};
}
async function organizationPermission(tx:Database,a:Actor,operatorId:string){
  const organization=requireValue(await tx.parkingOperator.findUnique({where:{id:operatorId}}));
  if(a.role!=='ADMIN'){
    assert(a.role==='PARKING_OPERATOR','FORBIDDEN','Owner access required',403);
    assert(await tx.operatorUser.findUnique({where:{operatorId_userId:{operatorId,userId:a.userId}}}),'FORBIDDEN','You do not own this organization',403);
  }
  return organization;
}
async function zonePermission(tx:Database,a:Actor,zoneId:string,permission:Permission){
  const zone=requireValue(await tx.parkingZone.findFirst({where:{id:zoneId,...scope(a,permission)}}));
  // Owner memberships retain existing global role checks. Staff have no owner
  // membership and receive only the two explicit permissions below.
  const owner=a.role==='ADMIN'||(a.role==='PARKING_OPERATOR'&&Boolean(await tx.operatorUser.findUnique({where:{operatorId_userId:{operatorId:zone.operatorId,userId:a.userId}}})));
  if(!owner){
    const grant=await tx.operatorStaff.findUnique({where:{operatorId_userId:{operatorId:zone.operatorId,userId:a.userId}}});
    assert(grant&&(permission==='view'||(permission==='analytics'?grant.canViewAnalytics:grant.canUpdateAvailability)),'FORBIDDEN','Staff permission required',403);
  }
  return zone;
}
async function audit(tx:Tx,a:Actor,action:string,operatorId:string,userId:string,before:unknown,after:unknown){
  await tx.auditLog.create({data:{actorUserId:a.userId,action,resourceType:'operator-staff',resourceId:`${operatorId}:${userId}`,before:before==null?undefined:json(before),after:after==null?undefined:json(after),ip:a.ip,userAgent:a.userAgent}});
}
export async function access(a:Actor){
  const [owned,grants]=await Promise.all([
    a.role==='PARKING_OPERATOR'?db.operatorUser.count({where:{userId:a.userId}}):0,
    db.operatorStaff.findMany({where:{userId:a.userId},select:{canViewAnalytics:true,canUpdateAvailability:true}}),
  ]);
  const owner=a.role==='ADMIN'||owned>0;
  return {hasAccess:owner||a.role==='PARKING_OPERATOR'||grants.length>0,canManageStaff:owner,canViewAnalytics:owner||grants.some(g=>g.canViewAnalytics)};
}
export async function organizations(a:Actor){
  assert(a.role==='ADMIN'||a.role==='PARKING_OPERATOR','FORBIDDEN','Owner access required',403);
  return db.parkingOperator.findMany({where:a.role==='ADMIN'?{}:{users:{some:{userId:a.userId}}},select:{id:true,name:true,type:true},orderBy:{name:'asc'}});
}
export async function staff(a:Actor,operatorId:string){
  await organizationPermission(db,a,operatorId);
  return db.operatorStaff.findMany({where:{operatorId},include:{user:includeUser},orderBy:{createdAt:'asc'}});
}
export async function addStaff(a:Actor,operatorId:string,input:Grants&{email:string}){
  return atomic(async tx=>{
    await organizationPermission(tx,a,operatorId);
    const target=requireValue(await tx.user.findUnique({where:{email:input.email}}),'No registered account with that email');
    assert(target.status==='ACTIVE','VALIDATION','Account must be active');
    assert(target.id!==a.userId,'VALIDATION','You cannot assign yourself as staff');
    assert(target.role==='USER'||target.role==='PARKING_OPERATOR','VALIDATION','Choose an ordinary or operator account');
    assert(!await tx.operatorUser.findUnique({where:{operatorId_userId:{operatorId,userId:target.id}}}),'VALIDATION','This account is already an owner');
    const key={operatorId_userId:{operatorId,userId:target.id}};
    const before=await tx.operatorStaff.findUnique({where:key});
    // POST adds membership only; updating an existing grant uses PATCH explicitly.
    assert(!before,'CONFLICT','Staff member already exists',409);
    const after=await tx.operatorStaff.create({data:{operatorId,userId:target.id,canViewAnalytics:input.canViewAnalytics,canUpdateAvailability:input.canUpdateAvailability},include:{user:includeUser}});
    await audit(tx,a,'add-staff',operatorId,target.id,null,after);return after;
  });
}
export async function updateStaff(a:Actor,operatorId:string,userId:string,input:Grants){
  return atomic(async tx=>{
    await organizationPermission(tx,a,operatorId);
    const where={operatorId_userId:{operatorId,userId}};
    const before=requireValue(await tx.operatorStaff.findUnique({where}));
    const after=await tx.operatorStaff.update({where,data:input,include:{user:includeUser}});
    await audit(tx,a,'update-staff',operatorId,userId,before,after);return after;
  });
}
export async function removeStaff(a:Actor,operatorId:string,userId:string){
  return atomic(async tx=>{
    await organizationPermission(tx,a,operatorId);
    const before=await tx.operatorStaff.delete({where:{operatorId_userId:{operatorId,userId}}});
    await audit(tx,a,'remove-staff',operatorId,userId,before,null);return {ok:true};
  });
}
export async function zones(a:Actor){
  const allowed=await access(a);assert(allowed.hasAccess,'FORBIDDEN','Management access required',403);
  const rows=await db.parkingZone.findMany({where:scope(a,'view'),include:{tariffs:true,operatingHours:true},orderBy:{name:'asc'},take:200});
  const owned=await db.operatorUser.findMany({where:{userId:a.userId},select:{operatorId:true}});
  const grants=await db.operatorStaff.findMany({where:{userId:a.userId}});
  return rows.map(zone=>{
    const canManageZone=a.role==='ADMIN'||(a.role==='PARKING_OPERATOR'&&owned.some(o=>o.operatorId===zone.operatorId));
    return {...zone,canManageZone,canUpdateAvailability:canManageZone||Boolean(grants.find(g=>g.operatorId===zone.operatorId)?.canUpdateAvailability)};
  }).filter(z=>z.canManageZone||grants.some(g=>g.operatorId===z.operatorId));
}
export async function availability(a:Actor,zoneId:string,input:{availability:'available'|'limited'|'full'|'unknown';confidence:number;availableSpaces?:number;occupiedSpaces?:number}){
  return atomic(async tx=>{
    const zone=await zonePermission(tx,a,zoneId,'availability');
    for(const value of [input.availableSpaces,input.occupiedSpaces])assert(value===undefined||zone.capacity===null||value<=zone.capacity,'VALIDATION','Count exceeds zone capacity');
    if(input.availableSpaces!==undefined&&input.occupiedSpaces!==undefined&&zone.capacity!==null)assert(input.availableSpaces+input.occupiedSpaces<=zone.capacity,'VALIDATION','Counts exceed capacity');
    const after=await tx.availabilitySnapshot.create({data:{zoneId,...input,source:a.role==='ADMIN'?'ADMIN':'OPERATOR'}});
    await tx.auditLog.create({data:{actorUserId:a.userId,action:'create',resourceType:'availability',resourceId:after.id,after:json(after)}});
    await event(tx,'parking.availability.updated',{zoneId});return after;
  });
}

/** Adapted from PR #4 forecasting analytics: actual observations and reservations,
 * scoped by current grants. No synthetic occupancy or inferred financial data. */
export async function analytics(a:Actor,days=30,zoneId?:string){
  if(zoneId)await zonePermission(db,a,zoneId,'analytics');
  const now=new Date(),since=new Date(now.getTime()-days*86400000);
  const allowed=await access(a);assert(allowed.canViewAnalytics,'FORBIDDEN','Analytics permission required',403);
  const rows=await db.parkingZone.findMany({where:{...scope(a,'analytics'),...(zoneId?{id:zoneId}:{})},select:{id:true,name:true,nameAr:true,capacity:true},orderBy:{name:'asc'},take:200});
  const zones=await Promise.all(rows.map(async zone=>{
    const [total,checkedIn,samples,latest,activeSessions]=await Promise.all([
      db.parkingReservation.count({where:{parkingZoneId:zone.id,createdAt:{gte:since,lte:now}}}),
      db.parkingReservation.count({where:{parkingZoneId:zone.id,createdAt:{gte:since,lte:now},status:{in:['checked_in','completed']}}}),
      db.availabilitySnapshot.count({where:{zoneId:zone.id,recordedAt:{gte:since,lte:now}}}),
      db.availabilitySnapshot.findFirst({where:{zoneId:zone.id,recordedAt:{lte:now}},orderBy:{recordedAt:'desc'}}),
      db.parkingSession.count({where:{parkingZoneId:zone.id,status:'ACTIVE'}}),
    ]);
    const capacity=zone.capacity;
    const occupied=latest?.occupiedSpaces??(capacity!=null&&latest?.availableSpaces!=null?capacity-latest.availableSpaces:null);
    const valid=capacity!=null&&capacity>0&&occupied!=null&&occupied>=0&&occupied<=capacity;
    return {zoneId:zone.id,name:zone.name,nameAr:zone.nameAr,capacity,activeSessions,reservationConversion:{total,checkedIn,rate:total?checkedIn/total:null},feedQuality:{samples},latestObservation:latest?{recordedAt:latest.recordedAt.toISOString(),source:latest.source,occupiedSpaces:valid?occupied:null,occupancyPercent:valid?Math.round(occupied!/capacity!*100):null}:null};
  }));
  return {window:{startTime:since.toISOString(),endTime:now.toISOString()},zones};
}
