import { describe, expect, it } from 'vitest';
import { chooseSpokenDestination, parseVoiceDestination, voiceWalkPhrases, walkingTarget } from '@/utils/navigation/voiceCommand';
import type { PlaceSuggestion } from '@/services/placeSearchService';

/** Spoken destination requests: command words are removed, the place is kept as spoken. */

const place = (id: string, name: string, latitude: number, longitude: number, extra: Partial<PlaceSuggestion> = {}): PlaceSuggestion => ({
  id, name, location: { latitude, longitude }, source: 'nominatim', ...extra,
});
const MANARA = place('landmark:lm_manara', 'Manara Square', 31.9038, 35.2034, { nameAr: 'دوار المنارة', nameEn: 'Manara Square', source: 'landmark' });
const here = { latitude: 31.9, longitude: 35.2 };

describe('spoken destination commands', () => {
  it.each([
    ['بدي أروح على دوار المنارة', 'دوار المنارة'],
    ['وديني على شارع ركب', 'شارع ركب'],
    ['بدي أروح على مستشفى رام الله', 'مستشفى رام الله'],
    ['خذني ع دوار المنارة', 'دوار المنارة'],
    ['بدي امشي لعند دوار المنارة لو سمحت', 'دوار المنارة'],
    ['وديني على دوار المنارة بباركفلو', 'دوار المنارة'],
    ['روح للمنارة', 'المنارة'],
    ['دوار المنارة', 'دوار المنارة'],
  ])('Arabic: "%s" asks for "%s"', (spoken, query) => {
    expect(parseVoiceDestination(spoken)).toMatchObject({ query, nearest: false });
  });

  it.each([
    ['Take me to Manara Square', 'Manara Square'],
    ['Take me to Manara Square using ParkFlow.', 'Manara Square'],
    ['navigate to Rukab Street please', 'Rukab Street'],
    ['I want to go to the Ramallah hospital', 'Ramallah hospital'],
    ['walk me to Al-Manara', 'Al-Manara'],
  ])('English: "%s" asks for "%s"', (spoken, query) => {
    expect(parseVoiceDestination(spoken)).toMatchObject({ query, nearest: false });
  });

  it('keeps the first letter of a place that starts like "to" in Arabic', () => {
    expect(parseVoiceDestination('عمارة الريان')?.query).toBe('عمارة الريان');
    expect(parseVoiceDestination('وديني على عين مصباح')?.query).toBe('عين مصباح');
  });

  it('recognises "the nearest parking" in both languages', () => {
    expect(parseVoiceDestination('Navigate to the nearest parking area')).toEqual({ query: 'parking area', nearest: true, parking: true });
    expect(parseVoiceDestination('وديني على أقرب موقف')).toEqual({ query: 'موقف', nearest: true, parking: true });
    expect(parseVoiceDestination('take me to the closest pharmacy')).toEqual({ query: 'pharmacy', nearest: true, parking: false });
  });

  it('returns nothing when only command words were heard', () => {
    expect(parseVoiceDestination('')).toBeUndefined();
    expect(parseVoiceDestination('  ')).toBeUndefined();
    expect(parseVoiceDestination('وديني على')).toBeUndefined();
    expect(parseVoiceDestination('take me to')).toBeUndefined();
  });
});

describe('choosing a spoken destination', () => {
  it('starts on a single clear name match', () => {
    const results = [MANARA, place('osm:1', 'Manara Bakery', 31.95, 35.25)];
    expect(chooseSpokenDestination(parseVoiceDestination('بدي أروح على دوار المنارة')!, results, here)).toEqual({ kind: 'match', place: MANARA });
    expect(chooseSpokenDestination(parseVoiceDestination('Take me to Manara Square')!, results, here)).toEqual({ kind: 'match', place: MANARA });
  });

  it('treats near-identical results as one place', () => {
    const twin = place('osm:2', 'Manara Square', 31.9040, 35.2036);
    expect(chooseSpokenDestination({ query: 'Manara Square', nearest: false, parking: false }, [MANARA, twin], here)).toMatchObject({ kind: 'match', place: MANARA });
  });

  it('asks the user to choose when equally good matches are far apart', () => {
    const north = place('osm:3', 'Al-Amal Hospital', 31.95, 35.2);
    const south = place('osm:4', 'Al-Amal Hospital', 31.85, 35.2);
    const choice = chooseSpokenDestination({ query: 'Al-Amal Hospital', nearest: false, parking: false }, [north, south], here);
    expect(choice).toEqual({ kind: 'ambiguous', options: [north, south] });
  });

  it('asks rather than guessing when no result clearly matches the name', () => {
    const results = [place('osm:5', 'Something Else', 31.9, 35.2)];
    expect(chooseSpokenDestination({ query: 'Rukab Street', nearest: false, parking: false }, results, here)).toEqual({ kind: 'ambiguous', options: results });
  });

  it('reports an unknown destination', () => {
    expect(chooseSpokenDestination({ query: 'Nowhere', nearest: false, parking: false }, [], here)).toEqual({ kind: 'none' });
  });

  it('takes the closest result for "the nearest …" and for a kind of place', () => {
    const far = place('osm:6', 'Pharmacy A', 31.95, 35.25);
    const near = place('osm:7', 'Pharmacy B', 31.901, 35.201);
    expect(chooseSpokenDestination({ query: 'pharmacy', nearest: true, parking: false }, [far, near], here)).toEqual({ kind: 'match', place: near });
    expect(chooseSpokenDestination({ query: 'صيدلية', nearest: false, parking: false }, [far, near], here)).toEqual({ kind: 'match', place: near });
  });

  it('always asks the routing engine for a fresh walking route', () => {
    const target = walkingTarget(MANARA.location, MANARA.name);
    expect(target.routeOptions.profile).toBe('walking');
    expect(target).not.toHaveProperty('initialRoute');
    expect(target).not.toHaveProperty('via');
  });

  it('has spoken feedback in both languages', () => {
    expect(voiceWalkPhrases.notFound('ar', 'شارع ركب')).toContain('شارع ركب');
    expect(voiceWalkPhrases.ambiguous('en', 'Al-Amal')).toContain('Choose one');
  });
});
