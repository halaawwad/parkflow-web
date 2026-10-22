import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { ParkingVisit, ParkingZone, ParkingOperator, Role } from '@prisma/client';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { db, atomic, lock, type Tx } from '../../database/client';
import { event as publish } from '../../realtime/outbox';
import { ApiError, assert, requireValue } from '../../utils/errors';
import { notify } from '../notifications/service';
import * as sessions from '../sessions/service';
import { readPlate } from './recognition';

/**
 * Gates record when a car enters and leaves a lot — from a plate camera, a QR
 * scan at the gate, or an operator typing the plate. The overstay checker then
 * compares each car still inside against the parking it paid for.
 *
 * Any plate can enter: a car whose plate is not in ParkFlow gets a visit with no
 * vehicle, counts toward occupancy like any other, and is never charged.
 */

export type GateSource = 'camera' | 'qr' | 'manual';
export interface Staff { userId: string; role: Role }

const GATE_PASS_TTL_SECONDS = 120;
/** Paying for parking shortly before driving in still covers the visit. */
const PREPAY_WINDOW_MS = 2 * 3_600_000;
const VIOLATION_DUE_DAYS = 14;

export const normalizePlate = (plate: string) => plate.replace(/[^0-9]/g, '');
export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

/* ── Who may do what ───────────────────────────────────────────────────── */

/** Admins everywhere; operators only at their own lots; officers check any lot. */
export async function zoneFor(staff: Staff, zoneId: string, allowOfficer = false) {
  const zone = requireValue(await db.parkingZone.findUnique({ where: { id: zoneId }, include: { operator: true } }), 'Parking location not found');
  if (staff.role === 'ADMIN' || (allowOfficer && staff.role === 'ENFORCEMENT_OFFICER')) return zone;
  assert(staff.role === 'PARKING_OPERATOR', 'FORBIDDEN', 'You do not have permission', 403);
  const link = await db.operatorUser.findUnique({ where: { operatorId_userId: { operatorId: zone.operatorId, userId: staff.userId } } });
  assert(link, 'FORBIDDEN', 'This lot belongs to another operator', 403);
  return zone;
}

/* ── Driver gate pass (the QR the gate scanner reads) ───────────────────── */

/** A short-lived signed QR, so a screenshot shared with a friend stops working within minutes. */
export async function gatePass(userId: string, vehicleId: string) {
  const link = await db.userVehicle.findFirst({ where: { userId, vehicleId, unlinkedAt: null }, include: { vehicle: true } });
  assert(link, 'NOT_FOUND', 'Vehicle not found', 404);
  const token = jwt.sign({ sub: userId, vid: vehicleId, kind: 'gate' }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256', expiresIn: GATE_PASS_TTL_SECONDS, issuer: 'parkflow', audience: 'parkflow-gate',
  });
  return {
    value: `parkflow://gate/${token}`,
    plateNumber: link.vehicle.plateNumber,
    expiresAt: new Date(Date.now() + GATE_PASS_TTL_SECONDS * 1000).toISOString(),
  };
}

function readGatePass(value: string) {
  const token = value.startsWith('parkflow://gate/') ? value.slice('parkflow://gate/'.length) : value;
  try {
    const claims = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: 'parkflow', audience: 'parkflow-gate' }) as jwt.JwtPayload;
    assert(claims.kind === 'gate' && typeof claims.sub === 'string' && typeof claims.vid === 'string', 'INVALID_GATE_PASS', 'This QR code is not a ParkFlow gate pass', 400);
    return { userId: claims.sub, vehicleId: claims.vid as string };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(400, 'INVALID_GATE_PASS', 'This gate pass expired or is not valid. Ask the driver to refresh it.');
  }
}

/* ── Tracked occupancy ─────────────────────────────────────────────────── */

/** Remaining spaces at or below this share of capacity show the lot as limited. */
const LIMITED_SHARE = 0.2;

export interface Occupancy {
  capacity: number | null;
  /** Cars the gate recorded entering and not yet leaving — not a full physical count. */
  inside: number;
  registeredInside: number;
  unregisteredInside: number;
  available: number | null;
  status: 'available' | 'limited' | 'full' | 'unknown';
}

