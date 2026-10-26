import type { GeoPoint } from '@/types';
import type { GuidanceLocale } from '@/utils/navigation/instructions';
import { distanceMeters } from '@/utils/geo';
import { isCategoryQuery, placeNameMatchScore, type PlaceSuggestion } from '@/services/placeSearchService';

/**
 * Spoken destination requests ("وديني على دوار المنارة", "Take me to Manara
 * Square"). This only extracts the place and picks a search result; the place
 * itself always comes from the normal search, and the route from the routing
 * engine. Pure, so it is testable without a microphone.
 */

export interface VoiceDestinationCommand {
  /** The place as spoken, without the command words. */
  query: string;
  /** "The nearest …": take the closest match instead of asking. */
  nearest: boolean;
  /** Asked for parking, which ParkFlow's own zones answer best. */
  parking: boolean;
}

const A = '[أاإآ]';
const AR_WANT = `(?:بد(?:ي|نا)|${A}ريد|نريد|${A}بي|عايز|عاوز|حاب[ب]?)`;
const AR_GO = `(?:${A}روح|نروح|روح|${A}مشي|نمشي|امشي|${A}ذهب|نذهب|الذهاب|${A}وصل|نوصل)`;
const AR_TAKE = `(?:وديني|ودينا|خذني|خدني|خذنا|روحني|دلني|دليني|وصلني|وصلنا|${A}رشدني)`;
const AR_HOW = `(?:كيف|كيفاش|وين)\\s+${A}?(?:وصل|روح)`;
/** "على", "إلى", colloquial "ع". Only as its own word, so "عمارة" keeps its first letter. */
const AR_TO = `(?:على|عل|${A}لى|لعند|عند|ع|ل)`;
const AR_COMMAND = new RegExp(`^(?:(?:${AR_WANT}\\s+)?${AR_GO}|${AR_TAKE}|${AR_HOW}|${AR_WANT})(?:\\s+|$)`, 'u');
const AR_TO_WORD = new RegExp(`^${AR_TO}(?:\\s+|$)`, 'u');
const AR_SUFFIX = new RegExp(`\\s*(?:(?:ب|باستخدام|عن\\s+طريق|من\\s+خلال|على|في)\\s*(?:park\\s*flow|بارك\\s*فلو)|لو\\s+سمحت|من\\s+فضلك|مشي(?:ا|ًا)?|سيرا\\s+على\\s+الاقدام)\\s*$`, 'iu');
const AR_NEAREST = new RegExp(`^${A}قرب\\s+`, 'u');

