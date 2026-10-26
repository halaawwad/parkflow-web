import { useState } from 'react';
import { Linking, ScrollView } from 'react-native';
import { BottomSheet } from '@/components/ui';
import { useLocale } from '@/hooks/useLocale';
import type { TourismPlace } from '@/types';
import { spacing } from '@/theme/spacing';
import { DetailActions, DetailCaveat, DetailList, DetailNote, type DetailRow } from './PlaceDetails';

function safeUrl(value?: string): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch {
    return;
  }
}

const safePhone = (value?: string): string | undefined => {
  const digits = value?.replace(/\D/g, '').length ?? 0;
  return value && /^\+?[0-9][0-9 ()-]{4,30}[0-9]$/.test(value) && digits >= 7 && digits <= 15
    ? value.replace(/[ ()-]/g, '')
    : undefined;
};

export function TourismPlaceDetailsSheet({
  place,
  onClose,
  onRoute,
}: {
  place?: TourismPlace;
  onClose: () => void;
  onRoute: (place: TourismPlace) => void;
}) {
  const { t, locale, dateLocale } = useLocale();
  const [linkError, setLinkError] = useState(false);
  const name = place ? (locale === 'ar' ? place.nameAr : place.nameEn) : undefined;
  const description = place?.descriptionAr;
  const locationNote = place?.locationNoteAr;
  const phone = safePhone(place?.phone);
  const website = safeUrl(place?.website);
  const sourceLinks = place?.sources.map((source) => ({ ...source, href: safeUrl(source.url) })).filter((source) => source.href) ?? [];
  const open = async (url: string) => {
    setLinkError(false);
    try {
      await Linking.openURL(url);
    } catch {
      setLinkError(true);
    }
  };
  const rows = place ? [
    [t('tourism.categories'), place.categories.map((category) => t(`tourism.category.${category}`)).join(' · ')],
    [t('tourism.description'), description],
    [t('tourism.city'), place.cityAr],
    [t('tourism.region'), place.regionAr],
    [t('tourism.address'), place.addressAr],
    [t('tourism.phone'), place.phone],
    [t('tourism.source'), sourceLinks.map((source) => source.publisher).join(' · ')],
    [t('tourism.lastChecked'), new Date(place.sourcesCheckedOn).toLocaleDateString(dateLocale)],
  ] : [];
  return <BottomSheet visible={Boolean(place)} onClose={onClose} title={name} subtitle={t('tourism.details')}>
    {place ? <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ gap: spacing.md }} showsVerticalScrollIndicator={false}>
      <DetailList rows={rows as DetailRow[]} />
      {locationNote ? <DetailCaveat title={t('tourism.coordinateWarning')} body={locationNote} /> : null}
      <DetailNote>{t('tourism.entranceDisclaimer')}</DetailNote>
      <DetailNote>{t('tourism.disclaimer')}</DetailNote>
      {linkError ? <DetailNote tone="danger">{t('tourism.linkFailed')}</DetailNote> : null}
      <DetailActions
        routeLabel={t('tourism.route')}
        onRoute={() => onRoute(place)}
        links={[
          ...(phone ? [{ key: 'call', label: t('tourism.call'), onPress: () => void open(`tel:${phone}`) }] : []),
          ...(website ? [{ key: 'website', label: t('tourism.website'), onPress: () => void open(website) }] : []),
          ...sourceLinks.map((source, index) => ({
            key: `${source.url}-${index}`,
            label: index === 0 ? t('tourism.openSource') : t('tourism.openSourceNumber', { count: index + 1 }),
            onPress: () => void open(source.href!),
          })),
        ]}
        closeLabel={t('tourism.close')}
        onClose={onClose}
      />
    </ScrollView> : null}
  </BottomSheet>;
}
