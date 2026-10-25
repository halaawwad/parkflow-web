/**
 * Ledger rows posted before the Arabic titles were restored in the source were
 * saved as "???". The ledger is immutable, so the Arabic is substituted when
 * the rows are read instead of rewriting them.
 */

const TITLES_AR: Record<string, string> = {
  'Wallet Top-up': 'شحن المحفظة',
  Parking: 'وقوف',
  'Points reward': 'مكافأة نقاط',
  'Ride booking': 'حجز رحلة',
  'Ride refund': 'استرداد رحلة',
  'Ride earnings': 'أرباح رحلة',
  'Private parking booking': 'حجز موقف خاص',
  'Parking spot refund': 'استرداد موقف خاص',
  'Parking spot earnings': 'أرباح الموقف الخاص',
};

const corrupted = (text: string | null | undefined): text is string => typeof text === 'string' && /^[?\s.]+$/.test(text);

export function withReadableArabic<T extends { title: string; titleAr: string; subtitle?: string | null; subtitleAr?: string | null }>(row: T): T {
  if (!corrupted(row.titleAr) && !corrupted(row.subtitleAr)) return row;
  return {
    ...row,
    titleAr: corrupted(row.titleAr) ? TITLES_AR[row.title] ?? row.title : row.titleAr,
    subtitleAr: corrupted(row.subtitleAr) ? row.subtitle ?? null : row.subtitleAr,
  };
}
