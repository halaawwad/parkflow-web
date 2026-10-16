import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { db } from '../src/database/client';
import { redis } from '../src/database/redis';
import * as auth from '../src/modules/auth/service';
import { emailProvider } from '../src/providers/email';

const app = createApp();
let admin: Awaited<ReturnType<typeof auth.verifyOtp>>;
let owner: typeof admin;
let outsider: typeof admin;
let driver: typeof admin;
async function login(email: string) {
  const challenge = await auth.requestOtp({email});
  const code = vi.mocked(emailProvider.sendOtp).mock.calls.at(-1)![1];
  return auth.verifyOtp({challengeId: challenge.challengeId, code}, {});
}
const headers = (account: typeof admin) => ({Authorization: `Bearer ${account.session.accessToken}`});
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.spyOn(emailProvider, 'sendOtp').mockResolvedValue();
  const tables = await db.$queryRaw<{tablename:string}[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe('TRUNCATE ' + tables.map(t => '"' + t.tablename.replace(/"/g, '""') + '"').join(',') + ' CASCADE');
  await redis.flushdb();
  admin = await login('admin@portal.example'); owner = await login('owner@portal.example');
  outsider = await login('outsider@portal.example'); driver = await login('driver@portal.example');
  for (const [account, role] of [[admin,'ADMIN'],[owner,'PARKING_OPERATOR'],[outsider,'PARKING_OPERATOR']] as const) {
    await db.user.update({where:{id:account.user.id},data:{role,fullName:role}});
  }
  await db.parkingOperator.create({data:{id:'portal-org',name:'Managed organization',users:{create:{userId:owner.user.id}}}});
  await db.parkingOperator.create({data:{id:'other-org',name:'Other organization'}});
  for(const [id,operatorId] of [['portal-zone','portal-org'],['other-zone','other-org']]) {
    await db.parkingZone.create({data:{id,operatorId,code:id,name:id,nameAr:id,city:'Ramallah',cityAr:'رام الله',latitude:31.9,longitude:35.2,kind:'lot',defaultMode:'start_stop',supportedModes:['start_stop'],supportedEntryMethods:['manual']}});
  }
});
describe('selective management portal integration', () => {
  it('requires authentication and reserves administrator data for admins', async () => {
    for(const path of ['/admin/summary','/admin/users','/admin/audit-logs','/admin/operators','/admin/appeals','/admin/road-reports']) {
      expect((await request(app).get('/api/v1'+path)).status).toBe(401);
      expect((await request(app).get('/api/v1'+path).set(headers(driver))).status).toBe(403);
      expect((await request(app).get('/api/v1'+path).set(headers(owner))).status).toBe(403);
      expect((await request(app).get('/api/v1'+path).set(headers(admin))).status).toBe(200);
    }
  });
  it('returns live totals and searches users by email without leaking auth fields', async () => {
    const totals=await request(app).get('/api/v1/admin/summary').set(headers(admin));
    expect(totals.body).toMatchObject({activeUsers:4,suspendedUsers:0,activeZones:2,visibleReports:0,openAppeals:0});
    const result=await request(app).get('/api/v1/admin/users').query({query:' OWNER@PORTAL.EXAMPLE '}).set(headers(admin));
    expect(result.status).toBe(200);expect(result.body).toHaveLength(1);
    expect(result.body[0]).toMatchObject({id:owner.user.id,email:'owner@portal.example'});
    expect(result.body[0]).not.toHaveProperty('nationalId');
    expect((await request(app).get('/api/v1/admin/users').query({query:'x'.repeat(201)}).set(headers(admin))).status).toBe(400);
  });
  it('lists only assigned zones for an owner and none for an unassigned operator', async () => {
    const own=await request(app).get('/api/v1/admin/parking-zones').set(headers(owner));
    expect(own.status).toBe(200);expect(own.body.map((z:{id:string})=>z.id)).toEqual(['portal-zone']);
    expect((await request(app).get('/api/v1/admin/parking-zones').set(headers(outsider))).body).toEqual([]);
    expect((await request(app).get('/api/v1/admin/parking-zones').set(headers(driver))).status).toBe(403);
  });
  it('enforces owner scope for every zone mutation and records allowed availability updates', async () => {
    const updates = [
      {method:'patch',suffix:'',body:{name:'Renamed parking',nameAr:'موقف جديد',capacity:20}},
      {method:'post',suffix:'/availability',body:{availability:'full',source:'OPERATOR',confidence:1}},
      {method:'patch',suffix:'/hours',body:{hours:Array.from({length:7},(_,weekday)=>({weekday,opensAt:'08:00',closesAt:'18:00',closed:false}))}},
      {method:'post',suffix:'/tariffs',body:{name:'Rate',hourlyRate:500,incrementMinutes:15,freeMinutes:0,minimumCharge:0,validFrom:new Date().toISOString()}},
    ] as const;
    for(const update of updates){
      const rejected=await request(app)[update.method]('/api/v1/admin/parking-zones/other-zone'+update.suffix).set(headers(owner)).send(update.body);
      expect(rejected.status).toBe(403);
      const allowed=await request(app)[update.method]('/api/v1/admin/parking-zones/portal-zone'+update.suffix).set(headers(owner)).send(update.body);
      expect(allowed.status,JSON.stringify(allowed.body)).toBe(200);
    }
    expect(await db.availabilitySnapshot.count({where:{zoneId:'other-zone'}})).toBe(0);
    expect(await db.availabilitySnapshot.count({where:{zoneId:'portal-zone',availability:'full'}})).toBe(1);
    const audit=await request(app).get('/api/v1/admin/audit-logs').set(headers(admin));
    expect(audit.body.length).toBeGreaterThanOrEqual(4);expect(audit.body[0].actor.email).toBe(owner.user.email);
  });
  it('keeps organization creation, owner assignment, and zone creation admin-only', async () => {
    const input={name:'New garage',type:'garage'};
    expect((await request(app).post('/api/v1/admin/operators').set(headers(owner)).send(input)).status).toBe(403);
    const org=await request(app).post('/api/v1/admin/operators').set(headers(admin)).send(input);
    expect(org.status).toBe(200);
    expect((await request(app).post(`/api/v1/admin/operators/${org.body.id}/users`).set(headers(owner)).send({userId:outsider.user.id})).status).toBe(403);
    expect((await request(app).post(`/api/v1/admin/operators/${org.body.id}/users`).set(headers(admin)).send({userId:outsider.user.id})).status).toBe(200);
    const zone={operatorId:org.body.id,code:'NEW',name:'New lot',nameAr:'موقف جديد',city:'Ramallah',cityAr:'رام الله',latitude:31.9,longitude:35.2,kind:'lot',capacity:10,active:false,defaultMode:'start_stop',supportedModes:['start_stop','prepaid'],supportedEntryMethods:['manual','qr','zone_code','gps']};
    expect((await request(app).post('/api/v1/admin/parking-zones').set(headers(owner)).send(zone)).status).toBe(403);
    const created=await request(app).post('/api/v1/admin/parking-zones').set(headers(admin)).send(zone);
    expect(created.status).toBe(200);expect(created.body.active).toBe(false);
    expect((await request(app).get('/api/v1/admin/parking-zones').set(headers(outsider))).body.map((z:{id:string})=>z.id)).toContain(created.body.id);
  });
  it('prevents self role changes and revokes access after demotion', async () => {
    expect((await request(app).patch(`/api/v1/admin/users/${admin.user.id}`).set(headers(admin)).send({role:'USER'})).status).toBe(400);
    expect((await request(app).patch(`/api/v1/admin/users/${owner.user.id}`).set(headers(admin)).send({role:'USER'})).status).toBe(200);
    expect((await request(app).get('/api/v1/admin/parking-zones').set(headers(owner))).status).toBe(401);
  });
  it('rejects decisions on paid or already closed appeals and returns review details', async () => {
    const vehicle=await db.vehicle.create({data:{plateNumber:'PORTAL-TEST'}});
    const violation=await db.violation.create({data:{vehicleId:vehicle.id,plateNumber:vehicle.plateNumber,type:'expired_parking',amount:500,status:'paid',locationName:'Lot',locationNameAr:'موقف',latitude:31.9,longitude:35.2,dueAt:new Date(Date.now()+86400000),reason:'Overstay',reasonAr:'تجاوز المدة',issuingAuthority:'Test',issuingAuthorityAr:'اختبار'}});
    const appeal=await db.appeal.create({data:{userId:driver.user.id,violationId:violation.id,reason:'other',notes:'Please review'}});
    const list=await request(app).get('/api/v1/admin/appeals').set(headers(admin));
    expect(list.body[0]).toMatchObject({id:appeal.id,user:{email:driver.user.email},violation:{plateNumber:vehicle.plateNumber,status:'paid'}});
    const path=`/api/v1/admin/appeals/${appeal.id}`;
    expect((await request(app).patch(path).set(headers(admin)).send({status:'approved',decisionNote:'Test decision'})).status).toBe(409);
    await db.violation.update({where:{id:violation.id},data:{status:'unpaid'}});
    await db.appeal.update({where:{id:appeal.id},data:{status:'approved'}});
    expect((await request(app).patch(path).set(headers(admin)).send({status:'rejected',decisionNote:'Second decision'})).status).toBe(409);
    expect((await db.violation.findUniqueOrThrow({where:{id:violation.id}})).status).toBe('unpaid');
  });

});
