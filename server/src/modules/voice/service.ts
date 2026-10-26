import { createHash } from 'node:crypto';
import { z } from 'zod';
import { env } from '../../config/env';
import { db } from '../../database/client';
import { ApiError } from '../../utils/errors';
import { pcmToWav, trimSilence, wavToPcm } from './wav';

export { pcmToWav } from './wav';

/**
 * Natural navigation voice through Gemini text-to-speech. The device voices a
 * browser exposes (e.g. Windows' Arabic "Naayf") are robotic; Gemini's are
 * not. The key stays on the server.
 *
 * Navigation repeats the same short sentences for every driver, and the voice
 * model's quota is small, so each sentence is synthesised once and kept:
 * memory first, then the database (shared across restarts and instances),
 * and only then the model. Calls to the model are queued — the sentence a
 * driver is waiting for goes first, look-ahead fetches after — and when the
 * model reports its quota spent, it is left alone until the quota returns
 * while stored sentences keep playing.
 *
 * Only the sentence itself is sent: Gemini 3.8 TTS reads every word of its
 * input aloud, so a style preamble was being spoken before each instruction.
 */

export type VoiceLocale = 'ar' | 'en';
/** `now`: a driver is waiting for this sentence. `soon`: fetched ahead of time. */
export type VoicePriority = 'now' | 'soon';

interface SpokenAudio {
  mimeType: 'audio/wav';
  /** Base64 WAV file. */
  audio: string;
}

const MEMORY_LIMIT = 200;
/** Stored clips kept, by most recent use. About 90 kB each once trimmed. */
const STORE_LIMIT = 1000;
const TIMEOUT_MS = 12_000;
/** Parallel calls to the model. Small on purpose: free-tier quotas are counted per minute. */
const MAX_CONCURRENT = 2;
const DEFAULT_COOLDOWN_MS = 30_000;
const MAX_COOLDOWN_MS = 120_000;

const memory = new Map<string, SpokenAudio>();
const inFlight = new Map<string, Promise<SpokenAudio>>();

const envelopeSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({
          parts: z.array(z.object({ inlineData: z.object({ mimeType: z.string(), data: z.string().min(1) }).optional() })),
        }),
      }),
    )
    .min(1),
});

/** A dedicated voice key keeps text-to-speech on its own Gemini project and quota. */
const apiKey = () => env.GEMINI_TTS_API_KEY || env.GEMINI_API_KEY;

const rateOf = (mimeType: string) => Number(/rate=(\d+)/.exec(mimeType)?.[1] ?? 24000);

const rateLimited = () => new ApiError(429, 'VOICE_RATE_LIMITED', 'The navigation voice is temporarily unavailable');

// ---- Model quota: queue and cooldown ---------------------------------------

let cooldownUntil = 0;
let active = 0;
const waiting: { priority: VoicePriority; start: () => void; reject: (error: unknown) => void }[] = [];

/** How long Google asked us to wait: Retry-After, or the RetryInfo delay in the error body. */
function cooldownFrom(headers: Headers | undefined, body: unknown): number {
  const header = Number(headers?.get?.('retry-after'));
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, MAX_COOLDOWN_MS);
  const delay = JSON.stringify(body ?? '').match(/"retryDelay":"(\d+(?:\.\d+)?)s"/)?.[1];
  if (delay) return Math.min(Number(delay) * 1000, MAX_COOLDOWN_MS);
  return DEFAULT_COOLDOWN_MS;
}

function pump() {
  while (active < MAX_CONCURRENT && waiting.length) {
    const index = waiting.findIndex((job) => job.priority === 'now');
    const [job] = waiting.splice(index === -1 ? 0 : index, 1);
    job!.start();
  }
}

/** Runs a model call when a slot is free; a waiting driver's sentence jumps the look-ahead queue. */
function schedule<T>(priority: VoicePriority, task: () => Promise<T>): Promise<T> {
  if (Date.now() < cooldownUntil) return Promise.reject(rateLimited());
  return new Promise<T>((resolve, reject) => {
    waiting.push({
      priority,
      reject,
      start: () => {
        // The quota may have run out while this one waited.
        if (Date.now() < cooldownUntil) return reject(rateLimited());
        active++;
        task().then(resolve, reject).finally(() => {
          active--;
          pump();
        });
      },
    });
    pump();
  });
}

function startCooldown(ms: number) {
  cooldownUntil = Date.now() + ms;
  // Everything still queued would only spend the next minute's quota on 429s.
  for (const job of waiting.splice(0)) job.reject(rateLimited());
}