export async function occupancyOf(tx: Tx | typeof db, zone: Pick<ParkingZone, 'id' | 'capacity'>): Promise<Occupancy> {
  const inside = await tx.parkingVisit.count({ where: { parkingZoneId: zone.id, exitedAt: null } });
  const registeredInside = await tx.parkingVisit.count({ where: { parkingZoneId: zone.id, exitedAt: null, vehicleId: { not: null } } });
  const capacity = zone.capacity && zone.capacity > 0 ? zone.capacity : null;
  const available = capacity === null ? null : Math.max(0, capacity - inside);
  const status = available === null ? 'unknown' : available === 0 ? 'full' : available <= Math.max(1, Math.floor(capacity! * LIMITED_SHARE)) ? 'limited' : 'available';
  return { capacity, inside, registeredInside, unregisteredInside: inside - registeredInside, available, status };
}

/** Every entry and exit publishes the new count through the existing availability feed, so the map updates too. */
async function publishOccupancy(tx: Tx, zoneId: string) {
  await lock(tx, `occupancy:${zoneId}`);
  const zone = await tx.parkingZone.findUniqueOrThrow({ where: { id: zoneId }, select: { id: true, capacity: true } });
  const occupancy = await occupancyOf(tx, zone);
  if (occupancy.capacity === null) return;
  await tx.availabilitySnapshot.create({
    data: {
      zoneId, availability: occupancy.status, availableSpaces: occupancy.available, occupiedSpaces: Math.min(occupancy.inside, occupancy.capacity),
      // Cars that pass without being scanned are missed, so this is not a certain count.
      source: 'ANPR', confidence: 0.9,
    },
  });
  await publish(tx, 'parking.availability.updated', { zoneId });
}

/* ── Entry and exit ────────────────────────────────────────────────────── */

async function owners(tx: Tx | typeof db, vehicleId: string) {
  return (await tx.userVehicle.findMany({ where: { vehicleId, unlinkedAt: null }, select: { userId: true } })).map((l) => l.userId);
}

/** Pay-as-you-go parking for a registered car whose driver authorized SmartGate to start and bill it. */
async function autoStart(vehicleId: string, zone: ParkingZone, visitId: string) {
  if (!zone.supportedModes.includes('start_stop')) return undefined;
  const link = await db.userVehicle.findFirst({ where: { vehicleId, unlinkedAt: null, autoGateParking: true }, orderBy: [{ isDefault: 'desc' }, { linkedAt: 'asc' }] });
  if (!link || await db.parkingSession.findFirst({ where: { vehicleId, status: 'ACTIVE' } })) return undefined;
  try {
    const session = await sessions.start(link.userId, { vehicleId, zoneId: zone.id, mode: 'start_stop', entryMethod: 'anpr' }, `gate-entry:${visitId}`, { viaGate: true });
    await db.parkingVisit.update({ where: { id: visitId }, data: { sessionId: session.id } });
    return session;
  } catch (e) {
    // Closed hours, no tariff…: the entry still counts and the driver is asked to start parking instead.
    logger.warn({ err: e, visitId }, 'SmartGate could not start parking automatically');
    return undefined;
  }
}

interface GateEvent { zoneId: string; plate?: string; pass?: string; source: GateSource; deviceId?: string; at?: Date }

