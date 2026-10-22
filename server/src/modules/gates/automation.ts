import { createHash, randomBytes } from 'node:crypto';
import type { GateDevice, GateEvent } from '@prisma/client';
import { logger } from '../../config/logger';
import { db } from '../../database/client';
import { redis } from '../../database/redis';
import { ApiError, assert, requireValue } from '../../utils/errors';
import { readPlate, type PlateReading } from './recognition';
import { enter, exit, hashKey, zoneFor, type Staff } from './service';

/**
 * Unattended SmartGate cameras. Each camera is either an entry or an exit camera,
 * sends frames continuously, and the server decides — no operator in the loop:
 *
 * - A plate is accepted only when several distinct frames agree on the same
 *   complete reading. One frame is never enough, a repeated image counts once,
 *   and a reading the frames disagree on is never accepted.
 * - An entry camera only records entries and an exit camera only exits. Seeing a
 *   plate again never turns into an exit.
 * - Duplicates are stopped three times over: a per-plate cooldown that keeps
 *   running while the car stays in view, the persistent open-visit checks in
 *   enter()/exit(), and their idempotent session start/stop keys.
 * - Readings that never become certain are flagged once for later review; the
 *   camera keeps scanning for the next car.
 */

export const AUTO = {
  /** Frames older than this no longer count toward agreement. */
  windowMs: 8_000,
  windowFrames: 8,
  /** Distinct frames that must agree on the same complete plate. */
  acceptFrames: 3,
  /** Mean reader confidence of those frames (each frame already passed the reader's own per-digit checks). */
  minConfidence: 0.85,
  /** One event per plate and direction while the car stays in view (refreshed on every sighting). */
  cooldownMs: 90_000,
  /** An exit this soon after the entry is not trusted. */
  minDwellMs: 60_000,
  /** Frames with a plate in view but no accepted reading before it is flagged for review. */
  reviewFrames: 6,
  reviewCooldownMs: 30_000,
  /** A camera that sent no frame for this long shows as offline. */
  onlineMs: 15_000,
} as const;

export type Direction = 'entry' | 'exit';
export type Outcome = 'entry' | 'exit' | 'already_inside' | 'not_inside' | 'too_soon' | 'review' | 'error';
/** Outcomes the owner may want to look at; none of them changed occupancy or billing. */
const ATTENTION: Outcome[] = ['not_inside', 'too_soon', 'review', 'error'];

interface Frame { hash: string; at: number; plate: string | null; reading: string | null; confidence: number; reason: string | null }

const trackKey = (deviceId: string) => `gate:track:${deviceId}`;
const busyKey = (deviceId: string) => `gate:busy:${deviceId}`;
const coolKey = (zoneId: string, direction: string, plate: string) => `gate:cool:${zoneId}:${direction}:${plate}`;
const reviewKey = (deviceId: string) => `gate:review:${deviceId}`;

async function loadTrack(deviceId: string): Promise<Frame[]> {
  try { return JSON.parse((await redis.get(trackKey(deviceId))) ?? '[]') as Frame[]; } catch { return []; }
}
const saveTrack = (deviceId: string, frames: Frame[]) => redis.set(trackKey(deviceId), JSON.stringify(frames), 'PX', AUTO.windowMs * 2);

function eventView(e: GateEvent & { device?: { name: string } | null }) {
  return {
    id: e.id, direction: e.direction as Direction, plateNumber: e.plateNumber ?? undefined, reading: e.reading ?? undefined,
    outcome: e.outcome as Outcome, confidence: e.confidence ?? undefined, frames: e.frames, message: e.message ?? undefined,
    deviceName: e.device?.name, needsReview: ATTENTION.includes(e.outcome as Outcome) && !e.reviewedAt,
    reviewedAt: e.reviewedAt?.toISOString(), createdAt: e.createdAt.toISOString(),
  };
}
export type GateEventView = ReturnType<typeof eventView>;

/* ── Applying an accepted plate ───────────────────────────────────────── */

async function apply(device: GateDevice, direction: Direction, plate: string, frames: number, confidence: number) {
  const now = new Date();
  let outcome: Outcome;
  let visitId: string | undefined;
  let message: string | undefined;
  try {
    if (direction === 'entry') {
      const result = await enter({ zoneId: device.parkingZoneId, plate, source: 'camera', deviceId: device.id, at: now });
      outcome = result.alreadyInside ? 'already_inside' : 'entry';
      visitId = result.id;
    } else {
      const open = await db.parkingVisit.findFirst({ where: { plateNumber: plate, parkingZoneId: device.parkingZoneId, exitedAt: null } });
      if (!open) outcome = 'not_inside';
      else if (now.getTime() - open.enteredAt.getTime() < AUTO.minDwellMs) { outcome = 'too_soon'; visitId = open.id; }
      else {
        const result = await exit({ zoneId: device.parkingZoneId, plate, source: 'camera', deviceId: device.id, at: now });
        outcome = 'exit';
        visitId = result.id;
      }
    }
  } catch (e) {
    // Another camera or a retry closed the visit first: nothing to do, nothing was changed twice.
    if (e instanceof ApiError && e.code === 'NOT_INSIDE') outcome = 'not_inside';
    else {
      outcome = 'error';
      message = e instanceof ApiError ? e.message : 'Processing failed';
      logger.error({ err: e, deviceId: device.id }, 'SmartGate could not apply an accepted plate');
      // Let a later sighting try again.
      await redis.del(coolKey(device.parkingZoneId, direction, plate));
    }
  }
  const event = await db.gateEvent.create({
    data: { parkingZoneId: device.parkingZoneId, deviceId: device.id, direction, plateNumber: plate, outcome, confidence, frames, visitId, message },
    include: { device: { select: { name: true } } },
  });
  return eventView(event);
}

