import { describe, expect, it } from 'vitest';
import { withReadableArabic } from '../src/modules/wallet/arabicTitles';

describe('ledger Arabic titles', () => {
  it('substitutes Arabic for rows saved as question marks', () => {
    expect(withReadableArabic({ title: 'Wallet Top-up', titleAr: '??? ???????', subtitle: null, subtitleAr: null }).titleAr).toBe('شحن المحفظة');
    expect(withReadableArabic({ title: 'Parking', titleAr: '????', subtitle: 'Zone A', subtitleAr: '?? ?' })).toMatchObject({ titleAr: 'وقوف', subtitleAr: 'Zone A' });
    // An unknown title falls back to the English rather than showing "???".
    expect(withReadableArabic({ title: 'Something new', titleAr: '???' }).titleAr).toBe('Something new');
  });

  it('leaves readable rows untouched', () => {
    const row = { title: 'Points reward', titleAr: 'مكافأة نقاط', subtitle: null, subtitleAr: null };
    expect(withReadableArabic(row)).toBe(row);
  });
});
