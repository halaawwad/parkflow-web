import type { ID, ISODateString } from './common';

/** The short-lived QR a driver shows at a QR gate. */
export interface GatePass {
  value: string;
  plateNumber: string;
  expiresAt: ISODateString;
}

export interface OverstayRules {
  overstayGraceMinutes: number;
  /** Minor units per charge. */
  overstayFee: number;
  overstayRepeatMinutes: number;
  overstayMaxPerStay: number;
}

export interface GateZone extends OverstayRules {
  id: ID;
  code: string;
  name: string;
  nameAr: string;
  city: string;
  cityAr: string;
  capacity: number | null;
  operator: { name: string; type: string };
}

export type VisitStatus = 'covered' | 'grace' | 'overstaying' | 'unregistered' | 'left';

/** One car's stay in a lot, as the gate operator sees it. */
export interface ParkingVisit {
  id: ID;
  plateNumber: string;
  registered: boolean;
  enteredAt: ISODateString;
  exitedAt?: ISODateString;
  entrySource: 'camera' | 'qr' | 'manual';
  status: VisitStatus;
  paidUntil?: ISODateString;
  graceEndsAt?: ISODateString;
  sessionId?: ID;
  violationCount: number;
  violationTotal: number;
}

export interface PatrolCheck {
  plateNumber: string;
  registered: boolean;
  allowed: boolean;
  reason: 'permit' | 'paid' | 'grace' | 'expired' | 'unpaid';
  graceEndsAt?: ISODateString;
  paidUntil?: ISODateString;
  insideSince?: ISODateString;
  /** Recorded by a gate, so overstay charges are issued automatically. */
  gateTracked: boolean;
  recentViolations: number;
  fee: number;
}

export interface GateScan { zoneId: ID; plate?: string; pass?: string }

/** Cars the gate recorded inside a lot. Cars that passed unscanned are not counted. */
export interface GateOccupancy {
  capacity: number | null;
  inside: number;
  registeredInside: number;
  unregisteredInside: number;
  available: number | null;
  status: 'available' | 'limited' | 'full' | 'unknown';
}

/** What an entry or exit returns: the visit plus the lot's new count. */
export interface GateResult extends ParkingVisit {
  occupancy: GateOccupancy;
  /** Entry for a car already inside: nothing was counted again. */
  alreadyInside?: boolean;
  /** Exit that stopped the driver's pay-as-you-go parking. Minor units. */
  charge?: { sessionId: ID; amount: number; paymentStatus: string };
}

/** Everything the operator sees before confirming entry or exit for a plate. */
export interface GateLookup {
  plateNumber: string;
  registered: boolean;
  vehicle?: { make?: string; model?: string; color?: string; autoParking: boolean };
  inside: boolean;
  visit?: ParkingVisit;
  /** Cars inside whose plate differs by one character — likely the same car misread. */
  similarInside: { plateNumber: string; enteredAt: ISODateString }[];
  suggested: 'entry' | 'exit';
  occupancy: GateOccupancy;
}

export type PlateUncertainReason = 'cut_off' | 'too_small' | 'wrong_length' | 'disagreement' | 'low_confidence' | 'unreadable';

export interface PlateRecognition {
  /** Only for a complete, confident 6–8 digit reading of the nearest plate. */
  plateNumber: string | null;
  status: 'complete' | 'uncertain' | 'none';
  reason?: PlateUncertainReason;
  /** Digits as read; for an uncertain reading this is shown to the operator, never matched. */
  reading?: string;
  /** 0–1, mean digit confidence. */
  confidence: number;
  candidates: { plateNumber: string; votes: number }[];
  lookup?: GateLookup;
}

/** A camera frame: a file URI on native, a data URI on web. */
export interface PlateFrame { uri: string; mimeType?: string }

export type GateDirection = 'entry' | 'exit';
export type GateOutcome = 'entry' | 'exit' | 'already_inside' | 'not_inside' | 'too_soon' | 'review' | 'error';

/** What an automatic camera did with a plate. Only entry and exit changed occupancy. */
export interface GateEvent {
  id: ID;
  direction: GateDirection;
  plateNumber?: string;
  /** Best uncertain reading, for review only. */
  reading?: string;
  outcome: GateOutcome;
  confidence?: number;
  frames: number;
  message?: string;
  deviceName?: string;
  needsReview: boolean;
  reviewedAt?: ISODateString;
  createdAt: ISODateString;
}

export interface GateCamera {
  id: ID;
  name: string;
  direction: GateDirection;
  online: boolean;
  lastSeenAt?: ISODateString;
  lastPlate?: string;
  lastError?: string;
}

export interface GateLiveView { cameras: GateCamera[]; events: GateEvent[] }

/** The server's answer to each automatic camera frame. */
export interface GateFrameResult {
  state: 'idle' | 'tracking' | 'accepted' | 'cooldown' | 'review' | 'repeated_frame' | 'busy';
  plateNumber?: string | null;
  reading?: string;
  reason?: string;
  event?: GateEvent;
}

export interface GateService {
  gatePass(vehicleId: ID): Promise<GatePass>;
  zones(): Promise<GateZone[]>;
  visits(zoneId: ID): Promise<ParkingVisit[]>;
  entry(scan: GateScan): Promise<GateResult>;
  exit(scan: GateScan): Promise<GateResult>;
  occupancy(zoneId: ID): Promise<GateOccupancy>;
  lookup(zoneId: ID, plate: string): Promise<GateLookup>;
  recognize(zoneId: ID, frame: PlateFrame): Promise<PlateRecognition>;
  station(zoneId: ID, direction: GateDirection): Promise<{ id: ID; name: string; direction: GateDirection }>;
  sendFrame(deviceId: ID, frame: PlateFrame): Promise<GateFrameResult>;
  live(zoneId: ID): Promise<GateLiveView>;
  markReviewed(eventId: ID): Promise<GateEvent>;
  saveRules(zoneId: ID, rules: OverstayRules): Promise<OverstayRules>;
  patrolCheck(zoneId: ID, plate: string): Promise<PatrolCheck>;
  patrolIssue(zoneId: ID, plate: string): Promise<{ id: ID; amount: number; type: string }>;
}