export async function enter(event: GateEvent) {
  const at = event.at ?? new Date();
  const pass = event.pass ? readGatePass(event.pass) : undefined;
  const vehicle = pass
    ? requireValue(await db.vehicle.findUnique({ where: { id: pass.vehicleId } }), 'Vehicle not found')
    : await db.vehicle.findUnique({ where: { plateNumber_region: { plateNumber: normalizePlate(event.plate ?? ''), region: 'PS' } } });
  const plateNumber = vehicle?.plateNumber ?? normalizePlate(event.plate ?? '');
  assert(plateNumber.length >= 4, 'VALIDATION', 'Enter a valid plate number');
  if (pass) assert((await owners(db, vehicle!.id)).includes(pass.userId), 'INVALID_GATE_PASS', 'This driver is no longer linked to that vehicle', 400);

  const zone = requireValue(await db.parkingZone.findUnique({ where: { id: event.zoneId } }), 'Parking location not found');
  const { visit, alreadyInside } = await atomic(async (tx) => {
    await lock(tx, `plate:${plateNumber}`);
    const open = await tx.parkingVisit.findFirst({ where: { plateNumber, exitedAt: null } });
    // A camera firing twice, or a second confirm, is the same entry and is not counted again.
    if (open?.parkingZoneId === zone.id) return { visit: open, alreadyInside: true };
    // A car cannot be in two lots at once — a missed exit elsewhere is closed now.
    if (open) await tx.parkingVisit.update({ where: { id: open.id }, data: { exitedAt: at > open.enteredAt ? at : open.enteredAt, exitSource: 'inferred' } });
    const created = await tx.parkingVisit.create({
      data: { parkingZoneId: zone.id, plateNumber, vehicleId: vehicle?.id, enteredAt: at, entrySource: event.source, entryDeviceId: event.deviceId },
    });
    // Both lots' counts change; locking them in a fixed order keeps two crossing cars from deadlocking.
    for (const zoneId of [zone.id, open?.parkingZoneId].filter((z): z is string => Boolean(z)).sort()) await publishOccupancy(tx, zoneId);
    return { visit: created, alreadyInside: false };
  });

  // A QR scan is the driver checking in, so it starts pay-as-you-go parking when the lot supports it.
  let session: { id: string } | undefined;
  if (pass && !visit.sessionId && zone.supportedModes.includes('start_stop') && zone.supportedEntryMethods.includes('qr')) {
    const active = await db.parkingSession.findFirst({ where: { vehicleId: pass.vehicleId, status: 'ACTIVE' } });
    session = active ?? await sessions.start(pass.userId, { vehicleId: pass.vehicleId, zoneId: zone.id, mode: 'start_stop', entryMethod: 'qr' }, `gate-entry:${visit.id}`);
    await db.parkingVisit.update({ where: { id: visit.id }, data: { sessionId: session.id } });
  } else if (vehicle && !visit.sessionId) {
    const covered = await coverage({ ...visit, vehicleId: vehicle.id }, zone, at);
    session = covered.covered ? undefined : await autoStart(vehicle.id, zone, visit.id);
    if (!covered.covered && !session) {
      await atomic(async (tx) => {
        for (const userId of await owners(tx, vehicle.id)) {
          await notify(tx, userId, 'gate_entry', `You entered ${zone.name}`, `دخلت ${zone.nameAr}`,
            `Start parking in the app within ${zone.overstayGraceMinutes} minutes to avoid a violation.`,
            `ابدأ الوقوف في التطبيق خلال ${zone.overstayGraceMinutes} دقائق لتجنب المخالفة.`,
            `/parking/start?zoneId=${zone.id}`, `gate-entry:${visit.id}:${userId}`);
        }
      });
    }
  }
  // Status is read after any session above started, so a QR check-in or authorized plate shows as covered.
  const view = await visitView(await db.parkingVisit.findUniqueOrThrow({ where: { id: visit.id } }), zone, new Date(Math.max(at.getTime(), Date.now())), session?.id);
  return { ...view, alreadyInside, occupancy: await occupancyOf(db, zone) };
}

