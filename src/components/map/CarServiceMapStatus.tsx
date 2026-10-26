import { useRouter } from 'expo-router';
import { AppText, Card } from '@/components/ui';
import { useLocale } from '@/hooks/useLocale';
import { MapStatusNameList, MapStatusNote, MapStatusPanel, MapStatusRetry } from './MapStatusPanel';
import type { CarServiceBusiness, CarServiceCategory } from '@/types';

export function CarServiceMapStatus({
  loading,
  error,
  errorMessage,
  count,
  services,
  truncated,
  category,
  retry,
  compact = false,
}: {
  loading: boolean;
  error?: 'load' | 'zoom';
  errorMessage?: string;
  count: number;
  services: CarServiceBusiness[];
  truncated: boolean;
  category: CarServiceCategory;
  retry: () => void;
  compact?: boolean;
}) {
  const { locale, t } = useLocale();
  const router = useRouter();
  const preview = services.slice(0, 4);
  const remaining = Math.max(0, count - preview.length);
  return (
    <MapStatusPanel
      loading={loading}
      headline={loading ? t('carServices.loading') : t('carServices.count', { count, category: t(`carServices.category.${category}`) })}
    >
      <Card padding="md" tone="brand" accessibilityLabel={t('warning.entry')} onPress={() => router.push('/vehicles/warning-check')} style={{ gap: 2 }}>
        <AppText variant="label" color="successText">{t('warning.entry')}</AppText>
        {!compact ? <AppText variant="caption" color="textSecondary">{t('warning.entryBody')}</AppText> : null}
      </Card>
      {!compact && !loading && !error && count > 0 ? (
        <MapStatusNameList
          basis={t('carServices.basis')}
          names={preview.map((service) => (locale === 'ar' ? service.nameAr : service.nameEn))}
          more={remaining > 0 ? t('carServices.more', { count: remaining }) : undefined}
        />
      ) : null}
      {!compact && !loading && (error || count === 0 || truncated) ? (
        <>
          <MapStatusNote>{t(error === 'zoom' ? 'carServices.zoom' : error === 'load' ? 'carServices.failed' : truncated ? 'carServices.truncated' : 'carServices.empty')}</MapStatusNote>
          {error === 'load' && errorMessage ? <MapStatusNote>{errorMessage}</MapStatusNote> : null}
          {error !== 'zoom' ? <MapStatusRetry label={t('carServices.retry')} onPress={retry} /> : null}
        </>
      ) : null}
    </MapStatusPanel>
  );
}
