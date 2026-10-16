import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { db } from '../src/database/client';
import { redis } from '../src/database/redis';
import * as auth from '../src/modules/auth/service';
import { emailProvider } from '../src/providers/email';

const app=createApp();
type Account=Awaited<ReturnType<typeof auth.verifyOtp>>;
let admin:Account,owner:Account,otherOwner:Account,employee:Account,driver:Account;
const headers=(a:Account)=>({Authorization:`Bearer ${a.session.accessToken}`});
async function login(email:string){const c=await auth.requestOtp({email});const code=vi.mocked(emailProvider.sendOtp).mock.calls.at(-1)![1];return auth.verifyOtp({challengeId:c.challengeId,code},{});}
const grants={canViewAnalytics:true,canUpdateAvailability:true};
const staffPath=(org='org-a')=>`/api/v1/operator/organizations/${org}/staff`;
async function add(input=grants){return request(app).post(staffPath()).set(headers(owner)).send({email:employee.user.email,...input});}
beforeEach(async()=>{
 vi.restoreAllMocks();vi.spyOn(emailProvider,'sendOtp').mockResolvedValue();
 const tables=await db.$queryRaw<{tablename:string}[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
 await db.$executeRawUnsafe('TRUNCATE '+tables.map(t=>'"'+t.tablename.replace(/"/g,'""')+'"').join(',')+' CASCADE');await redis.flushdb();
 admin=await login('admin@staff.example');owner=await login('owner@staff.example');otherOwner=await login('other@staff.example');employee=await login('staff@staff.example');driver=await login('driver@staff.example');
 for(const [account,role] of [[admin,'ADMIN'],[owner,'PARKING_OPERATOR'],[otherOwner,'PARKING_OPERATOR']] as const)await db.user.update({where:{id:account.user.id},data:{role,fullName:role}});
 for(const [id,account] of [['org-a',owner],['org-b',otherOwner]] as const)await db.parkingOperator.create({data:{id,name:id,users:{create:{userId:account.user.id}}}});
 for(const [id,operatorId] of [['zone-a','org-a'],['zone-b','org-b']])await db.parkingZone.create({data:{id,operatorId,code:id,name:id,nameAr:id,city:'Ramallah',cityAr:'رام الله',latitude:31.9,longitude:35.2,kind:'lot',capacity:20,defaultMode:'start_stop',supportedModes:['start_stop'],supportedEntryMethods:['manual']}});
});
describe('owner analytics and delegated staff',()=>{
 it('requires authentication and denies unassigned users without changing their roles',async()=>{
  for(const path of ['/operator/access','/operator/analytics','/operator/zones','/operator/organizations'])expect((await request(app).get('/api/v1'+path)).status).toBe(401);
  expect((await request(app).get('/api/v1/operator/access').set(headers(driver))).body).toEqual({hasAccess:false,canManageStaff:false,canViewAnalytics:false});
  expect((await request(app).get('/api/v1/operator/analytics').set(headers(driver))).status).toBe(403);
  expect((await request(app).get('/api/v1/operator/zones').set(headers(driver))).status).toBe(403);
 });
 it('returns actual scoped counts, null missing occupancy, and no cross-owner records',async()=>{
  const since=new Date();
  for(const [id,status] of [['one','checked_in'],['two','cancelled']] as const)await db.parkingReservation.create({data:{id,userId:driver.user.id,parkingZoneId:'zone-a',startTime:since,endTime:new Date(Date.now()+3600000),durationMinutes:60,hourlyRateSnapshot:100,estimatedTotalPriceSnapshot:100,status,publicCode:id,qrToken:id}});
  await db.parkingReservation.create({data:{id:'old',userId:driver.user.id,parkingZoneId:'zone-a',startTime:since,endTime:new Date(Date.now()+3600000),durationMinutes:60,hourlyRateSnapshot:100,estimatedTotalPriceSnapshot:100,status:'completed',publicCode:'old',qrToken:'old',createdAt:new Date(Date.now()-40*86400000)}});
  await db.availabilitySnapshot.create({data:{zoneId:'zone-a',availability:'limited',occupiedSpaces:5,source:'OPERATOR',confidence:1}});
  const result=await request(app).get('/api/v1/operator/analytics').set(headers(owner));expect(result.status).toBe(200);expect(result.body.zones).toHaveLength(1);
  expect(result.body.zones[0]).toMatchObject({zoneId:'zone-a',reservationConversion:{total:2,checkedIn:1,rate:0.5},feedQuality:{samples:1},latestObservation:{occupiedSpaces:5,occupancyPercent:25}});
  const other=await request(app).get('/api/v1/operator/analytics').set(headers(otherOwner));expect(other.body.zones[0]).toMatchObject({zoneId:'zone-b',latestObservation:null,reservationConversion:{total:0,rate:null}});
  expect((await request(app).get('/api/v1/operator/analytics').query({zoneId:'zone-b'}).set(headers(owner))).status).toBe(404);
  expect((await request(app).get('/api/v1/operator/analytics').query({days:91}).set(headers(owner))).status).toBe(400);
  expect((await request(app).get('/api/v1/operator/analytics').set(headers(admin))).body.zones).toHaveLength(2);
 });
 it('lets an owner add an existing account without changing its role or owner memberships',async()=>{
  const result=await add();expect(result.status).toBe(200);expect(result.body).toMatchObject({operatorId:'org-a',userId:employee.user.id,...grants});
  expect((await db.user.findUniqueOrThrow({where:{id:employee.user.id}})).role).toBe('USER');
  expect(await db.operatorUser.count({where:{userId:employee.user.id}})).toBe(0);
  expect(await db.auditLog.count({where:{action:'add-staff',actorUserId:owner.user.id}})).toBe(1);
  expect((await request(app).get('/api/v1/operator/organizations').set(headers(owner))).body.map((o:{id:string})=>o.id)).toEqual(['org-a']);
  expect((await add()).status).toBe(409);
 });
 it('prevents owners and staff from managing staff in another organization or promoting themselves',async()=>{
  expect((await request(app).post(staffPath('org-b')).set(headers(owner)).send({email:employee.user.email,...grants})).status).toBe(403);
  expect((await request(app).get(staffPath('org-b')).set(headers(owner))).status).toBe(403);
  expect((await request(app).post(staffPath()).set(headers(owner)).send({email:owner.user.email,...grants})).status).toBe(400);
  expect((await request(app).post(staffPath()).set(headers(owner)).send({email:driver.user.email,...grants,role:'ADMIN'})).status).toBe(400);
  await add();
  expect((await request(app).get(staffPath()).set(headers(employee))).status).toBe(403);
  expect((await request(app).post(staffPath()).set(headers(employee)).send({email:driver.user.email,...grants})).status).toBe(403);
  expect((await request(app).get('/api/v1/admin/users').set(headers(employee))).status).toBe(403);
 });
 it('enforces separate analytics and availability grants on every API request',async()=>{
  await add({canViewAnalytics:true,canUpdateAvailability:false});
  expect((await request(app).get('/api/v1/operator/access').set(headers(employee))).body).toMatchObject({hasAccess:true,canManageStaff:false,canViewAnalytics:true});
  const zones=await request(app).get('/api/v1/operator/zones').set(headers(employee));expect(zones.body).toHaveLength(1);expect(zones.body[0]).toMatchObject({id:'zone-a',canManageZone:false,canUpdateAvailability:false});
  expect((await request(app).get('/api/v1/operator/analytics').set(headers(employee))).status).toBe(200);
  expect((await request(app).post('/api/v1/operator/zones/zone-a/availability').set(headers(employee)).send({availability:'full',confidence:1})).status).toBe(404);
  expect((await request(app).patch(staffPath()+'/'+employee.user.id).set(headers(owner)).send({canViewAnalytics:false,canUpdateAvailability:true})).status).toBe(200);
  expect((await request(app).get('/api/v1/operator/analytics').set(headers(employee))).status).toBe(403);
  expect((await request(app).post('/api/v1/operator/zones/zone-a/availability').set(headers(employee)).send({availability:'full',confidence:1})).status).toBe(200);
  expect((await request(app).post('/api/v1/operator/zones/zone-b/availability').set(headers(employee)).send({availability:'full',confidence:1})).status).toBe(404);
  for(const suffix of ['', '/hours'])expect((await request(app).patch('/api/v1/admin/parking-zones/zone-a'+suffix).set(headers(employee)).send({name:'Attack'})).status).toBe(403);
  expect((await request(app).post('/api/v1/admin/parking-zones/zone-a/tariffs').set(headers(employee)).send({name:'Attack'})).status).toBe(403);
 });
 it('removes access immediately while preserving the account and unrelated assignments',async()=>{
  await add();await db.operatorStaff.create({data:{operatorId:'org-b',userId:employee.user.id,canViewAnalytics:true}});
  expect((await request(app).delete(staffPath()+'/'+employee.user.id).set(headers(otherOwner))).status).toBe(403);
  expect((await request(app).delete(staffPath()+'/'+employee.user.id).set(headers(owner))).status).toBe(200);
  const zones=await request(app).get('/api/v1/operator/zones').set(headers(employee));expect(zones.body.map((z:{id:string})=>z.id)).toEqual(['zone-b']);
  expect((await request(app).post('/api/v1/operator/zones/zone-a/availability').set(headers(employee)).send({availability:'full',confidence:1})).status).toBe(404);
  expect(await db.user.count({where:{id:employee.user.id}})).toBe(1);expect(await db.operatorUser.count()).toBe(2);
 });
 it('denies suspended users and owner membership cannot be altered through staff routes',async()=>{
  await add();
  expect((await request(app).patch(staffPath()+'/'+owner.user.id).set(headers(owner)).send(grants)).status).toBe(404);
  await db.user.update({where:{id:employee.user.id},data:{status:'SUSPENDED'}});
  expect((await request(app).get('/api/v1/operator/analytics').set(headers(employee))).status).toBe(401);
  expect(await db.operatorUser.count({where:{userId:owner.user.id}})).toBe(1);
 });
 it('does not infer numeric occupancy from availability labels or invalid counts',async()=>{
  await db.availabilitySnapshot.create({data:{zoneId:'zone-a',availability:'full',source:'OPERATOR',confidence:1}});
  let result=await request(app).get('/api/v1/operator/analytics').set(headers(owner));expect(result.body.zones[0].latestObservation.occupancyPercent).toBeNull();
  await db.availabilitySnapshot.create({data:{zoneId:'zone-a',availability:'full',occupiedSpaces:30,source:'OPERATOR',confidence:1}});
  result=await request(app).get('/api/v1/operator/analytics').set(headers(owner));expect(result.body.zones[0].latestObservation.occupancyPercent).toBeNull();
  expect((await request(app).post('/api/v1/operator/zones/zone-a/availability').set(headers(owner)).send({availability:'full',occupiedSpaces:21,confidence:1})).status).toBe(400);
 });
});