export async function exit(event: GateEvent) {
  const at = event.at ?? new Date();
  const pass = event.pass ? readGatePass(event.pass) : undefined;
  const plateNumber = pass
    ? requireValue(await db.vehicle.findUnique({ where: { id: pass.vehicleId } }), 'Vehicle not found').plateNumber
    : normalizePlate(event.plate ?? '');
  const zone = requireValue(await db.parkingZone.findUnique({ where: { id: event.zoneId } }), 'Parking location not found');
  // Settle any overstay up to the moment of leaving before the visit closes.
  await checkOverstays(at);
  const visit = await atomic(async (tx) => {
    await lock(tx, `plate:${plateNumber}`);
    const open = await tx.parkingVisit.findFirst({ where: { plateNumber, exitedAt: null, parkingZoneId: zone.id } });
    assert(open, 'NOT_INSIDE', 'This car has no recorded entry at this lot', 404);
    const closed = await tx.parkingVisit.update({ where: { id: open.id }, data: { exitedAt: at, exitSource: event.source, exitDeviceId: event.deviceId } });
    await publishOccupancy(tx, zone.id);
    return closed;
  });
  // Leaving ends pay-as-you-go parking, so nobody pays for time after they drove out.
  let charge: { sessionId: string; amount: number; paymentStatus: string } | undefined;
  if (visit.vehicleId) {
    const vehicleId = visit.vehicleId;
    const active = await db.parkingSession.findFirst({ where: { vehicleId, parkingZoneId: zone.id, status: 'ACTIVE', parkingMode: 'start_stop' } });
    if (active) {
      const stopped = await sessions.stop(active.userId, active.id, `gate-exit:${visit.id}`);
      charge = { sessionId: stopped.id, amount: stopped.finalCost ?? stopped.currentCost, paymentStatus: stopped.paymentStatus };
    } else {
      // Stopping a session already tells its driver; everyone else linked to the car hears it left.
      await atomic(async (tx) => {
        for (const userId of await owners(tx, vehicleId)) {
          await notify(tx, userId, 'gate_exit', `You left ${zone.name}`, `غادرت ${zone.nameAr}`,
            'Your car was recorded leaving the parking.', 'تم تسجيل خروج سيارتك من الموقف.',
            `/vehicles/${vehicleId}`, `gate-exit:${visit.id}:${userId}`);
        }
      });
    }
  }
  return { ...(await visitView(visit, zone, at)), charge, occupancy: await occupancyOf(db, zone) };
}

/* ── Coverage and the overstay checker ─────────────────────────────────── */

interface Coverage { covered: boolean; until?: Date; hasSession: boolean }

/** How long a car inside has paid for: forever while pay-as-you-go runs, else the latest paid end. */
async function coverage(visit: Pick<ParkingVisit, 'vehicleId' | 'enteredAt' | 'parkingZoneId'>, zone: Pick<ParkingZone, 'id'>, now: Date): Promise<Coverage> {
  if (!visit.vehicleId) return { covered: false, until: visit.enteredAt, hasSession: false };
  const rows = await db.parkingSession.findMany({
    where: {
      vehicleId: visit.vehicleId, parkingZoneId: zone.id,
      startedAt: { gte: new Date(visit.enteredAt.getTime() - PREPAY_WINDOW_MS), lte: now },
      OR: [{ stoppedAt: null }, { stoppedAt: { gte: visit.enteredAt } }],
    },
  });
  if (rows.some((s) => s.status === 'ACTIVE' && s.parkingMode === 'start_stop')) return { covered: true, hasSession: true };
  const ends = rows.map((s) => (s.parkingMode === 'prepaid' ? s.endsAt : s.stoppedAt)).filter((d): d is Date => Boolean(d));
  const until = new Date(Math.max(visit.enteredAt.getTime(), ...ends.map((d) => d.getTime())));
  return { covered: until > now, until, hasSession: rows.length > 0 };
}

type ZoneWithOperator = ParkingZone & { operator: ParkingOperator };

/** Municipal lots issue official violations; a private lot can only charge an overstay fee. */
function wording(zone: ZoneWithOperator, hasSession: boolean) {
  const municipal = zone.operator.type === 'municipality';
  if (municipal) {
    return hasSession
      ? { reason: 'Parking time ended and the car stayed', reasonAr: 'انتهى وقت الوقوف وبقيت السيارة' }
      : { reason: 'Parked without paying', reasonAr: 'وقوف دون دفع' };
  }
  return hasSession
    ? { reason: `Overstay fee charged by ${zone.operator.name}`, reasonAr: `رسوم تجاوز الوقت من ${zone.operator.name}` }
    : { reason: `Unpaid parking fee charged by ${zone.operator.name}`, reasonAr: `رسوم وقوف غير مدفوع من ${zone.operator.name}` };
}

/**
 * For every car still inside: warn once when its paid time runs out, then after
 * the lot's grace period issue one charge per repeat period, up to the lot's cap
 * for the stay. Paying again (extending) restarts the count from the new end.
 * Cars whose plate is not in ParkFlow are only flagged to the operator.
 */