// ---- Synthesis ---------------------------------------------------------------

/** Normalises the model's audio to a trimmed mono WAV. */
function toWav(bytes: Buffer, mimeType: string): Buffer {
  const isWav = /^audio\/(x-)?wav/i.test(mimeType) || bytes.subarray(0, 4).toString('latin1') === 'RIFF';
  // Gemini 3.8 TTS returns a WAV file; older models return headerless PCM.
  const pcm = isWav ? wavToPcm(bytes) : { pcm: bytes, sampleRate: rateOf(mimeType) };
  if (!pcm) return bytes;
  const trimmed = trimSilence(pcm);
  return pcmToWav(trimmed.pcm, trimmed.sampleRate);
}

async function synthesize(text: string): Promise<Buffer> {
  let raw: unknown;
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_TTS_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey()! },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: env.GEMINI_TTS_VOICE } } },
        },
      }),
    });
    if (response.status === 429) {
      startCooldown(cooldownFrom(response.headers, await response.json().catch(() => undefined)));
      throw rateLimited();
    }
    if (!response.ok) throw new ApiError(503, 'VOICE_PROVIDER_UNAVAILABLE', 'The navigation voice is temporarily unavailable');
    raw = await response.json();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(504, 'VOICE_TIMEOUT', 'The navigation voice timed out');
  }
  const parsed = envelopeSchema.safeParse(raw);
  const audio = parsed.success ? parsed.data.candidates[0]!.content.parts.find((part) => part.inlineData)?.inlineData : undefined;
  if (!audio) throw new ApiError(502, 'VOICE_MALFORMED', 'The navigation voice returned no audio');
  return toWav(Buffer.from(audio.data, 'base64'), audio.mimeType);
}

// ---- Shared store ------------------------------------------------------------

let writes = 0;

async function fromStore(key: string): Promise<SpokenAudio | undefined> {
  const row = await db.voiceClip.findUnique({ where: { key } }).catch(() => null);
  if (!row) return undefined;
  void db.voiceClip.update({ where: { key }, data: { usedAt: new Date() } }).catch(() => undefined);
  return { mimeType: 'audio/wav', audio: Buffer.from(row.audio).toString('base64') };
}

async function toStore(key: string, wav: Buffer) {
  // Prisma wants a plain ArrayBuffer-backed Uint8Array.
  const audio = new Uint8Array(wav);
  await db.voiceClip
    .upsert({ where: { key }, create: { key, mimeType: 'audio/wav', audio }, update: { audio, usedAt: new Date() } })
    .catch(() => undefined);
  // Keep the table bounded: drop the least recently used clips now and then.
  if (++writes % 25 === 0) {
    await db.$executeRaw`DELETE FROM "voice_clips" WHERE "key" IN (SELECT "key" FROM "voice_clips" ORDER BY "usedAt" DESC OFFSET ${STORE_LIMIT})`.catch(() => undefined);
  }
}

function remember(key: string, result: SpokenAudio) {
  memory.set(key, result);
  if (memory.size > MEMORY_LIMIT) memory.delete(memory.keys().next().value!);
}

export async function speak(text: string, locale: VoiceLocale, priority: VoicePriority = 'soon'): Promise<SpokenAudio> {
  if (!apiKey()) throw new ApiError(503, 'VOICE_NOT_CONFIGURED', 'The navigation voice is not configured');
  const key = createHash('sha256').update(`${env.GEMINI_TTS_MODEL}|${env.GEMINI_TTS_VOICE}|${locale}|${text}`).digest('hex');

  const hit = memory.get(key);
  if (hit) {
    // Refresh recency so frequently used prompts stay cached.
    memory.delete(key);
    memory.set(key, hit);
    return hit;
  }
  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = (async () => {
    const stored = await fromStore(key);
    if (stored) return stored;
    const wav = await schedule(priority, () => synthesize(text));
    void toStore(key, wav);
    return { mimeType: 'audio/wav' as const, audio: wav.toString('base64') };
  })()
    .then((result) => {
      remember(key, result);
      return result;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

/** Test hook: forget memory, queue and cooldown. */
export function clearVoiceCache() {
  memory.clear();
  inFlight.clear();
  waiting.splice(0);
  active = 0;
  cooldownUntil = 0;
}

/** Test hook: empty the shared store. */
export async function clearStoredVoiceClips() {
  await db.voiceClip.deleteMany();
}
