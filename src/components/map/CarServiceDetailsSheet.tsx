import { useState } from 'react';
import { Linking, ScrollView } from 'react-native';
import { BottomSheet } from '@/components/ui';
import { useLocale } from '@/hooks/useLocale';
import type { CarServiceBusiness } from '@/types';
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

const pricingText = (value: unknown): string | undefined => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
};

export function CarServiceDetailsSheet({
  service,
  onClose,
  onRoute,
}: {
  service?: CarServiceBusiness;
  onClose: () => void;
  onRoute: (service: CarServiceBusiness) => void;
}) {
  const { t, locale, dateLocale } = useLocale();
  const [linkError, setLinkError] = useState(false);
  const name = service ? (locale === 'ar' ? service.nameAr : service.nameEn) : undefined;
  const address = service ? (locale === 'ar' ? service.addressAr : service.addressEn) : undefined;
  const services = service ? (locale === 'ar' ? service.servicesAr : service.servicesEn) : [];
  const coordinateNote = service ? (locale === 'ar' ? service.coordinateNoteAr : service.coordinateNoteEn) : undefined;
  const phone = safePhone(service?.phone);
  const website = safeUrl(service?.website);
  const source = safeUrl(service?.sourceUrl);
  const secondarySource = safeUrl(service?.secondarySourceUrl);
  const price = pricingText(service?.pricing);
  const open = async (url: string) => {
    setLinkError(false);
    try {
      await Linking.openURL(url);
    } catch {
      setLinkError(true);
    }
  };
  const rows = service ? [
    [t('carServices.categories'), service.categories.map((category) => t(`carServices.category.${category}`)).join(' · ')],
    [t('carServices.address'), address],
    [t('carServices.phone'), service.phone],
    [t('carServices.hours'), service.openingHoursText],
    [t('carServices.services'), services.join(' · ')],
    [t('carServices.pricing'), price ?? t('carServices.pricingUnavailable')],
    [t('carServices.source'), service.sourceName],
    [t('carServices.lastChecked'), new Date(service.lastCheckedAt).toLocaleDateString(dateLocale)],
  ] : [];
  return <BottomSheet visible={Boolean(service)} onClose={onClose} title={name} subtitle={t('carServices.details')}>
    {service ? <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ gap: spacing.md }} showsVerticalScrollIndicator={false}>
      <DetailList rows={rows as DetailRow[]} />
      {coordinateNote ? <DetailCaveat title={t('carServices.coordinateWarning')} body={coordinateNote} /> : null}
      <DetailNote>{t('carServices.disclaimer')}</DetailNote>
      {linkError ? <DetailNote tone="danger">{t('carServices.linkFailed')}</DetailNote> : null}
      <DetailActions
        routeLabel={t('carServices.route')}
        onRoute={() => onRoute(service)}
        links={[
          ...(phone ? [{ key: 'call', label: t('carServices.call'), onPress: () => void open(`tel:${phone}`) }] : []),
          ...(website ? [{ key: 'website', label: t('carServices.website'), onPress: () => void open(website) }] : []),
          ...(source ? [{ key: 'source', label: t('carServices.openSource'), onPress: () => void open(source) }] : []),
          ...(secondarySource ? [{ key: 'source2', label: t('carServices.openSecondarySource'), onPress: () => void open(secondarySource) }] : []),
        ]}
        closeLabel={t('carServices.close')}
        onClose={onClose}
      />
    </ScrollView> : null}
  </BottomSheet>;
}