export async function checkOverstays(now = new Date()) {
  const open = await db.parkingVisit.findMany({
    where: { exitedAt: null, vehicleId: { not: null } },
    include: { zone: { include: { operator: true } } }, take: 1000,
  });
  for (const visit of open) {
    const zone = visit.zone;
    const cover = await coverage(visit, zone, now);
    if (cover.covered || !cover.until) continue;
    const graceEnds = new Date(cover.until.getTime() + zone.overstayGraceMinutes * 60_000);
    await atomic(async (tx) => {
      await lock(tx, `visit:${visit.id}`);
      const people = await owners(tx, visit.vehicleId!);
      if (now < graceEnds) {
        // Only warn about paid time that ran out — an unpaid entry was already told at the gate.
        if (cover.hasSession) {
          for (const userId of people) {
            await notify(tx, userId, 'overstay_warning', 'Your parking time ended', 'انتهى وقت الوقوف',
              `Extend or leave ${zone.name} within ${zone.overstayGraceMinutes} minutes to avoid a violation.`,
              `مدّد أو غادر ${zone.nameAr} خلال ${zone.overstayGraceMinutes} دقائق لتجنب المخالفة.`,
              '/(tabs)/map', `overstay-warning:${visit.id}:${cover.until!.getTime()}:${userId}`);
          }
        }
        return;
      }
      const due = 1 + Math.floor((now.getTime() - graceEnds.getTime()) / (zone.overstayRepeatMinutes * 60_000));
      const issued = await tx.violation.findMany({ where: { parkingVisitId: visit.id }, select: { amount: true, issuedAt: true } });
      const sinceCoverage = issued.filter((v) => v.issuedAt >= graceEnds).length;
      let total = issued.reduce((sum, v) => sum + v.amount, 0);
      const text = wording(zone, cover.hasSession);
      for (let n = sinceCoverage; n < due; n++) {
        const amount = Math.min(zone.overstayFee, zone.overstayMaxPerStay - total);
        if (amount <= 0) break;
        total += amount;
        const violation = await tx.violation.create({
          data: {
            vehicleId: visit.vehicleId!, plateNumber: visit.plateNumber,
            type: cover.hasSession ? 'expired_parking' : 'no_active_parking',
            amount, parkingZoneId: zone.id, parkingVisitId: visit.id,
            locationName: zone.name, locationNameAr: zone.nameAr, latitude: zone.latitude, longitude: zone.longitude,
            issuedAt: now, dueAt: new Date(now.getTime() + VIOLATION_DUE_DAYS * 86_400_000),
            ...text, issuingAuthority: zone.operator.name, issuingAuthorityAr: zone.operator.name,
          },
        });
        await tx.violationEvidence.create({
          data: {
            violationId: violation.id, detectedPlate: visit.plateNumber,
            detectionSource: visit.entrySource === 'camera' ? 'fixed_camera' : visit.entrySource === 'qr' ? 'gate_scan' : 'inspector',
            firstDetectionAt: visit.enteredAt, secondDetectionAt: now,
            latitude: zone.latitude, longitude: zone.longitude, deviceId: visit.entryDeviceId,
          },
        });
        for (const userId of people) {
          await notify(tx, userId, 'violation_issued', 'New parking violation', 'مخالفة وقوف جديدة',
            `${text.reason} at ${zone.name}.`, `${text.reasonAr} في ${zone.nameAr}.`, `/violations/${violation.id}`, `violation:${violation.id}:${userId}`);
        }
      }
    });
  }
}

/* ── What staff see ────────────────────────────────────────────────────── */

type VisitStatus = 'covered' | 'grace' | 'overstaying' | 'unregistered' | 'left';

async function visitView(visit: ParkingVisit, zone: ParkingZone, now: Date, sessionId?: string) {
  const cover = await coverage(visit, zone, now);
  const graceEnds = cover.until ? new Date(cover.until.getTime() + zone.overstayGraceMinutes * 60_000) : undefined;
  const status: VisitStatus = visit.exitedAt ? 'left'
    : cover.covered ? 'covered'
    : !visit.vehicleId ? 'unregistered'
    : graceEnds && now < graceEnds ? 'grace' : 'overstaying';
  const violations = await db.violation.findMany({ where: { parkingVisitId: visit.id }, select: { id: true, amount: true, issuedAt: true } });
  return {
    id: visit.id,
    plateNumber: visit.plateNumber,
    registered: Boolean(visit.vehicleId),
    enteredAt: visit.enteredAt.toISOString(),
    exitedAt: visit.exitedAt?.toISOString(),
    entrySource: visit.entrySource,
    status,
    paidUntil: cover.covered || !cover.hasSession ? undefined : cover.until?.toISOString(),
    graceEndsAt: status === 'grace' || status === 'overstaying' ? graceEnds?.toISOString() : undefined,
    sessionId: sessionId ?? visit.sessionId ?? undefined,
    violationCount: violations.length,
    violationTotal: violations.reduce((sum, v) => sum + v.amount, 0),
  };
}

