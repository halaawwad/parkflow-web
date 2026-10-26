import { useLocale } from '@/hooks/useLocale';
import { MapStatusNameList, MapStatusNote, MapStatusPanel, MapStatusRetry } from './MapStatusPanel';
import type { TourismPlace, TourismPlaceCategory } from '@/types';

export function TourismPlaceMapStatus({
  loading,
  error,
  errorMessage,
  count,
  places,
  truncated,
  categories,
  retry,
  compact = false,
}: {
  loading: boolean;
  error?: 'load' | 'zoom';
  errorMessage?: string;
  count: number;
  places: TourismPlace[];
  truncated: boolean;
  categories: TourismPlaceCategory[];
  retry: () => void;
  compact?: boolean;
}) {
  const { locale, t } = useLocale();
  const preview = places.slice(0, 4);
  const remaining = Math.max(0, count - preview.length);
  const categoryLabel = categories.length === 1 ? t(`tourism.category.${categories[0]}`) : t('tourism.allCategories');
  return (
    <MapStatusPanel
      loading={loading}
      headline={loading ? t('tourism.loading') : t('tourism.count', { count, category: categoryLabel })}
    >
      {!compact && !loading && !error && count > 0 ? (
        <MapStatusNameList
          basis={t('tourism.basis')}
          names={preview.map((place) => (locale === 'ar' ? place.nameAr : place.nameEn))}
          more={remaining > 0 ? t('tourism.more', { count: remaining }) : undefined}
        />
      ) : null}
      {!compact && !loading && (error || count === 0 || truncated) ? (
        <>
          <MapStatusNote>
            {t(error === 'zoom' ? 'tourism.zoom' : error === 'load' ? 'tourism.failed' : truncated ? 'tourism.truncated' : categories.length === 0 ? 'tourism.noFilters' : 'tourism.empty')}
          </MapStatusNote>
          {error === 'load' && errorMessage ? <MapStatusNote>{errorMessage}</MapStatusNote> : null}
          {error !== 'zoom' ? <MapStatusRetry label={t('tourism.retry')} onPress={retry} /> : null}
        </>
      ) : null}
    </MapStatusPanel>
  );
}
