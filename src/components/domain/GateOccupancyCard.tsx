import { View } from 'react-native';
import { AppText, Card, Skeleton, StatusBadge } from '@/components/ui';
import { useLocale } from '@/hooks/useLocale';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/spacing';
import { radius } from '@/theme/radius';
import type { BadgeTone } from '@/components/ui/StatusBadge';
import type { GateOccupancy } from '@/types';

const TONE: Record<GateOccupancy['status'], BadgeTone> = { available: 'success', limited: 'warning', full: 'danger', unknown: 'neutral' };

/** "13 / 20" for the lot, counted from SmartGate entries and exits only. */
export function GateOccupancyCard({ occupancy, loading }: { occupancy?: GateOccupancy; loading?: boolean }) {
  const { t, row } = useLocale();
  const { colors } = useTheme();
  if (loading || !occupancy) return <Skeleton height={148} radiusToken="xl" />;
  const { capacity, inside, available, status } = occupancy;
  const share = capacity ? Math.min(1, inside / capacity) : 0;
  const fill = status === 'full' ? colors.danger : status === 'limited' ? colors.warning : colors.success;
  return (
    <Card padding="lg" style={{ gap: spacing.md }}>
      <View style={{ flexDirection: row, alignItems: 'center', gap: spacing.sm }}>
        <AppText variant="title" style={{ flex: 1 }}>{t('smartGate.occupancy')}</AppText>
        <StatusBadge label={t(`smartGate.status.${status}`)} tone={TONE[status]} />
      </View>
      <View style={{ flexDirection: row, alignItems: 'baseline', gap: spacing.sm }}>
        <AppText variant="display" numeric>{inside}</AppText>
        <AppText variant="h3" color="textSecondary" numeric>/ {capacity ?? '—'}</AppText>
        <View style={{ flex: 1 }} />
        {available !== null ? <AppText variant="label" color="textSecondary">{t('smartGate.available', { count: available })}</AppText> : null}
      </View>
      {capacity ? (
        <View style={{ height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, overflow: 'hidden' }}>
          <View style={{ width: `${share * 100}%`, height: '100%', backgroundColor: fill }} />
        </View>
      ) : null}
      <AppText variant="caption" color="textSecondary">
        {t('smartGate.breakdown', { registered: occupancy.registeredInside, unregistered: occupancy.unregisteredInside })}
      </AppText>
      <AppText variant="caption" color="textTertiary">{capacity ? t('smartGate.trackedNote') : t('smartGate.noCapacity')}</AppText>
    </Card>
  );
}