export async function visits(staff: Staff, zoneId: string) {
  const zone = await zoneFor(staff, zoneId);
  await checkOverstays();
  const now = new Date();
  const rows = await db.parkingVisit.findMany({
    where: { parkingZoneId: zoneId, OR: [{ exitedAt: null }, { exitedAt: { gte: new Date(now.getTime() - 12 * 3_600_000) } }] },
    orderBy: { enteredAt: 'desc' }, take: 200,
  });
  return Promise.all(rows.map((row) => visitView(row, zone, now)));
}

export async function staffEnter(staff: Staff, input: { zoneId: string; plate?: string; pass?: string }) {
  await zoneFor(staff, input.zoneId);
  return enter({ zoneId: input.zoneId, plate: input.plate, pass: input.pass, source: input.pass ? 'qr' : 'manual' });
}

export async function staffExit(staff: Staff, input: { zoneId: string; plate?: string; pass?: string }) {
  await zoneFor(staff, input.zoneId);
  return exit({ zoneId: input.zoneId, plate: input.plate, pass: input.pass, source: input.pass ? 'qr' : 'manual' });
}

/* ── SmartGate: camera recognition and the entry-or-exit decision ─────── */

/** Plates differing by one character — an OCR slip between entry and exit. */
function oneEditApart(a: string, b: string) {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  const tail = (x: string, y: string) => x.slice(i + 1) === y.slice(i + 1) || x.slice(i + 1) === y.slice(i) || x.slice(i) === y.slice(i + 1);
  return tail(a, b);
}

/** What the operator needs before confirming: is the car known, and is it already inside this lot? */
async function lookupPlate(zone: ParkingZone, plateNumber: string) {
  const vehicle = await db.vehicle.findUnique({
    where: { plateNumber_region: { plateNumber, region: 'PS' } },
    include: { users: { where: { unlinkedAt: null }, select: { autoGateParking: true } } },
  });
  const now = new Date();
  const open = await db.parkingVisit.findFirst({ where: { plateNumber, parkingZoneId: zone.id, exitedAt: null } });
  // Only plates inside this lot are compared, so nothing about other operators' lots is revealed.
  const similarInside = open ? [] : (await db.parkingVisit.findMany({
    where: { parkingZoneId: zone.id, exitedAt: null }, select: { plateNumber: true, enteredAt: true }, take: 1000,
  })).filter((v) => oneEditApart(v.plateNumber, plateNumber)).slice(0, 3).map((v) => ({ plateNumber: v.plateNumber, enteredAt: v.enteredAt.toISOString() }));
  return {
    plateNumber,
    registered: Boolean(vehicle),
    vehicle: vehicle ? { make: vehicle.make ?? undefined, model: vehicle.model ?? undefined, color: vehicle.color ?? undefined, autoParking: vehicle.users.some((u) => u.autoGateParking) } : undefined,
    inside: Boolean(open),
    visit: open ? await visitView(open, zone, now) : undefined,
    similarInside,
    /** Only a suggestion: the operator always confirms, so a car seen again is never exited by itself. */
    suggested: open ? 'exit' as const : 'entry' as const,
    occupancy: await occupancyOf(db, zone),
  };
}

export async function lookup(staff: Staff, zoneId: string, plate: string) {
  const zone = await zoneFor(staff, zoneId);
  const plateNumber = normalizePlate(plate);
  assert(plateNumber.length >= 4, 'VALIDATION', 'Enter a valid plate number');
  return lookupPlate(zone, plateNumber);
}

/**
 * One camera frame in, the plate reading out. Only a complete reading is looked
 * up; an uncertain one comes back as digits for the operator to check, never as a
 * match. Frames are never stored.
 */
