import { describe, expect, it } from 'vitest';
import {
  actionPhrase,
  approachPhrase,
  arrivedPhrase,
  continuePhrase,
  displayDistance,
  localizedStreet,
  maneuverInstruction,
  speakableStreet,
  spokenDistance,
} from '@/utils/navigation/instructions';
import type { Maneuver } from '@/utils/navigation/maneuvers';

const maneuver = (overrides: Partial<Maneuver>): Maneuver => ({
  id: 'r:1',
  index: 1,
  kind: 'right',
  along: 100,
  location: { latitude: 31.9, longitude: 35.2 },
  street: '',
  announce: true,
  leg: 0,
  ...overrides,
});

describe('guidance wording', () => {
  it('speaks natural English prompts', () => {
    expect(approachPhrase(maneuver({ kind: 'right' }), 50, 'en')).toBe('In 50 meters, turn right.');
    expect(approachPhrase(maneuver({ kind: 'left', street: 'Al-Irsal Street' }), 212, 'en')).toBe(
      'In 200 meters, turn left onto Al-Irsal Street.',
    );
    expect(actionPhrase(maneuver({ kind: 'uturn' }), 'en')).toBe('Make a U-turn.');
    expect(continuePhrase(1240, 'en')).toBe('Continue straight for 1.2 kilometers.');
    expect(arrivedPhrase(undefined, 'en')).toBe('You have arrived at your destination.');
  });

  it('speaks Modern Standard Arabic with correct number agreement', () => {
    expect(approachPhrase(maneuver({ kind: 'right' }), 50, 'ar')).toBe('بعد 50 مترًا، انعطف يمينًا.');
    expect(spokenDistance(10, 'ar')).toBe('10 أمتار');
    expect(spokenDistance(200, 'ar')).toBe('200 متر');
    expect(spokenDistance(150, 'ar')).toBe('150 مترًا');
    expect(spokenDistance(1000, 'ar')).toBe('كيلومتر واحد');
    expect(spokenDistance(2000, 'ar')).toBe('كيلومترين');
    expect(approachPhrase(maneuver({ kind: 'left', street: 'شارع القدس' }), 100, 'ar')).toBe(
      'بعد 100 متر، انعطف يسارًا إلى شارع القدس.',
    );
    expect(arrivedPhrase('right', 'ar')).toBe('لقد وصلت إلى وجهتك، على يمينك.');
  });

  it('chains a close follow-up maneuver', () => {
    expect(actionPhrase(maneuver({ kind: 'right' }), 'en', maneuver({ kind: 'left' }))).toBe('Turn right, then turn left.');
    expect(actionPhrase(maneuver({ kind: 'right' }), 'ar', maneuver({ kind: 'left' }))).toBe('انعطف يمينًا، ثم انعطف يسارًا.');
  });

  it('describes roundabout exits by ordinal', () => {
    expect(maneuverInstruction(maneuver({ kind: 'roundabout', exit: 3 }), 'en')).toBe('At the roundabout, take the third exit');
    expect(maneuverInstruction(maneuver({ kind: 'roundabout', exit: 2 }), 'ar')).toBe('عند الدوّار، اسلك المخرج الثاني');
  });

  it('keeps the part of a bilingual OSM name written in the guidance language', () => {
    expect(localizedStreet('Al-Teereh St. شارع الطيرة', 'ar')).toBe('شارع الطيرة');
    expect(localizedStreet('Al-Teereh St. شارع الطيرة', 'en')).toBe('Al-Teereh St.');
    expect(approachPhrase(maneuver({ kind: 'right', street: 'Al-Teereh St. شارع الطيرة' }), 90, 'en')).toBe(
      'In 90 meters, turn right onto Al-Teereh St.',
    );
    expect(actionPhrase(maneuver({ kind: 'right', street: 'Al-Teereh St.' }), 'en', maneuver({ kind: 'left' }))).toBe(
      'Turn right onto Al-Teereh St., then turn left.',
    );
    expect(localizedStreet('شارع القدس', 'en')).toBe('شارع القدس');
    expect(approachPhrase(maneuver({ kind: 'left', street: 'Al-Teereh St. شارع الطيرة' }), 90, 'ar')).toBe(
      'بعد 90 مترًا، انعطف يسارًا إلى شارع الطيرة.',
    );
  });

  it('only speaks street names the voice can pronounce', () => {
    expect(speakableStreet('شارع القدس', 'ar')).toBe('شارع القدس');
    expect(speakableStreet('Al-Masaref', 'ar')).toBe('');
    expect(speakableStreet('Al-Masaref', 'en')).toBe('Al-Masaref');
    expect(speakableStreet('شارع القدس', 'en')).toBe('');
    // The screen still shows the name.
    expect(maneuverInstruction(maneuver({ kind: 'left' }), 'ar', 'Al-Masaref')).toBe('انعطف يسارًا إلى Al-Masaref');
  });

  it('formats compact card distances', () => {
    expect(displayDistance(47, 'en')).toEqual({ value: '45', unit: 'm' });
    expect(displayDistance(347, 'ar')).toEqual({ value: '350', unit: 'م' });
    expect(displayDistance(1260, 'ar')).toEqual({ value: '1.3', unit: 'كم' });
  });
});
