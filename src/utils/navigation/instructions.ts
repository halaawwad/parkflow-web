import type { TravelMode } from '@/types';
import type { Maneuver, ManeuverKind } from './maneuvers';

/**
 * Wording for turn-by-turn guidance in Arabic and English. The on-screen card
 * and the voice prompt are both produced here from the same maneuver, so the
 * two can never disagree. Arabic phrasing follows Modern Standard Arabic with
 * correct number–noun agreement for distances ("10 أمتار", "50 مترًا",
 * "200 متر").
 */

export type GuidanceLocale = 'ar' | 'en';

const ARABIC = /[؀-ۿ]/;
const LATIN = /[A-Za-z]/;

const ARABIC_RUN = /[\u0600-\u06FF][\u0600-\u06FF\s.\-]*[\u0600-\u06FF]|[\u0600-\u06FF]/g;
const LATIN_RUN = /[A-Za-z][A-Za-z0-9\s'.\-]*[A-Za-z0-9.]|[A-Za-z]/g;

/**
 * OpenStreetMap names are often bilingual ("Al-Teereh St. شارع الطيرة"). Keeps
 * the part written in the guidance language, or the whole name when there is
 * no such part.
 */
export function localizedStreet(street: string, locale: GuidanceLocale): string {
  if (!street || !(ARABIC.test(street) && LATIN.test(street))) return street;
  const runs = street.match(locale === 'ar' ? ARABIC_RUN : LATIN_RUN) ?? [];
  const best = runs.map((run) => run.trim()).sort((a, b) => b.length - a.length)[0];
  return best || street;
}

/** A street name is only spoken when the voice can pronounce its script. */
export function speakableStreet(street: string, locale: GuidanceLocale): string {
  const name = localizedStreet(street, locale);
  if (!name) return '';
  if (locale === 'ar') return ARABIC.test(name) ? name : '';
  return LATIN.test(name) && !ARABIC.test(name) ? name : '';
}

/**
 * Rounds a distance to what a person would say: 10 m steps, then 50 m, then
 * 100 m, then 0.1 km. Walking keeps 10 m steps up to 200 m: rounding 125 m up to
 * "150" is nothing in a car but twenty seconds on foot.
 */
export function roundSpokenDistance(meters: number, profile: TravelMode = 'driving'): number {
  if (meters < 100 || (profile === 'walking' && meters < 200)) return Math.max(10, Math.round(meters / 10) * 10);
  if (meters < 500) return Math.round(meters / 50) * 50;
  if (meters < 1000) return Math.round(meters / 100) * 100;
  return Math.round(meters / 100) * 100;
}

function arabicMeters(n: number): string {
  const tail = n % 100;
  if (tail === 0) return `${n} متر`;
  if (tail >= 3 && tail <= 10) return `${n} أمتار`;
  return `${n} مترًا`;
}

function arabicKilometers(km: number): string {
  if (km === 1) return 'كيلومتر واحد';
  if (km === 2) return 'كيلومترين';
  return `${km} كيلومتر`;
}

/** Distance as it should be spoken. */
export function spokenDistance(meters: number, locale: GuidanceLocale, profile: TravelMode = 'driving'): string {
  const rounded = roundSpokenDistance(meters, profile);
  if (rounded >= 1000) {
    const km = Math.round(rounded / 100) / 10;
    if (locale === 'ar') return arabicKilometers(km);
    return km === 1 ? '1 kilometer' : `${km} kilometers`;
  }
  return locale === 'ar' ? arabicMeters(rounded) : `${rounded} meters`;
}

/** Compact distance for the card: "150 m" / "150 م", "1.2 km" / "1.2 كم". */
export function displayDistance(meters: number, locale: GuidanceLocale): { value: string; unit: string } {
  if (meters >= 1000) {
    return { value: (Math.round(meters / 100) / 10).toFixed(1), unit: locale === 'ar' ? 'كم' : 'km' };
  }
  const value = meters < 50 ? Math.max(0, Math.round(meters / 5) * 5) : Math.round(meters / 10) * 10;
  return { value: String(value), unit: locale === 'ar' ? 'م' : 'm' };
}

const EN_ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const AR_ORDINALS = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر'];

const EN: Record<ManeuverKind, string> = {
  depart: 'Head out',
  straight: 'Continue straight',
  'slight-left': 'Bear left',
  'slight-right': 'Bear right',
  left: 'Turn left',
  right: 'Turn right',
  'sharp-left': 'Make a sharp left',
  'sharp-right': 'Make a sharp right',
  uturn: 'Make a U-turn',
  'keep-left': 'Keep left',
  'keep-right': 'Keep right',
  roundabout: 'Enter the roundabout',
  waypoint: 'Arrive at your stop',
  arrive: 'Arrive at your destination',
};

const AR: Record<ManeuverKind, string> = {
  depart: 'انطلق',
  straight: 'استمر للأمام',
  'slight-left': 'انحرف قليلًا إلى اليسار',
  'slight-right': 'انحرف قليلًا إلى اليمين',
  left: 'انعطف يسارًا',
  right: 'انعطف يمينًا',
  'sharp-left': 'انعطف بحدّة إلى اليسار',
  'sharp-right': 'انعطف بحدّة إلى اليمين',
  uturn: 'استدر للخلف',
  'keep-left': 'الزم اليسار',
  'keep-right': 'الزم اليمين',
  roundabout: 'ادخل الدوّار',
  waypoint: 'تصل إلى محطتك',
  arrive: 'تصل إلى وجهتك',
};

function roundaboutPhrase(exit: number | undefined, locale: GuidanceLocale): string {
  const ordinal = exit ? (locale === 'ar' ? AR_ORDINALS : EN_ORDINALS)[exit - 1] : undefined;
  if (locale === 'ar') return ordinal ? `عند الدوّار، اسلك المخرج ${ordinal}` : AR.roundabout;
  return ordinal ? `At the roundabout, take the ${ordinal} exit` : EN.roundabout;
}

function sidePhrase(side: Maneuver['side'], locale: GuidanceLocale): string {
  if (!side) return '';
  if (locale === 'ar') return side === 'right' ? '، على يمينك' : '، على يسارك';
  return side === 'right' ? ', on the right' : ', on the left';
}

/**
 * The instruction for a maneuver. `street` is the name to attach (pass
 * `speakableStreet(...)` for voice, the raw name for the screen).
 */
export function maneuverInstruction(maneuver: Pick<Maneuver, 'kind' | 'exit' | 'side'>, locale: GuidanceLocale, street = ''): string {
  const { kind } = maneuver;
  if (kind === 'roundabout') {
    const base = roundaboutPhrase(maneuver.exit, locale);
    if (!street) return base;
    return locale === 'ar' ? `${base} نحو ${street}` : `${base} onto ${street}`;
  }
  if (kind === 'arrive' || kind === 'waypoint') {
    return (locale === 'ar' ? AR : EN)[kind] + sidePhrase(maneuver.side, locale);
  }
  const base = (locale === 'ar' ? AR : EN)[kind];
  if (!street) return base;
  if (kind === 'straight') return locale === 'ar' ? `${base} على ${street}` : `${base} on ${street}`;
  if (kind === 'depart') return locale === 'ar' ? `${base} على ${street}` : `Head out on ${street}`;
  return locale === 'ar' ? `${base} إلى ${street}` : `${base} onto ${street}`;
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
/** Ends a sentence once, even when a street name already ends in a full stop ("Al-Teereh St."). */
const sentence = (text: string) => `${text.replace(/[.\s]+$/, '')}.`;

/** "In 150 meters, turn right onto Al-Quds Street." / "بعد 150 مترًا، انعطف يمينًا إلى شارع القدس." */
export function approachPhrase(maneuver: Maneuver, meters: number, locale: GuidanceLocale, profile: TravelMode = 'driving'): string {
  const instruction = maneuverInstruction(maneuver, locale, speakableStreet(maneuver.street, locale));
  const distance = spokenDistance(meters, locale, profile);
  return sentence(locale === 'ar' ? `بعد ${distance}، ${instruction}` : `In ${distance}, ${lowerFirst(instruction)}`);
}

/** The instruction at the maneuver itself, optionally chained with a close follow-up. */
export function actionPhrase(maneuver: Maneuver, locale: GuidanceLocale, then?: Maneuver): string {
  const instruction = maneuverInstruction(maneuver, locale, speakableStreet(maneuver.street, locale));
  if (!then) return sentence(instruction);
  const next = maneuverInstruction(then, locale);
  const lead = instruction.trimEnd();
  return sentence(locale === 'ar' ? `${lead}، ثم ${next}` : `${lead}, then ${lowerFirst(next)}`);
}

/** "Continue straight for 1.2 kilometers." / walking: "Continue walking for 300 meters." */
export function continuePhrase(meters: number, locale: GuidanceLocale, profile: TravelMode = 'driving'): string {
  const distance = spokenDistance(meters, locale, profile);
  if (profile === 'walking') return locale === 'ar' ? `تابع السير لمسافة ${distance}.` : `Continue walking for ${distance}.`;
  return locale === 'ar' ? `استمر للأمام لمسافة ${distance}.` : `Continue straight for ${distance}.`;
}

export function arrivedPhrase(side: Maneuver['side'], locale: GuidanceLocale, waypoint = false): string {
  if (waypoint) return locale === 'ar' ? `لقد وصلت إلى محطتك${sidePhrase(side, locale)}.` : `You have reached your stop${sidePhrase(side, locale)}.`;
  return locale === 'ar'
    ? `لقد وصلت إلى وجهتك${sidePhrase(side, locale)}.`
    : `You have arrived at your destination${sidePhrase(side, locale)}.`;
}

/** Status lines. Walking variants say so, so a pedestrian is never told about driving. */
export const systemPhrases = {
  start: (locale: GuidanceLocale, profile: TravelMode = 'driving') =>
    profile === 'walking'
      ? locale === 'ar' ? 'بدأت ملاحة المشي.' : 'Walking navigation started.'
      : locale === 'ar' ? 'بدأت الملاحة.' : 'Navigation started.',
  rerouting: (locale: GuidanceLocale, profile: TravelMode = 'driving') =>
    profile === 'walking'
      ? locale === 'ar' ? 'ابتعدت عن المسار. جاري حساب طريق جديد.' : 'You are off the route. Calculating a new walking route.'
      : locale === 'ar' ? 'جارٍ إعادة حساب المسار.' : 'Recalculating route.',
  rerouted: (locale: GuidanceLocale) => (locale === 'ar' ? 'تم تحديث المسار.' : 'Route updated.'),
  wrongWay: (locale: GuidanceLocale, profile: TravelMode = 'driving') =>
    profile === 'walking'
      ? locale === 'ar' ? 'يبدو أنك تمشي في الاتجاه المعاكس.' : 'You seem to be walking the wrong way.'
      : locale === 'ar' ? 'يبدو أنك تسير في الاتجاه المعاكس.' : 'You appear to be heading the wrong way.',
  weakSignal: (locale: GuidanceLocale) =>
    locale === 'ar'
      ? 'إشارة الموقع ضعيفة. تم إيقاف الإرشاد مؤقتًا حتى تتحسن الإشارة.'
      : 'GPS signal is weak. Guidance is paused until your location is clear.',
  signalLost: (locale: GuidanceLocale) =>
    locale === 'ar'
      ? 'انقطعت إشارة الموقع. تم إيقاف الإرشاد مؤقتًا.'
      : 'GPS signal lost. Guidance is paused.',
  signalRestored: (locale: GuidanceLocale) => (locale === 'ar' ? 'عادت إشارة الموقع.' : 'GPS signal restored.'),
  offline: (locale: GuidanceLocale) =>
    locale === 'ar'
      ? 'تعذّر تحديث المسار بسبب انقطاع الاتصال. سأحاول مجددًا.'
      : 'Could not update the route while offline. Trying again.',
  stopped: (locale: GuidanceLocale) => (locale === 'ar' ? 'انتهت الملاحة.' : 'Navigation ended.'),
  paused: (locale: GuidanceLocale) => (locale === 'ar' ? 'تم إيقاف الملاحة مؤقتًا.' : 'Navigation paused.'),
  resumed: (locale: GuidanceLocale) => (locale === 'ar' ? 'تم استئناف الملاحة.' : 'Navigation resumed.'),
};