/* ── The per-frame decision ──────────────────────────────────────────── */

export type FrameState = 'idle' | 'tracking' | 'accepted' | 'cooldown' | 'review' | 'repeated_frame' | 'busy';

/** What a camera is told after each frame, for its live status. */
export interface FrameResult {
  state: FrameState;
  /** Agreeing frames so far, and how many are needed. */
  votes: number;
  needed: number;
  plateNumber?: string | null;
  reading?: string;
  reason?: string;
  /** The plate the agreeing frames point to, while not yet accepted. */
  leading?: string;
  event?: GateEventView;
}

/**
 * Adds one reading to the camera's recent frames and decides. Exported so tests can
 * feed readings directly; frames from cameras arrive through processFrame().
 */
export async function decide(device: GateDevice, reading: PlateReading, frameHash: string, now = Date.now()): Promise<FrameResult> {
  const direction = device.direction as Direction;
  const track = (await loadTrack(device.id)).filter((f) => now - f.at <= AUTO.windowMs);
  const base = { needed: AUTO.acceptFrames, reading: reading.reading, reason: reading.reason, plateNumber: reading.plateNumber };
  // The same image sent again (a retry, a frozen camera) is not new evidence.
  if (track.some((f) => f.hash === frameHash)) return { ...base, state: 'repeated_frame' as FrameState, votes: 0 };

  track.push({ hash: frameHash, at: now, plate: reading.plateNumber, reading: reading.reading ?? null, confidence: reading.confidence, reason: reading.reason ?? null });
  const frames = track.slice(-AUTO.windowFrames);
  await db.gateDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date(now), lastError: null, ...(reading.plateNumber ? { lastPlate: reading.plateNumber } : {}) } });

  // A car still in view after its event keeps its cooldown alive, so it is processed once.
  if (reading.plateNumber && await redis.exists(coolKey(device.parkingZoneId, direction, reading.plateNumber))) {
    await redis.pexpire(coolKey(device.parkingZoneId, direction, reading.plateNumber), AUTO.cooldownMs);
    await saveTrack(device.id, frames.filter((f) => f.plate !== reading.plateNumber));
    return { ...base, state: 'cooldown' as FrameState, votes: 0 };
  }

  const groups = new Map<string, Frame[]>();
  for (const f of frames) if (f.plate) groups.set(f.plate, [...(groups.get(f.plate) ?? []), f]);
  const [plate, agreeing] = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? [null, [] as Frame[]];
  const conflicting = [...groups.values()].reduce((n, g) => n + g.length, 0) - agreeing.length;
  const confidence = agreeing.length ? agreeing.reduce((n, f) => n + f.confidence, 0) / agreeing.length : 0;

  // Enough distinct frames agree, other complete readings are clearly outvoted, and they are confident.
  if (plate && agreeing.length >= AUTO.acceptFrames && conflicting * 2 < agreeing.length && confidence >= AUTO.minConfidence) {
    await saveTrack(device.id, []); // These frames are used up either way.
    // Only one acceptance per plate and direction, however many cameras or retries race here.
    const fresh = await redis.set(coolKey(device.parkingZoneId, direction, plate), '1', 'PX', AUTO.cooldownMs, 'NX');
    if (!fresh) return { ...base, state: 'cooldown' as FrameState, votes: agreeing.length };
    const event = await apply(device, direction, plate, agreeing.length, Math.round(confidence * 100) / 100);
    return { ...base, state: 'accepted' as FrameState, votes: agreeing.length, event };
  }

  // A plate has been in view for a while without a reading certain enough: flag it once, keep scanning.
  // Too small or cut off is just a car driving into or out of view, not an unclear plate.
  const inView = frames.filter((f) => f.plate || (f.reading && f.reason !== 'too_small' && f.reason !== 'cut_off'));
  // A car that was just processed and is still in view (half turned away, say) is not a new problem.
  const justProcessed = Boolean(device.lastPlate && await redis.exists(coolKey(device.parkingZoneId, direction, device.lastPlate)));
  if (inView.length >= AUTO.reviewFrames && !justProcessed && await redis.set(reviewKey(device.id), '1', 'PX', AUTO.reviewCooldownMs, 'NX')) {
    const counts = new Map<string, number>();
    for (const f of inView) { const r = (f.plate ?? f.reading)!; counts.set(r, (counts.get(r) ?? 0) + 1); }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    const reasons = [...new Set(inView.map((f) => f.reason).filter(Boolean))].join(', ');
    const event = await db.gateEvent.create({
      data: { parkingZoneId: device.parkingZoneId, deviceId: device.id, direction, reading: best, outcome: 'review', frames: inView.length, message: reasons || 'readings disagree' },
      include: { device: { select: { name: true } } },
    });
    await saveTrack(device.id, []);
    return { ...base, state: 'review' as FrameState, votes: agreeing.length, event: eventView(event) };
  }

  await saveTrack(device.id, frames);
  return { ...base, state: (inView.length ? 'tracking' : 'idle') as FrameState, votes: agreeing.length, leading: plate ?? undefined };
}