const EN_COMMAND =
  /^(?:please\s+)?(?:(?:i\s+(?:want|would like|'d like|need)\s+to\s+(?:go|walk|get)\s+to)|(?:can you\s+)?(?:take|walk|guide|bring|get)\s+me\s+to|navigate(?:\s+me)?\s+to|(?:walking\s+)?directions\s+to|how\s+do\s+i\s+get\s+to|walk\s+to|go\s+to|head\s+to|find)(?:\s+|$)/i;
const EN_SUFFIX = /\s*(?:(?:using|with|on|in|via)\s+park\s*flow|please|on foot|walking)\s*$/i;
const EN_NEAREST = /^(?:the\s+)?(?:nearest|closest)\s+/i;
const EN_ARTICLE = /^the\s+/i;
const PARKING = /\b(?:parking|car\s*park|parking\s+(?:lot|area|garage))\b|موا?قف|باركن[جغك]|كراج|جراج/iu;

/** Turns a transcript into the place being asked for; undefined when no place is left. */
export function parseVoiceDestination(transcript: string): VoiceDestinationCommand | undefined {
  let text = transcript.replace(/[.!?؟،,]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Command words, then a trailing "using ParkFlow" / "please", in either language.
  let commanded = false;
  const english = text.replace(EN_COMMAND, '');
  if (english !== text) {
    commanded = true;
    text = english;
  } else {
    const arabic = text.replace(AR_COMMAND, '');
    if (arabic !== text) {
      commanded = true;
      text = arabic;
    }
  }
  text = text.replace(AR_TO_WORD, '');
  // "روح للمنارة": the joined "لل" is "to" + "ال".
  if (commanded && /^لل\S{2,}/u.test(text)) text = `ا${text.slice(1)}`;
  for (let i = 0; i < 2; i++) text = text.replace(EN_SUFFIX, '').replace(AR_SUFFIX, '').trim();

  let nearest = false;
  const withoutNearest = text.replace(EN_NEAREST, '').replace(AR_NEAREST, '');
  if (withoutNearest !== text) {
    nearest = true;
    text = withoutNearest;
  }
  text = text.replace(EN_ARTICLE, '').trim();
  if (text.length < 2) return undefined;
  return { query: text, nearest, parking: PARKING.test(text) };
}

export type DestinationChoice =
  | { kind: 'match'; place: PlaceSuggestion }
  | { kind: 'ambiguous'; options: PlaceSuggestion[] }
  | { kind: 'none' };

/** A name match this strong (equal, or one contains the other) can start a walk without asking. */
const CONFIDENT_MATCH = 0.82;
/** Results this close together are the same place listed twice. */
const SAME_PLACE_METERS = 200;

const bestNameScore = (query: string, place: PlaceSuggestion) =>
  Math.max(...[place.name, place.nameAr, place.nameEn].filter((name): name is string => Boolean(name)).map((name) => placeNameMatchScore(query, name)));

/**
 * Chooses a search result for a spoken request. Starting a walk to the wrong
 * place is worse than asking, so anything short of one clear match returns
 * the options for the user to choose from.
 */
export function chooseSpokenDestination(
  command: VoiceDestinationCommand,
  suggestions: PlaceSuggestion[],
  origin?: GeoPoint,
): DestinationChoice {
  if (!suggestions.length) return { kind: 'none' };
  // "The nearest pharmacy" asks for the closest of a kind, not one named place.
  if (command.nearest || isCategoryQuery(command.query)) {
    const closest = origin
      ? [...suggestions].sort((a, b) => distanceMeters(a.location, origin) - distanceMeters(b.location, origin))[0]!
      : suggestions[0]!;
    return { kind: 'match', place: closest };
  }
  const scored = suggestions
    .map((place) => ({ place, score: bestNameScore(command.query, place) }))
    .filter((item) => item.score >= CONFIDENT_MATCH)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return { kind: 'ambiguous', options: suggestions };
  const exact = scored.filter((item) => item.score >= 1);
  if (exact.length === 1) return { kind: 'match', place: exact[0]!.place };
  const top = (exact.length ? exact : scored).filter((item) => item.score === scored[0]!.score);
  const first = top[0]!.place;
  if (top.every((item) => distanceMeters(item.place.location, first.location) <= SAME_PLACE_METERS)) {
    return { kind: 'match', place: first };
  }
  return { kind: 'ambiguous', options: top.map((item) => item.place) };
}

/**
 * A spoken request always walks: a fresh pedestrian route from the routing
 * engine, never the car route on screen or its trip-need stops.
 */
export function walkingTarget(destination: GeoPoint, name: string) {
  return { destination, name, routeOptions: { mode: 'fastest' as const, snapDestination: true, profile: 'walking' as const } };
}

/** What is said back while a spoken request has not become a walk yet. */
export const voiceWalkPhrases = {
  notUnderstood: (locale: GuidanceLocale) =>
    locale === 'ar' ? 'لم أفهم الوجهة. حاول مرة أخرى.' : "I didn't catch a destination. Please try again.",
  noLocation: (locale: GuidanceLocale) =>
    locale === 'ar' ? 'لا أستطيع تحديد موقعك. فعّل خدمة الموقع وحاول مجددًا.' : "I can't find your location. Turn on location and try again.",
  searchFailed: (locale: GuidanceLocale) =>
    locale === 'ar' ? 'تعذّر البحث الآن. تحقق من الاتصال وحاول مجددًا.' : "Search isn't available right now. Check your connection and try again.",
  notFound: (locale: GuidanceLocale, query: string) =>
    locale === 'ar' ? `لم أجد ${query}. حاول باسم آخر.` : `I couldn't find ${query}. Try another name.`,
  ambiguous: (locale: GuidanceLocale, query: string) =>
    locale === 'ar' ? `وجدت أكثر من مكان باسم ${query}. اختر واحدًا من القائمة.` : `I found more than one place called ${query}. Choose one from the list.`,
  walkingTo: (locale: GuidanceLocale, name: string) =>
    locale === 'ar' ? `مسار مشي إلى ${name}.` : `Walking route to ${name}.`,
};