export async function recognize(staff: Staff, zoneId: string, image: { buffer: Buffer; mimetype: string }) {
  const zone = await zoneFor(staff, zoneId);
  const reading = await readPlate(image.buffer, image.mimetype);
  return { ...reading, lookup: reading.plateNumber ? await lookupPlate(zone, reading.plateNumber) : undefined };
}

export async function occupancy(staff: Staff, zoneId: string) {
  return occupancyOf(db, await zoneFor(staff, zoneId));
}

export async function rules(staff: Staff, zoneId: string, input: { overstayGraceMinutes: number; overstayFee: number; overstayRepeatMinutes: number; overstayMaxPerStay: number }) {
  await zoneFor(staff, zoneId);
  return db.parkingZone.update({ where: { id: zoneId }, data: input, select: { id: true, overstayGraceMinutes: true, overstayFee: true, overstayRepeatMinutes: true, overstayMaxPerStay: true } });
}

/** Lots this person can run a gate for, with their overstay rules. */
export async function zones(staff: Staff) {
  return db.parkingZone.findMany({
    where: staff.role === 'ADMIN' || staff.role === 'ENFORCEMENT_OFFICER' ? { active: true } : { active: true, operator: { users: { some: { userId: staff.userId } } } },
    select: { id: true, code: true, name: true, nameAr: true, city: true, cityAr: true, capacity: true, overstayGraceMinutes: true, overstayFee: true, overstayRepeatMinutes: true, overstayMaxPerStay: true, operator: { select: { name: true, type: true } } },
    orderBy: { code: 'asc' }, take: 300,
  });
}

/* ── Cameras ───────────────────────────────────────────────────────────── */

/** The key is shown once; only its hash is stored. */
export async function createDevice(staff: Staff, zoneId: string, input: { name: string; kind: 'camera' | 'qr_scanner'; direction?: 'entry' | 'exit' }) {
  await zoneFor(staff, zoneId);
  const key = `pfg_${randomBytes(24).toString('base64url')}`;
  const device = await db.gateDevice.create({ data: { parkingZoneId: zoneId, name: input.name, kind: input.kind, direction: input.direction, keyHash: hashKey(key) } });
  return { id: device.id, name: device.name, kind: device.kind, direction: device.direction ?? undefined, key };
}

/** Called by a plate camera (or its vendor's system) for every car it reads. */
export async function cameraEvent(key: string, input: { plate: string; direction: 'entry' | 'exit'; at?: string }) {
  assert(key, 'UNAUTHORIZED', 'Send the gate device key in the X-Gate-Key header', 401);
  const device = await db.gateDevice.findUnique({ where: { keyHash: hashKey(key) } });
  assert(device && device.active, 'UNAUTHORIZED', 'Unknown or disabled gate device', 401);
  await db.gateDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
  const at = input.at ? new Date(input.at) : undefined;
  assert(!at || Math.abs(at.getTime() - Date.now()) < 15 * 60_000, 'VALIDATION', 'Event time is too far from now');
  const event = { zoneId: device.parkingZoneId, plate: input.plate, source: 'camera' as const, deviceId: device.id, at };
  return input.direction === 'entry' ? enter(event) : exit(event);
}

/* ── Officer patrol ────────────────────────────────────────────────────── */

