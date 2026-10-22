import { env } from '../../config/env';
import { ApiError } from '../../utils/errors';

/**
 * SmartGate reads plates with pretrained ALPR models (FastALPR, see server/alpr).
 * The reader decodes digits only, votes across several crops and says whether a
 * plate was read completely; this module only accepts what it marked complete.
 */

/** ParkFlow plate formats: Palestinian 7 digits, Israeli 7 or 8, older 6. */
export const PLATE_DIGITS = { min: 6, max: 8 } as const;

export type UncertainReason = 'cut_off' | 'too_small' | 'wrong_length' | 'disagreement' | 'low_confidence' | 'unreadable';

export interface PlateReading {
  /** Only when the plate was read completely and confidently. */
  plateNumber: string | null;
  status: 'complete' | 'uncertain' | 'none';
  reason?: UncertainReason;
  /** The digits as read, shown to the operator to check — never treated as a match when uncertain. */
  reading?: string;
  confidence: number;
  /** Other digit strings the crops produced, for the operator to pick from. */
  candidates: { plateNumber: string; votes: number }[];
}

interface AlprPlate {
  digits: string | null; complete: boolean; reason: string | null; confidence: number;
  weakestDigit: number; agreement: number; detectionConfidence: number; alternatives?: { digits: string; votes: number }[];
}

const REASONS = new Set<UncertainReason>(['cut_off', 'too_small', 'wrong_length', 'disagreement', 'low_confidence', 'unreadable']);
const digitsOnly = (value: unknown) => String(value ?? '').replace(/\D/g, '');

/** The reader puts the largest plate — the car at the gate — first; only that one counts. */
export function toReading(body: { plates?: AlprPlate[] }): PlateReading {
  const primary = body.plates?.[0];
  if (!primary) return { plateNumber: null, status: 'none', confidence: 0, candidates: [] };
  const reading = digitsOnly(primary.digits);
  const confidence = Math.round(Math.max(0, Math.min(1, Number(primary.confidence) || 0)) * 100) / 100;
  const candidates = (primary.alternatives ?? [])
    .map((a) => ({ plateNumber: digitsOnly(a.digits), votes: Number(a.votes) || 0 }))
    .filter((a) => a.plateNumber.length >= PLATE_DIGITS.min && a.plateNumber.length <= PLATE_DIGITS.max && a.plateNumber !== reading)
    .slice(0, 3);
  // Checked again here: a complete reading is a whole ParkFlow plate, nothing shorter or longer.
  const complete = primary.complete === true && reading.length >= PLATE_DIGITS.min && reading.length <= PLATE_DIGITS.max;
  if (complete) return { plateNumber: reading, status: 'complete', reading, confidence, candidates };
  const reason = REASONS.has(primary.reason as UncertainReason) ? primary.reason as UncertainReason : primary.complete ? 'wrong_length' : 'low_confidence';
  return { plateNumber: null, status: 'uncertain', reason, reading: reading || undefined, confidence, candidates };
}

/** 424, not 5xx: the API is up and the app should say recognition is offline, not that the server is down. */
export async function readPlate(image: Buffer, mimetype: string): Promise<PlateReading> {
  let response: Response;
  try {
    response = await fetch(`${env.ALPR_URL.replace(/\/$/, '')}/recognize`, {
      method: 'POST',
      headers: { 'Content-Type': mimetype, ...(env.ALPR_TOKEN ? { 'X-ALPR-Token': env.ALPR_TOKEN } : {}) },
      body: new Uint8Array(image),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ApiError(424, 'ALPR_UNAVAILABLE', 'Plate recognition is offline. Type the plate number instead.');
  }
  if (response.status === 400 || response.status === 413) throw new ApiError(400, 'ALPR_INVALID_IMAGE', 'The camera image could not be read');
  if (!response.ok) throw new ApiError(424, 'ALPR_UNAVAILABLE', 'Plate recognition is offline. Type the plate number instead.');
  return toReading(await response.json().catch(() => ({})) as { plates?: AlprPlate[] });
}
