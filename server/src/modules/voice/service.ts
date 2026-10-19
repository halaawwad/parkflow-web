import { createHash } from 'node:crypto';
import { z } from 'zod';
import { env } from '../../config/env';
import { ApiError } from '../../utils/errors';

/**
 * Natural navigation voice through Gemini text-to-speech. The device voices a
 * browser exposes (e.g. Windows' Arabic "Naayf") are robotic; Gemini's are
 * not. The key stays on the server.
 *
 * Gemini returns raw 16-bit PCM; it is wrapped in a WAV header so every
 * browser can play it directly. Results are cached in memory: navigation
 * repeats the same short sentences constantly, so most requests never reach
 * the provider.
 */

export type VoiceLocale = 'ar' | 'en';

const CACHE_LIMIT = 200;
const TIMEOUT_MS = 12_000;

/** Style direction for the model. It shapes delivery and is not read aloud. */
const STYLE: Record<VoiceLocale, string> = {
  ar: 'Read the following Arabic navigation instruction in clear, natural Modern Standard Arabic, calm and confident like an in-car navigation assistant, at a steady pace:',
  en: 'Read the following navigation instruction clearly and naturally, calm and confident like an in-car navigation assistant, at a steady pace:',
};

interface SpokenAudio {
  mimeType: 'audio/wav';
  /** Base64 WAV file. */
  audio: string;
}

const cache = new Map<string, SpokenAudio>();
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

/** Wraps mono 16-bit little-endian PCM in a WAV container. */
export function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const rateOf = (mimeType: string) => Number(/rate=(\d+)/.exec(mimeType)?.[1] ?? 24000);

async function synthesize(text: string, locale: VoiceLocale): Promise<SpokenAudio> {
  let raw: unknown;
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_TTS_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY! },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${STYLE[locale]}\n${text}` }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: env.GEMINI_TTS_VOICE } } },
        },
      }),
    });
    if (!response.ok) {
      throw new ApiError(
        response.status === 429 ? 429 : 503,
        response.status === 429 ? 'VOICE_RATE_LIMITED' : 'VOICE_PROVIDER_UNAVAILABLE',
        'The navigation voice is temporarily unavailable',
      );
    }
    raw = await response.json();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(504, 'VOICE_TIMEOUT', 'The navigation voice timed out');
  }
  const parsed = envelopeSchema.safeParse(raw);
  const audio = parsed.success ? parsed.data.candidates[0]!.content.parts.find((part) => part.inlineData)?.inlineData : undefined;
  if (!audio) throw new ApiError(502, 'VOICE_MALFORMED', 'The navigation voice returned no audio');
  const pcm = Buffer.from(audio.data, 'base64');
  return { mimeType: 'audio/wav', audio: pcmToWav(pcm, rateOf(audio.mimeType)).toString('base64') };
}

export async function speak(text: string, locale: VoiceLocale): Promise<SpokenAudio> {
  if (!env.GEMINI_API_KEY) throw new ApiError(503, 'VOICE_NOT_CONFIGURED', 'The navigation voice is not configured');
  const key = createHash('sha256').update(`${env.GEMINI_TTS_MODEL}|${env.GEMINI_TTS_VOICE}|${locale}|${text}`).digest('hex');

  const hit = cache.get(key);
  if (hit) {
    // Refresh recency so frequently used prompts stay cached.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = synthesize(text, locale)
    .then((result) => {
      cache.set(key, result);
      if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
      return result;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

/** Test hook. */
export function clearVoiceCache() {
  cache.clear();
  inFlight.clear();
}