/** "Is this car allowed to be here right now?" for an officer standing next to it. */
export async function patrolCheck(staff: Staff, zoneId: string, plate: string) {
  const zone = await zoneFor(staff, zoneId, true);
  await checkOverstays();
  const plateNumber = normalizePlate(plate);
  const vehicle = await db.vehicle.findUnique({ where: { plateNumber_region: { plateNumber, region: 'PS' } } });
  const now = new Date();
  const visit = await db.parkingVisit.findFirst({ where: { plateNumber, parkingZoneId: zoneId, exitedAt: null } });
  const cover = await coverage(visit ?? { vehicleId: vehicle?.id ?? null, enteredAt: now, parkingZoneId: zoneId }, zone, now);
  const permit = vehicle ? await db.permit.findFirst({
    where: { vehicleId: vehicle.id, status: 'active', validFrom: { lte: now }, validTo: { gt: now }, zones: { some: { zoneId } } },
  }) : null;
  // The same grace the gate gives: just arrived, or paid time ended only minutes ago.
  const inGrace = !cover.covered && (Boolean(visit) || cover.hasSession) && Boolean(cover.until)
    && now.getTime() < cover.until!.getTime() + zone.overstayGraceMinutes * 60_000;
  const today = new Date(now.getTime() - 12 * 3_600_000);
  const recent = vehicle ? await db.violation.count({ where: { vehicleId: vehicle.id, parkingZoneId: zoneId, issuedAt: { gte: today } } }) : 0;
  return {
    plateNumber,
    registered: Boolean(vehicle),
    allowed: cover.covered || Boolean(permit),
    reason: permit ? 'permit' : cover.covered ? 'paid' : inGrace ? 'grace' : cover.hasSession ? 'expired' : 'unpaid',
    paidUntil: cover.covered || !cover.hasSession ? undefined : cover.until?.toISOString(),
    graceEndsAt: inGrace ? new Date(cover.until!.getTime() + zone.overstayGraceMinutes * 60_000).toISOString() : undefined,
    insideSince: visit?.enteredAt.toISOString(),
    /** Cars recorded by a gate are charged by the overstay checker, never also by hand. */
    gateTracked: Boolean(visit),
    recentViolations: recent,
    fee: zone.overstayFee,
  };
}

/** An officer's on-the-spot violation for a car with no valid parking. */
export async function patrolIssue(staff: Staff, zoneId: string, plate: string) {
  const zone = requireValue(await db.parkingZone.findUnique({ where: { id: zoneId }, include: { operator: true } }));
  const check = await patrolCheck(staff, zoneId, plate);
  assert(check.registered, 'UNREGISTERED_PLATE', 'This plate is not in ParkFlow — issue a paper ticket instead', 409);
  assert(!check.allowed, 'PARKING_VALID', 'This car has valid parking right now', 409);
  assert(check.reason !== 'grace', 'IN_GRACE_PERIOD', 'This car is still within the grace period', 409);
  assert(!check.gateTracked, 'GATE_TRACKED', 'This car is tracked by the gate and is charged automatically', 409);
  const vehicle = requireValue(await db.vehicle.findUnique({ where: { plateNumber_region: { plateNumber: check.plateNumber, region: 'PS' } } }));
  // One officer ticket per car, lot and hour — tapping twice must not double-charge.
  const duplicate = await db.violation.findFirst({ where: { vehicleId: vehicle.id, parkingZoneId: zoneId, parkingVisitId: null, issuedAt: { gte: new Date(Date.now() - 3_600_000) } } });
  assert(!duplicate, 'ALREADY_ISSUED', 'A violation was already issued for this car in the last hour', 409);
  return atomic(async (tx) => {
    const now = new Date();
    const text = wording(zone, check.reason === 'expired');
    const violation = await tx.violation.create({
      data: {
        vehicleId: vehicle.id, plateNumber: vehicle.plateNumber, type: check.reason === 'expired' ? 'expired_parking' : 'no_active_parking',
        amount: zone.overstayFee, parkingZoneId: zone.id, locationName: zone.name, locationNameAr: zone.nameAr,
        latitude: zone.latitude, longitude: zone.longitude, issuedAt: now, dueAt: new Date(now.getTime() + VIOLATION_DUE_DAYS * 86_400_000),
        ...text, issuingAuthority: zone.operator.name, issuingAuthorityAr: zone.operator.name,
      },
    });
    await tx.violationEvidence.create({
      data: { violationId: violation.id, detectedPlate: vehicle.plateNumber, detectionSource: 'inspector', firstDetectionAt: now, latitude: zone.latitude, longitude: zone.longitude, officerId: staff.userId },
    });
    await tx.auditLog.create({ data: { actorUserId: staff.userId, action: 'issue', resourceType: 'violation', resourceId: violation.id, after: { plate: vehicle.plateNumber, zoneId } } });
    for (const userId of await owners(tx, vehicle.id)) {
      await notify(tx, userId, 'violation_issued', 'New parking violation', 'مخالفة وقوف جديدة',
        `${text.reason} at ${zone.name}.`, `${text.reasonAr} في ${zone.nameAr}.`, `/violations/${violation.id}`, `violation:${violation.id}:${userId}`);
    }
    return { id: violation.id, amount: violation.amount, type: violation.type };
  });
}
