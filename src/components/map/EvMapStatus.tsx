import { View } from 'react-native';
import { SlidersHorizontal } from 'lucide-react-native';
import { AppButton, AppText, PressableScale } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { useLocale } from '@/hooks/useLocale';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { MapStatusNote, MapStatusPanel, MapStatusRetry } from './MapStatusPanel';
import type { EvChargingStation, EvStationFilters } from '@/types';

export function EvMapStatus({
  loading,
  error,
  count,
  truncated,
  filters,
  stations = [],
  retry,
  onFilters,
  onSelectStation,
  compact = false,
}: {
  loading: boolean;
  error?: 'load' | 'zoom';
  count: number;
  truncated: boolean;
  filters: EvStationFilters;
  stations?: EvChargingStation[];
  retry: () => void;
  onFilters: () => void;
  onSelectStation?: (station: EvChargingStation) => void;
  compact?: boolean;
}) {
  const { t, row } = useLocale();
  const { colors } = useTheme();
  const active = Number(Boolean(filters.connectorType)) + Number(Boolean(filters.minPowerKw)) + Number(Boolean(filters.status));
  const previewStations = compact ? [] : stations.slice(0, 3);

  return (
    <MapStatusPanel
      loading={loading}
      headline={loading ? t('ev.loading') : t('ev.count', { count })}
      trailing={
        // Filters is a tool on this panel, so it takes the quiet chip form used in headers.
        <AppButton
          size="sm"
          fullWidth={false}
          variant="ghost"
          label={`${t('ev.filters')}${active ? ` · ${active}` : ''}`}
          icon={<SlidersHorizontal size={15} color={colors.textSecondary} strokeWidth={2.2} />}
          onPress={onFilters}
          style={{ minHeight: 36, paddingHorizontal: spacing.md, backgroundColor: colors.track }}
        />
      }
    >
      {previewStations.length > 0 ? (
        <View style={{ gap: spacing.xs + 2 }}>
          {previewStations.map((station) => (
            <PressableScale
              key={station.id}
              onPress={() => onSelectStation?.(station)}
              haptic="select"
              accessibilityRole="button"
              accessibilityLabel={station.name}
              style={{
                flexDirection: row,
                alignItems: 'center',
                gap: spacing.sm,
                paddingVertical: spacing.sm + 2,
                paddingHorizontal: spacing.md,
                borderRadius: radius.lg,
                backgroundColor: colors.background,
              }}
            >
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <AppText variant="label" numberOfLines={1}>{station.name}</AppText>
                <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                  {[station.address, t(`ev.status.${station.status}`)].filter(Boolean).join(' · ')}
                </AppText>
              </View>
              <AppText variant="label" color="brand">{t('ev.viewOnMap')}</AppText>
            </PressableScale>
          ))}
        </View>
      ) : null}
      {!compact && !loading && (error || count === 0 || truncated) ? (
        <>
          <MapStatusNote>{t(error === 'zoom' ? 'ev.zoom' : error === 'load' ? 'ev.failed' : truncated ? 'ev.truncated' : 'ev.empty')}</MapStatusNote>
          {error !== 'zoom' ? <MapStatusRetry label={t('ev.retry')} onPress={retry} /> : null}
        </>
      ) : null}
    </MapStatusPanel>
  );
}
