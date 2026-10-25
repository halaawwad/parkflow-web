import { z } from 'zod';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { ApiError } from '../utils/errors';

/**
 * Server-side Gemini text generation over the official REST API, the same
 * transport the warning check and the navigation voice already use. The key is
 * read from GEMINI_API_KEY and only ever sent in the request header: it never
 * reaches the client, logs or error messages.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export const geminiConfigured = () => Boolean(env.GEMINI_API_KEY);

const responseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(z.object({ text: z.string().optional() })) }).optional(),
        finishReason: z.string().optional(),
      }),
    )
    .min(1),
});

export interface GenerateTextOptions {
  /** Instructions that frame the task; kept apart from the user content. */
  system: string;
  prompt: string;
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** Extra attempts after a rate limit or server error. */
  retries?: number;
  /** Lets tests skip the backoff sleep. */
  sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Generates plain text; throws ApiError(503) when Gemini is not configured or unreachable. */
export async function generateText(options: GenerateTextOptions): Promise<string> {
  if (!env.GEMINI_API_KEY) throw new ApiError(503, 'AI_NOT_CONFIGURED', 'AI assistance is not configured');
  const { retries = 2, timeoutMs = 8_000, sleep = wait } = options;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: options.system }] },
    contents: [{ role: 'user', parts: [{ text: options.prompt }] }],
    generationConfig: {
      temperature: options.temperature ?? 0.2,
      maxOutputTokens: options.maxOutputTokens ?? 256,
      responseMimeType: 'text/plain',
    },
  });

  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${ENDPOINT}/${env.GEMINI_MODEL}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        signal: AbortSignal.timeout(timeoutMs),
        body,
      });
    } catch {
      if (attempt < retries) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw new ApiError(503, 'AI_UNAVAILABLE', 'AI assistance is temporarily unavailable');
    }

    if (RETRYABLE.has(response.status) && attempt < retries) {
      const retryAfter = Number(response.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 3_000) : 500 * 2 ** attempt);
      continue;
    }
    if (!response.ok) {
      // Status only: the provider's error body can echo request details.
      logger.warn({ status: response.status, model: env.GEMINI_MODEL }, 'Gemini request failed');
      throw new ApiError(503, 'AI_UNAVAILABLE', 'AI assistance is temporarily unavailable');
    }

    const parsed = responseSchema.safeParse(await response.json().catch(() => null));
    const text = parsed.success
      ? parsed.data.candidates[0]!.content?.parts.map((part) => part.text ?? '').join('').trim()
      : '';
    if (!text) throw new ApiError(503, 'AI_UNAVAILABLE', 'AI assistance returned no text');
    return text;
  }
}
