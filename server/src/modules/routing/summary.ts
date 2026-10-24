import { createHash } from 'node:crypto';
import { generateText } from '../../providers/gemini';

/**
 * A short, friendly overview of a route, phrased by Gemini.
 *
 * Gemini only rewords what the client already shows: the instructions sent in
 * are the ones the routing provider produced. It is told to add nothing, and a
 * reply that cites distances the route does not contain is thrown away. The
 * summary is informational; turn-by-turn guidance never depends on it.
 */

export interface RouteSummaryInput {
  profile: 'driving' | 'walking';
  locale: 'ar' | 'en';
  destinationName: string;
  distanceMeters: number;
  durationSeconds: number;
  steps: { instruction: string; distanceMeters: number }[];
}

const CACHE_LIMIT = 300;
const CACHE_MS = 60 * 60_000;
const MAX_CHARS = 420;
const cache = new Map<string, { summary: string; expires: number }>();

const SYSTEM = [
  'You write a short overview of a route for someone about to travel it.',
  'Use ONLY the facts provided: the instructions, distances, total distance and time.',
  'Never invent streets, landmarks, turns, distances, hazards or directions that are not listed.',
  'At most two short sentences, plain text, no lists, no markdown, no emoji.',
  'Arabic replies use clear Modern Standard Arabic understood in Palestine.',
].join(' ');

function promptOf(input: RouteSummaryInput): string {
  const minutes = Math.max(1, Math.round(input.durationSeconds / 60));
  const mode = input.profile === 'walking' ? 'a walking route' : 'a driving route';
  const language = input.locale === 'ar' ? 'Arabic' : 'English';
  const steps = input.steps.map((step, index) => `${index + 1}. ${step.instruction} (${Math.round(step.distanceMeters)} m)`).join('\n');
  return [
    `Summarise ${mode} in ${language}.`,
    `Destination: ${input.destinationName}`,
    `Total: ${Math.round(input.distanceMeters)} m, about ${minutes} min.`,
    'Instructions in order:',
    steps,
  ].join('\n');
}

/** Numbers the reply may contain: those in the request, plus the rounded totals. */
function allowedNumbers(input: RouteSummaryInput): Set<string> {
  const minutes = Math.max(1, Math.round(input.durationSeconds / 60));
  const km = input.distanceMeters / 1000;
  const values = [
    minutes,
    Math.round(input.distanceMeters),
    Math.round(input.distanceMeters / 10) * 10,
    Math.round(input.distanceMeters / 50) * 50,
    Math.round(input.distanceMeters / 100) * 100,
    ...input.steps.flatMap((step) => [Math.round(step.distanceMeters), Math.round(step.distanceMeters / 10) * 10, Math.round(step.distanceMeters / 50) * 50]),
  ].map(String);
  values.push(km.toFixed(1), km.toFixed(2), String(Math.round(km)));
  for (const text of [input.destinationName, ...input.steps.map((step) => step.instruction)]) {
    for (const match of text.match(/\d+(?:[.,]\d+)?/g) ?? []) values.push(match.replace(',', '.'));
  }
  return new Set(values);
}

const toLatinDigits = (text: string) => text.replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));

/** Rejects replies that cite a number the route does not contain. */
export function summaryIsGrounded(summary: string, input: RouteSummaryInput): boolean {
  const allowed = allowedNumbers(input);
  return (toLatinDigits(summary).match(/\d+(?:[.,]\d+)?/g) ?? []).every((value) => allowed.has(value.replace(',', '.')));
}

export async function summarizeRoute(input: RouteSummaryInput): Promise<{ summary: string | null; source: 'gemini' }> {
  const key = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return { summary: hit.summary, source: 'gemini' };

  const raw = await generateText({ system: SYSTEM, prompt: promptOf(input), maxOutputTokens: 200, temperature: 0.2 });
  const summary = raw.replace(/[*_#`>]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
  // An ungrounded reply is dropped rather than shown; the route itself is unaffected.
  if (!summary || !summaryIsGrounded(summary, input)) return { summary: null, source: 'gemini' };

  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, { summary, expires: Date.now() + CACHE_MS });
  return { summary, source: 'gemini' };
}
