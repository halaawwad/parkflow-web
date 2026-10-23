import { afterAll, beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app';
import { db, atomic } from '../src/database/client';
import { redis } from '../src/database/redis';
import { env } from '../src/config/env';
import * as gates from '../src/modules/gates/service';
import { toReading, type PlateReading } from '../src/modules/gates/recognition';
import * as automatic from '../src/modules/gates/automation';
import * as auth from '../src/modules/auth/service';
import { emailProvider } from '../src/providers/email';
import * as sessions from '../src/modules/sessions/service';
import { post } from '../src/modules/wallet/ledger';

const app = createApp();
const minutes = (n: number) => new Date(Date.now() - n * 60_000);
let driver: string, vehicleId: string;
const operator: gates.Staff = { userId: '', role: 'PARKING_OPERATOR' };
const officer: gates.Staff = { userId: '', role: 'ENFORCEMENT_OFFICER' };

async function person(role: 'USER' | 'PARKING_OPERATOR' | 'ENFORCEMENT_OFFICER' = 'USER') {
  const user = await db.user.create({ data: { email: `${randomUUID()}@example.com`, emailVerifiedAt: new Date(), fullName: 'Test Person', role, wallet: { create: {} } } });
  return user.id;
}

async function zone(id: string, operatorId: string, operatorType: string) {
  await db.parkingOperator.upsert({ where: { id: operatorId }, create: { id: operatorId, name: `${operatorId} operator`, type: operatorType }, update: {} });
  await db.parkingZone.create({
    data: {
      id, operatorId, code: id.toUpperCase(), name: `${id} lot`, nameAr: 'موقف', city: 'Ramallah', cityAr: 'رام الله', latitude: 31.9, longitude: 35.2,
      kind: 'lot', defaultMode: 'start_stop', supportedModes: ['start_stop', 'prepaid'], supportedEntryMethods: ['qr', 'manual', 'anpr'],
      overstayGraceMinutes: 10, overstayFee: 5000, overstayRepeatMinutes: 60, overstayMaxPerStay: 12000,
      tariffs: { create: { id: `${id}-rate`, name: 'Test', hourlyRate: 600, incrementMinutes: 15, freeMinutes: 0, minimumCharge: 100, maxStayMinutes: 600, validFrom: new Date('2020-01-01') } },
      operatingHours: { create: Array.from({ length: 7 }, (_, weekday) => ({ weekday, opensAt: '00:00', closesAt: '00:00' })) },
    },
  });
}

beforeEach(async () => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe('TRUNCATE ' + tables.map((t) => '"' + t.tablename.replace(/"/g, '""') + '"').join(',') + ' CASCADE');
  await redis.flushdb();
  await zone('city-lot', 'city', 'municipality');
  await zone('mall-lot', 'mall', 'mall');
  operator.userId = await person('PARKING_OPERATOR');
  officer.userId = await person('ENFORCEMENT_OFFICER');
  await db.operatorUser.create({ data: { operatorId: 'city', userId: operator.userId } });
  driver = await person();
  await atomic((tx) => post(tx, driver, { amount: 10000, type: 'adjustment', title: 'Test credit', titleAr: 'رصيد اختبار' }));
  const vehicle = await db.vehicle.create({ data: { plateNumber: '1234567' } });
  await db.userVehicle.create({ data: { userId: driver, vehicleId: vehicle.id } });
  vehicleId = vehicle.id;
});

const violations = () => db.violation.findMany({ where: { vehicleId }, include: { evidence: true }, orderBy: { issuedAt: 'asc' } });

describe('QR gate', () => {
  it('starts pay-as-you-go parking on entry and stops and charges it on exit', async () => {
    const pass = await gates.gatePass(driver, vehicleId);
    const entered = await gates.staffEnter(operator, { zoneId: 'city-lot', pass: pass.value });
    expect(entered).toMatchObject({ status: 'covered', plateNumber: '1234567', entrySource: 'qr' });
    const session = await db.parkingSession.findUniqueOrThrow({ where: { id: entered.sessionId! } });
    expect(session).toMatchObject({ status: 'ACTIVE', parkingMode: 'start_stop' });

    await db.parkingSession.update({ where: { id: session.id }, data: { startedAt: minutes(59) } }); // billed in 15-minute steps → 1 hour
    await gates.checkOverstays();
    expect(await violations()).toHaveLength(0);

    const left = await gates.staffExit(operator, { zoneId: 'city-lot', pass: (await gates.gatePass(driver, vehicleId)).value });
    expect(left.status).toBe('left');
    expect((await db.parkingSession.findUniqueOrThrow({ where: { id: session.id } })).status).toBe('COMPLETED');
    expect((await db.wallet.findUniqueOrThrow({ where: { userId: driver } })).balance).toBe(10000 - 600);
  });

  it('rejects expired, forged and unlinked passes', async () => {
    const expired = jwt.sign({ sub: driver, vid: vehicleId, kind: 'gate', exp: Math.floor(Date.now() / 1000) - 10 }, env.JWT_ACCESS_SECRET, { issuer: 'parkflow', audience: 'parkflow-gate' });
    await expect(gates.staffEnter(operator, { zoneId: 'city-lot', pass: `parkflow://gate/${expired}` })).rejects.toMatchObject({ code: 'INVALID_GATE_PASS' });
    const forged = jwt.sign({ sub: driver, vid: vehicleId, kind: 'gate' }, 'not-the-secret', { issuer: 'parkflow', audience: 'parkflow-gate' });
    await expect(gates.staffEnter(operator, { zoneId: 'city-lot', pass: forged })).rejects.toMatchObject({ code: 'INVALID_GATE_PASS' });
    await expect(gates.gatePass(await person(), vehicleId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('only lets an operator run the gate at their own lots', async () => {
    await expect(gates.staffEnter(operator, { zoneId: 'mall-lot', plate: '1234567' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(gates.staffEnter({ userId: driver, role: 'USER' }, { zoneId: 'city-lot', plate: '1234567' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('plate cameras and the overstay checker', () => {
  it('authenticates cameras by device key', async () => {
    const device = await gates.createDevice(operator, 'city-lot', { name: 'North gate', kind: 'camera' });
    expect((await request(app).post('/api/v1/gate/camera-events').set('X-Gate-Key', 'wrong').send({ plate: '1234567', direction: 'entry' })).status).toBe(401);
    const ok = await request(app).post('/api/v1/gate/camera-events').set('X-Gate-Key', device.key).send({ plate: '12-345-67', direction: 'entry' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ plateNumber: '1234567', entrySource: 'camera', status: 'grace' });
    const again = await request(app).post('/api/v1/gate/camera-events').set('X-Gate-Key', device.key).send({ plate: '1234567', direction: 'entry' });
    expect(again.body.id).toBe(ok.body.id);
    expect(await db.notification.count({ where: { userId: driver, type: 'gate_entry' } })).toBe(1);
  });

  it('charges unpaid stays after the grace period, once per hour, up to the cap, and stops at exit', async () => {
    const device = await gates.createDevice(operator, 'city-lot', { name: 'Gate', kind: 'camera' });
    await gates.cameraEvent(device.key, { plate: '1234567', direction: 'entry' });
    await gates.checkOverstays();
    expect(await violations()).toHaveLength(0);

    await db.parkingVisit.updateMany({ data: { enteredAt: minutes(15) } });
    await gates.checkOverstays();
    await gates.checkOverstays();
    let issued = await violations();
    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatchObject({ type: 'no_active_parking', amount: 5000, reason: 'Parked without paying' });
    expect(issued[0]!.evidence).toMatchObject({ detectionSource: 'fixed_camera', detectedPlate: '1234567' });

    await db.parkingVisit.updateMany({ data: { enteredAt: minutes(200) } });
    await gates.checkOverstays();
    issued = await violations();
    expect(issued.map((v) => v.amount)).toEqual([5000, 5000, 2000]); // capped at ₪120 for the stay

    await gates.cameraEvent(device.key, { plate: '1234567', direction: 'exit' });
    await db.parkingVisit.updateMany({ data: { enteredAt: minutes(500) } });
    await gates.checkOverstays();
    expect(await violations()).toHaveLength(3);
  });

  it('warns when prepaid time ends, then charges an overstay; extending restarts the clock', async () => {
    await gates.staffEnter(operator, { zoneId: 'city-lot', plate: '1234567' });
    const s = await sessions.start(driver, { vehicleId, zoneId: 'city-lot', mode: 'prepaid', durationMinutes: 30, entryMethod: 'qr' }, randomUUID());
    await gates.checkOverstays();
    expect(await violations()).toHaveLength(0);

    await db.parkingSession.update({ where: { id: s.id }, data: { startedAt: minutes(35), endsAt: minutes(5) } });
    await db.parkingVisit.updateMany({ data: { enteredAt: minutes(36) } });
    await gates.checkOverstays();
    expect(await db.notification.count({ where: { userId: driver, type: 'overstay_warning' } })).toBe(1);
    expect(await violations()).toHaveLength(0);

    await db.parkingSession.update({ where: { id: s.id }, data: { startedAt: minutes(45), endsAt: minutes(15) } });
    await db.parkingVisit.updateMany({ data: { enteredAt: minutes(46) } });
    await gates.checkOverstays();
    const issued = await violations();
    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatchObject({ type: 'expired_parking', reason: 'Parking time ended and the car stayed' });

    // Paying again covers the car; nothing new is issued while covered.
    await sessions.expireSessions();
    await sessions.start(driver, { vehicleId, zoneId: 'city-lot', mode: 'prepaid', durationMinutes: 60, entryMethod: 'qr' }, randomUUID());
    await gates.checkOverstays();
    expect(await violations()).toHaveLength(1);
  });

  it('labels private lots as fees and only flags unregistered plates', async () => {
    await db.operatorUser.create({ data: { operatorId: 'mall', userId: operator.userId } });
    await gates.staffEnter(operator, { zoneId: 'mall-lot', plate: '1234567' });
    const stranger = await gates.staffEnter(operator, { zoneId: 'mall-lot', plate: '7654321' });
    expect(stranger.registered).toBe(false);
    await db.parkingVisit.updateMany({ data: { enteredAt: minutes(15) } });
    await gates.checkOverstays();
    const issued = await violations();
    expect(issued).toHaveLength(1);
    expect(issued[0]!.reason).toBe('Unpaid parking fee charged by mall operator');
    expect(await db.violation.count({ where: { plateNumber: '7654321' } })).toBe(0);
    const visits = await gates.visits(operator, 'mall-lot');
    expect(visits.find((v) => v.plateNumber === '7654321')?.status).toBe('unregistered');
    expect(visits.find((v) => v.plateNumber === '1234567')).toMatchObject({ status: 'overstaying', violationCount: 1 });
  });
});

describe('SmartGate', () => {
  const latestSnapshot = () => db.availabilitySnapshot.findFirstOrThrow({ where: { zoneId: 'city-lot' }, orderBy: { recordedAt: 'desc' } });

  it('counts registered and unregistered cars alike, once per stay', async () => {
    await db.parkingZone.update({ where: { id: 'city-lot' }, data: { capacity: 20 } });
    for (let n = 0; n < 12; n++) await gates.staffEnter(operator, { zoneId: 'city-lot', plate: `900000${n}` });
    expect(await gates.occupancy(operator, 'city-lot')).toMatchObject({ inside: 12, available: 8, status: 'available' });

    expect((await gates.staffEnter(operator, { zoneId: 'city-lot', plate: '1234567' })).occupancy.inside).toBe(13);
    const stranger = await gates.staffEnter(operator, { zoneId: 'city-lot', plate: '5550001' });
    expect(stranger).toMatchObject({ registered: false, status: 'unregistered', alreadyInside: false, occupancy: { inside: 14, unregisteredInside: 13 } });
    // The camera seeing it again is the same stay.
    expect(await gates.staffEnter(operator, { zoneId: 'city-lot', plate: '5550001' })).toMatchObject({ id: stranger.id, alreadyInside: true, occupancy: { inside: 14 } });

    expect((await gates.lookup(operator, 'city-lot', '5550001')).suggested).toBe('exit');
    expect((await gates.staffExit(operator, { zoneId: 'city-lot', plate: '5550001' })).occupancy.inside).toBe(13);
    await expect(gates.staffExit(operator, { zoneId: 'city-lot', plate: '5550001' })).rejects.toMatchObject({ code: 'NOT_INSIDE' });
    expect((await gates.staffExit(operator, { zoneId: 'city-lot', plate: '1234567' })).occupancy.inside).toBe(12);

    expect(await latestSnapshot()).toMatchObject({ source: 'ANPR', availability: 'available', occupiedSpaces: 12, availableSpaces: 8 });
    expect(await db.walletTransaction.count({ where: { wallet: { userId: driver }, type: 'parking_payment' } })).toBe(0);
    const history = await gates.visits(operator, 'city-lot');
    expect(history.find((v) => v.plateNumber === '5550001')).toMatchObject({ status: 'left', registered: false });
  });

  it('shows the lot as limited and then full as it fills up', async () => {
    await db.parkingZone.update({ where: { id: 'city-lot' }, data: { capacity: 5 } });
    for (let n = 0; n < 4; n++) await gates.staffEnter(operator, { zoneId: 'city-lot', plate: `800000${n}` });
    expect((await latestSnapshot()).availability).toBe('limited');
    await gates.staffEnter(operator, { zoneId: 'city-lot', plate: '8000009' });
    expect(await gates.occupancy(operator, 'city-lot')).toMatchObject({ inside: 5, available: 0, status: 'full' });
  });

  it('starts and bills parking only for drivers who authorized it', async () => {
    await db.userVehicle.updateMany({ where: { vehicleId }, data: { autoGateParking: true } });
    const entered = await gates.staffEnter(operator, { zoneId: 'city-lot', plate: '1234567' });
    expect(entered.status).toBe('covered');
    const session = await db.parkingSession.findUniqueOrThrow({ where: { id: entered.sessionId! } });
    expect(session).toMatchObject({ userId: driver, status: 'ACTIVE', parkingMode: 'start_stop' });
    await db.parkingSession.update({ where: { id: session.id }, data: { startedAt: minutes(59) } });
    const left = await gates.staffExit(operator, { zoneId: 'city-lot', plate: '1234567' });
    expect(left.charge).toMatchObject({ sessionId: session.id, amount: 600, paymentStatus: 'paid' });
    expect((await db.wallet.findUniqueOrThrow({ where: { userId: driver } })).balance).toBe(10000 - 600);
  });

  it('keeps the ANPR session exception to consented SmartGate entries at the operator\'s own lots', async () => {
    // A lot whose app check-in methods do not include ANPR.
    await db.parkingZone.update({ where: { id: 'city-lot' }, data: { supportedEntryMethods: ['gps', 'qr'] } });
    // What POST /parking/sessions calls: the lot's entry methods still apply.
    await expect(sessions.start(driver, { vehicleId, zoneId: 'city-lot', mode: 'start_stop', entryMethod: 'anpr' }, randomUUID()))
      .rejects.toMatchObject({ code: 'INVALID_ENTRY_METHOD' });
    // No consent: the gate records the entry but starts nothing.
    const first = await gates.staffEnter(operator, { zoneId: 'city-lot', plate: '1234567' });
    expect(first.sessionId).toBeUndefined();
    await gates.staffExit(operator, { zoneId: 'city-lot', plate: '1234567' });
    // Consent given: the SmartGate entry starts parking even though the lot lists no ANPR check-in.
    await db.userVehicle.updateMany({ where: { vehicleId }, data: { autoGateParking: true } });
    const second = await gates.staffEnter(operator, { zoneId: 'city-lot', plate: '1234567' });
    expect(second.sessionId).toBeTruthy();
    await gates.staffExit(operator, { zoneId: 'city-lot', plate: '1234567' });
    // Another operator's lot cannot be driven from this account.
    await expect(gates.staffEnter(operator, { zoneId: 'mall-lot', plate: '1234567' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // A lot without pay-as-you-go never starts a session, consent or not.
    await db.parkingZone.update({ where: { id: 'city-lot' }, data: { supportedModes: ['prepaid'], defaultMode: 'prepaid' } });
    const third = await gates.staffEnter(operator, { zoneId: 'city-lot', plate: '1234567' });
    expect(third.sessionId).toBeUndefined();
    expect(await db.parkingSession.count({ where: { vehicleId } })).toBe(1);
  });

  it('offers the car inside when the exit reading is one digit off', async () => {
    await gates.staffEnter(operator, { zoneId: 'city-lot', plate: '5550001' });
    expect(await gates.lookup(operator, 'city-lot', '5550007')).toMatchObject({ inside: false, suggested: 'entry', similarInside: [{ plateNumber: '5550001' }] });
  });

  it('accepts only complete 6–8 digit readings of the car at the gate', () => {
    const plate = (digits: string | null, complete: boolean, reason: string | null = null) =>
      ({ digits, complete, reason, confidence: 0.95, weakestDigit: 0.8, agreement: 1, detectionConfidence: 0.9, alternatives: [] });
    expect(toReading({ plates: [plate('71662601', true)] })).toMatchObject({ plateNumber: '71662601', status: 'complete' });
    expect(toReading({ plates: [plate('9101990', true)] })).toMatchObject({ plateNumber: '9101990', status: 'complete' });
    // Uncertain readings are shown, never matched: cut off at the frame edge, weak digits.
    expect(toReading({ plates: [plate('360416', false, 'cut_off')] })).toMatchObject({ plateNumber: null, status: 'uncertain', reason: 'cut_off', reading: '360416' });
    expect(toReading({ plates: [plate('6204030', false, 'low_confidence')] })).toMatchObject({ plateNumber: null, reason: 'low_confidence' });
    // Even if the reader said complete, a short or long number is not a ParkFlow plate.
    expect(toReading({ plates: [plate('999803', true)] }).plateNumber).toBe('999803');
    expect(toReading({ plates: [plate('99980', true)] })).toMatchObject({ plateNumber: null, reason: 'wrong_length' });
    expect(toReading({ plates: [plate('123456789', true)] })).toMatchObject({ plateNumber: null, reason: 'wrong_length' });
    // Only the first (largest, nearest) plate counts, even if a car behind reads better.
    expect(toReading({ plates: [plate('9776730', false, 'disagreement'), plate('9824091', true)] })).toMatchObject({ plateNumber: null, status: 'uncertain' });
    expect(toReading({ plates: [] })).toMatchObject({ plateNumber: null, status: 'none' });
  });
});

describe('officer patrol', () => {
  it('gives gate-tracked cars their grace period and never double-charges them', async () => {
    await gates.staffEnter(operator, { zoneId: 'city-lot', plate: '1234567' });
    expect(await gates.patrolCheck(officer, 'city-lot', '1234567')).toMatchObject({ allowed: false, reason: 'grace', gateTracked: true });
    await expect(gates.patrolIssue(officer, 'city-lot', '1234567')).rejects.toMatchObject({ code: 'IN_GRACE_PERIOD' });
    await db.parkingVisit.updateMany({ data: { enteredAt: minutes(11) } });
    expect(await gates.patrolCheck(officer, 'city-lot', '1234567')).toMatchObject({ reason: 'unpaid', gateTracked: true });
    await expect(gates.patrolIssue(officer, 'city-lot', '1234567')).rejects.toMatchObject({ code: 'GATE_TRACKED' });
    expect(await violations()).toHaveLength(1); // the one the overstay checker issued
  });

  it('checks a plate and issues one violation for a car without valid parking', async () => {
    // Street parking with no gate: the officer is the only check.
    expect(await gates.patrolCheck(officer, 'city-lot', '1234567')).toMatchObject({ registered: true, allowed: false, reason: 'unpaid', gateTracked: false });
    const issued = await gates.patrolIssue(officer, 'city-lot', '1234567');
    expect(issued).toMatchObject({ type: 'no_active_parking', amount: 5000 });
    await expect(gates.patrolIssue(officer, 'city-lot', '1234567')).rejects.toMatchObject({ code: 'ALREADY_ISSUED' });
    await expect(gates.patrolIssue(officer, 'city-lot', '9999999')).rejects.toMatchObject({ code: 'UNREGISTERED_PLATE' });

    await sessions.start(driver, { vehicleId, zoneId: 'city-lot', mode: 'start_stop', entryMethod: 'qr' }, randomUUID());
    expect(await gates.patrolCheck(officer, 'city-lot', '1234567')).toMatchObject({ allowed: true, reason: 'paid' });
    expect((await violations())[0]!.evidence).toMatchObject({ detectionSource: 'inspector', officerId: officer.userId });
  });
});

describe('automatic SmartGate cameras', () => {
  const complete = (plate: string, confidence = 0.97): PlateReading => ({ plateNumber: plate, status: 'complete', reading: plate, confidence, candidates: [] });
  const unsure = (reading: string): PlateReading => ({ plateNumber: null, status: 'uncertain', reason: 'low_confidence', reading, confidence: 0.6, candidates: [] });
  let frameNo = 0;
  const frame = () => `frame-${++frameNo}`;
  const camera = async (direction: 'entry' | 'exit') => db.gateDevice.findUniqueOrThrow({ where: { id: (await automatic.station(operator, 'city-lot', direction)).id } });
  const feed = async (device: Awaited<ReturnType<typeof camera>>, reading: PlateReading, times: number) => {
    let last: Awaited<ReturnType<typeof automatic.decide>> | undefined;
    for (let i = 0; i < times; i++) last = await automatic.decide(device, reading, frame());
    return last!;
  };
  const inside = async () => (await gates.occupancy(operator, 'city-lot')).inside;
  // The car left the camera's view long enough for its cooldown to end.
  const outOfView = (direction: 'entry' | 'exit', plate: string) => redis.del(`gate:cool:city-lot:${direction}:${plate}`);

  beforeEach(async () => { await db.parkingZone.update({ where: { id: 'city-lot' }, data: { capacity: 20 } }); });

  it('enters a car only after two identical frames, and only once while it stays in view', async () => {
    const entry = await camera('entry');
    expect((await feed(entry, complete('5550001'), 1)).state).toBe('tracking');
    expect(await db.parkingVisit.count()).toBe(0);
    const accepted = await automatic.decide(entry, complete('5550001'), frame());
    expect(accepted).toMatchObject({ state: 'accepted', event: { outcome: 'entry', plateNumber: '5550001', frames: 2 } });
    expect(await inside()).toBe(1);
    expect((await feed(entry, complete('5550001'), 6)).state).toBe('cooldown');
    expect(await db.parkingVisit.count()).toBe(1);
    expect(await db.gateEvent.count()).toBe(1);
  });

  it('never accepts repeated, disagreeing, weak or uncertain readings, and flags them once without blocking', async () => {
    const entry = await camera('entry');
    for (let i = 0; i < 4; i++) await automatic.decide(entry, complete('5550001'), 'same-image');
    expect(await db.parkingVisit.count()).toBe(0);
    await redis.del(`gate:track:${entry.id}`);
    for (const p of ['5550001', '5550007', '5550001', '5550007']) await automatic.decide(entry, complete(p), frame());
    expect(await db.parkingVisit.count()).toBe(0);
    // Two readings one digit apart are not a match.
    await redis.del(`gate:track:${entry.id}`);
    expect((await automatic.decide(entry, complete('5550001'), frame())).state).toBe('tracking');
    expect((await automatic.decide(entry, complete('5550007'), frame())).state).toBe('tracking');
    expect(await db.parkingVisit.count()).toBe(0);
    await redis.del(`gate:track:${entry.id}`);
    await feed(entry, complete('5550001', 0.6), 3);
    expect(await db.parkingVisit.count()).toBe(0);
    await redis.del(`gate:track:${entry.id}`);
    await feed(entry, unsure('555000'), 12);
    expect(await db.gateEvent.findMany({ select: { outcome: true, reading: true } })).toEqual([{ outcome: 'review', reading: '555000' }]);
    // A car still approaching (too small) or half in view (cut off) is not flagged.
    await redis.del(`gate:review:${entry.id}`, `gate:track:${entry.id}`);
    await feed(entry, { ...unsure('6677'), reason: 'too_small' }, 8);
    await feed(entry, { ...unsure('78999'), reason: 'cut_off' }, 8);
    expect(await db.gateEvent.count()).toBe(1);
    // The next car is still processed.
    await feed(entry, complete('7770002'), 2);
    expect(await db.parkingVisit.findMany({ select: { plateNumber: true } })).toEqual([{ plateNumber: '7770002' }]);
  });

  it('exits only from the exit camera and only after a real stay', async () => {
    const [entry, exitCam] = [await camera('entry'), await camera('exit')];
    await feed(entry, complete('5550001'), 2);
    // Seen again at the entry camera later: still inside, never an exit.
    await outOfView('entry', '5550001');
    expect((await feed(entry, complete('5550001'), 2)).event).toMatchObject({ outcome: 'already_inside' });
    expect(await inside()).toBe(1);
    // At the exit camera seconds after entering: not trusted, flagged.
    expect((await feed(exitCam, complete('5550001'), 2)).event).toMatchObject({ outcome: 'too_soon', needsReview: true });
    expect(await inside()).toBe(1);
    await db.parkingVisit.updateMany({ data: { enteredAt: minutes(120) } });
    await outOfView('exit', '5550001');
    expect((await feed(exitCam, complete('5550001'), 2)).event).toMatchObject({ outcome: 'exit' });
    expect(await inside()).toBe(0);
    await outOfView('exit', '5550001');
    expect((await feed(exitCam, complete('5550001'), 2)).event).toMatchObject({ outcome: 'not_inside', needsReview: true });
    expect(await inside()).toBe(0);
    expect(await db.parkingVisit.count()).toBe(1);
  });

  it('starts and bills parking only with consent, and never charges twice', async () => {
    const [entry, exitCam] = [await camera('entry'), await camera('exit')];
    // No consent: recorded and notified, nothing billed.
    await feed(entry, complete('1234567'), 2);
    expect(await db.parkingSession.count()).toBe(0);
    expect(await db.notification.count({ where: { userId: driver, type: 'gate_entry' } })).toBe(1);
    await db.parkingVisit.updateMany({ data: { enteredAt: minutes(120) } });
    await feed(exitCam, complete('1234567'), 2);
    expect(await db.walletTransaction.count({ where: { wallet: { userId: driver }, type: 'parking_payment' } })).toBe(0);

    await db.userVehicle.updateMany({ where: { vehicleId }, data: { autoGateParking: true } });
    await outOfView('entry', '1234567'); await outOfView('exit', '1234567');
    await feed(entry, complete('1234567'), 2);
    const session = await db.parkingSession.findFirstOrThrow({ where: { vehicleId } });
    expect(session.status).toBe('ACTIVE');
    await db.parkingSession.update({ where: { id: session.id }, data: { startedAt: minutes(59) } });
    await db.parkingVisit.updateMany({ where: { exitedAt: null }, data: { enteredAt: minutes(59) } });
    // Racing exit frames from two exit cameras, then a late repeat: one exit, one charge.
    const second = await db.gateDevice.findUniqueOrThrow({ where: { id: (await gates.createDevice(operator, 'city-lot', { name: 'Exit 2', kind: 'camera', direction: 'exit' })).id } });
    await feed(exitCam, complete('1234567'), 1); await feed(second, complete('1234567'), 1);
    const raced = await Promise.all([automatic.decide(exitCam, complete('1234567'), frame()), automatic.decide(second, complete('1234567'), frame())]);
    expect(raced.filter((r) => r.state === 'accepted')).toHaveLength(1);
    await outOfView('exit', '1234567');
    await feed(exitCam, complete('1234567'), 2);
    expect((await db.parkingSession.findUniqueOrThrow({ where: { id: session.id } })).status).toBe('COMPLETED');
    expect(await db.walletTransaction.count({ where: { wallet: { userId: driver }, type: 'parking_payment' } })).toBe(1);
    expect((await db.wallet.findUniqueOrThrow({ where: { userId: driver } })).balance).toBe(10000 - 600);
    expect(await inside()).toBe(0);
  });

  describe('over HTTP', () => {
    let stub: Server;
    let replies: unknown[] = [];
    let offline = false;
    const original = env.ALPR_URL;
    beforeAll(async () => {
      stub = createServer((req, res) => {
        req.resume();
        req.on('end', () => {
          if (offline) { res.statusCode = 503; res.end(); return; }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(replies.shift() ?? { plates: [] }));
        });
      });
      await new Promise<void>((done) => stub.listen(0, '127.0.0.1', done));
      env.ALPR_URL = `http://127.0.0.1:${(stub.address() as { port: number }).port}`;
    });
    afterAll(async () => { env.ALPR_URL = original; await new Promise((done) => stub.close(done)); });
    const plate = (digits: string) => ({ plates: [{ digits, complete: true, reason: null, confidence: 0.98, weakestDigit: 0.9, agreement: 1, detectionConfidence: 0.9, alternatives: [] }] });
    const token = async (userId: string) => {
      vi.spyOn(emailProvider, 'sendOtp').mockResolvedValue();
      const { email } = await db.user.findUniqueOrThrow({ where: { id: userId } });
      const challenge = await auth.requestOtp({ email: email! });
      const code = vi.mocked(emailProvider.sendOtp).mock.calls.at(-1)![1];
      return (await auth.verifyOtp({ challengeId: challenge.challengeId, code }, {})).session.accessToken;
    };
    const send = (path: string, headers: Record<string, string>, n: number) =>
      request(app).post(path).set(headers).attach('image', Buffer.from(`frame ${n}`), { filename: 'f.jpg', contentType: 'image/jpeg' });

    it('processes a browser camera station end to end, only for the lot owner', async () => {
      const headers = { Authorization: `Bearer ${await token(operator.userId)}` };
      const station = await request(app).post('/api/v1/gate/zones/city-lot/stations').set(headers).send({ direction: 'entry' });
      expect(station.status).toBe(200);
      replies = [plate('5550001'), plate('5550001')];
      const states = [];
      for (let n = 0; n < 2; n++) states.push((await send(`/api/v1/gate/devices/${station.body.id}/frames`, headers, n)).body.state);
      expect(states).toEqual(['tracking', 'accepted']);
      const live = await request(app).get('/api/v1/gate/zones/city-lot/live').set(headers);
      expect(live.body.cameras[0]).toMatchObject({ direction: 'entry', online: true, lastPlate: '5550001' });
      expect(live.body.events[0]).toMatchObject({ outcome: 'entry', plateNumber: '5550001' });
      // Another lot's operator and a driver can neither use nor see this camera.
      const otherOperator = await person('PARKING_OPERATOR');
      await db.operatorUser.create({ data: { operatorId: 'mall', userId: otherOperator } });
      expect((await send(`/api/v1/gate/devices/${station.body.id}/frames`, { Authorization: `Bearer ${await token(otherOperator)}` }, 9)).status).toBe(403);
      expect((await request(app).get('/api/v1/gate/zones/city-lot/live').set({ Authorization: `Bearer ${await token(driver)}` })).status).toBe(403);
    });

    it('accepts hardware frames by device key and records nothing while recognition is offline', async () => {
      const device = await gates.createDevice(operator, 'city-lot', { name: 'Barrier cam', kind: 'camera', direction: 'entry' });
      expect((await send('/api/v1/gate/camera-frames', { 'X-Gate-Key': 'wrong' }, 1)).status).toBe(401);
      offline = true;
      for (let n = 0; n < 4; n++) expect((await send('/api/v1/gate/camera-frames', { 'X-Gate-Key': device.key }, n)).status).toBe(424);
      expect(await db.gateEvent.count()).toBe(0);
      expect((await db.gateDevice.findUniqueOrThrow({ where: { id: device.id } })).lastError).toMatch(/offline/);
      offline = false;
      replies = [plate('5550002'), plate('5550002')];
      for (let n = 10; n < 12; n++) await send('/api/v1/gate/camera-frames', { 'X-Gate-Key': device.key }, n);
      expect(await db.parkingVisit.findMany({ select: { plateNumber: true, entrySource: true } })).toEqual([{ plateNumber: '5550002', entrySource: 'camera' }]);
      // A camera without a direction is not an automatic camera.
      const plain = await gates.createDevice(operator, 'city-lot', { name: 'Old cam', kind: 'camera' });
      expect((await send('/api/v1/gate/camera-frames', { 'X-Gate-Key': plain.key }, 20)).status).toBe(409);
    });
  });
});