/** One camera frame: read it, then decide. One frame per camera at a time. */
export async function processFrame(device: GateDevice, image: { buffer: Buffer; mimetype: string }): Promise<FrameResult> {
  assert(device.active && device.kind === 'camera' && (device.direction === 'entry' || device.direction === 'exit'),
    'GATE_DEVICE', 'This device is not an automatic entry or exit camera', 409);
  const token = randomBytes(8).toString('hex');
  // A second frame while one is still being read (two tabs, a retry) is dropped, not queued.
  if (!await redis.set(busyKey(device.id), token, 'PX', 20_000, 'NX')) return { state: 'busy' as FrameState, votes: 0, needed: AUTO.acceptFrames };
  try {
    let reading: PlateReading;
    try {
      reading = await readPlate(image.buffer, image.mimetype);
    } catch (e) {
      // Recognition offline or a broken image: nothing is recorded, the camera shows the problem.
      await db.gateDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date(), lastError: e instanceof ApiError ? e.message : 'Recognition failed', lastErrorAt: new Date() } });
      throw e;
    }
    return await decide(device, reading, createHash('sha256').update(image.buffer).digest('hex'));
  } finally {
    await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0", 1, busyKey(device.id), token);
  }
}

/* ── Staff and hardware entry points ─────────────────────────────────── */

/** The browser or phone running SmartGate as this lot's entry or exit camera. */
export async function station(staff: Staff, zoneId: string, direction: Direction) {
  await zoneFor(staff, zoneId);
  const name = direction === 'entry' ? 'SmartGate entry camera' : 'SmartGate exit camera';
  const existing = await db.gateDevice.findFirst({ where: { parkingZoneId: zoneId, kind: 'camera', direction, name, active: true } });
  // Browser stations authenticate with the owner's session; the key is random and never shown.
  const device = existing ?? await db.gateDevice.create({ data: { parkingZoneId: zoneId, name, kind: 'camera', direction, keyHash: hashKey(randomBytes(24).toString('base64url')) } });
  return { id: device.id, name: device.name, direction };
}

export async function staffFrame(staff: Staff, deviceId: string, image: { buffer: Buffer; mimetype: string }) {
  const device = requireValue(await db.gateDevice.findUnique({ where: { id: deviceId } }), 'Camera not found');
  await zoneFor(staff, device.parkingZoneId);
  return processFrame(device, image);
}

/** A hardware camera (or its relay script) with its device key; its direction is fixed on the device. */
export async function keyedFrame(key: string, image: { buffer: Buffer; mimetype: string }) {
  assert(key, 'UNAUTHORIZED', 'Send the gate device key in the X-Gate-Key header', 401);
  const device = await db.gateDevice.findUnique({ where: { keyHash: hashKey(key) } });
  assert(device && device.active, 'UNAUTHORIZED', 'Unknown or disabled gate device', 401);
  return processFrame(device, image);
}

/** The owner's live view: cameras, their status, and recent events. */
export async function liveView(staff: Staff, zoneId: string) {
  await zoneFor(staff, zoneId);
  const now = Date.now();
  const [devices, events] = await Promise.all([
    db.gateDevice.findMany({ where: { parkingZoneId: zoneId, kind: 'camera', direction: { not: null }, active: true }, orderBy: { createdAt: 'asc' } }),
    db.gateEvent.findMany({ where: { parkingZoneId: zoneId }, orderBy: { createdAt: 'desc' }, take: 50, include: { device: { select: { name: true } } } }),
  ]);
  return {
    cameras: devices.map((d) => ({
      id: d.id, name: d.name, direction: d.direction as Direction,
      online: Boolean(d.lastSeenAt && now - d.lastSeenAt.getTime() < AUTO.onlineMs),
      lastSeenAt: d.lastSeenAt?.toISOString(), lastPlate: d.lastPlate ?? undefined,
      lastError: d.lastError && d.lastErrorAt && now - d.lastErrorAt.getTime() < 5 * 60_000 ? d.lastError : undefined,
    })),
    events: events.map(eventView),
  };
}

export async function markReviewed(staff: Staff, eventId: string) {
  const event = requireValue(await db.gateEvent.findUnique({ where: { id: eventId } }), 'Event not found');
  await zoneFor(staff, event.parkingZoneId);
  const updated = await db.gateEvent.update({ where: { id: eventId }, data: { reviewedAt: event.reviewedAt ?? new Date() }, include: { device: { select: { name: true } } } });
  return eventView(updated);
}
