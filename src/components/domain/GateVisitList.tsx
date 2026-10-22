import { View } from 'react-native';
import { AppText, Card, Divider, SkeletonGroup, StatusBadge } from '@/components/ui';
import { useLocale } from '@/hooks/useLocale';
import { spacing } from '@/theme/spacing';
import { formatMoney } from '@/utils/money';
import { formatTime } from '@/utils/time';
import type { BadgeTone } from '@/components/ui/StatusBadge';
import type { ParkingVisit, VisitStatus } from '@/types';

const STATUS_TONE: Record<VisitStatus, BadgeTone> = { covered: 'success', grace: 'warning', overstaying: 'danger', unregistered: 'neutral', left: 'neutral' };

/** Cars inside a lot and those that left recently, as the gate recorded them. */
export function GateVisitList({ visits, loading, onSelect }: { visits?: ParkingVisit[]; loading: boolean; onSelect?: (visit: ParkingVisit) => void }) {
  const { t, row, dateLocale } = useLocale();
  if (loading) return <SkeletonGroup count={3} height={64} />;
  const inside = (visits ?? []).filter((v) => v.status !== 'left');
  const left = (visits ?? []).filter((v) => v.status === 'left');
  const line = (v: ParkingVisit) => [
    `${t('gate.entered')} ${formatTime(v.enteredAt, dateLocale)}`,
    v.exitedAt ? `${t('gate.left')} ${formatTime(v.exitedAt, dateLocale)}` : undefined,
    v.paidUntil && v.status !== 'left' ? `${t('gate.paidUntil')} ${formatTime(v.paidUntil, dateLocale)}` : undefined,
    v.violationCount ? t('gate.violationsLine', { count: v.violationCount, total: formatMoney(v.violationTotal) }) : undefined,
  ].filter(Boolean).join(' · ');
  const list = (items: ParkingVisit[]) => items.map((v, index) => (
    <View key={v.id} style={{ gap: spacing.xs }}>
      {index ? <Divider /> : null}
      <View style={{ flexDirection: row, alignItems: 'center', gap: spacing.sm, paddingTop: index ? spacing.sm : 0 }}>
        <AppText variant="titleLg" numeric style={{ flex: 1 }} onPress={onSelect ? () => onSelect(v) : undefined}>{v.plateNumber}</AppText>
        {/* A car that left keeps its "not registered" mark, so the history stays readable. */}
        {!v.registered && v.status !== 'unregistered' ? <StatusBadge label={t('gate.status.unregistered')} tone="neutral" size="sm" showDot={false} /> : null}
        <StatusBadge label={t(`gate.status.${v.status}`)} tone={STATUS_TONE[v.status]} size="sm" />
      </View>
      <AppText variant="caption" color="textSecondary">{line(v)}</AppText>
    </View>
  ));
  return (
    <>
      <Card padding="lg" style={{ gap: spacing.sm }}>
        <AppText variant="title">{t('gate.inside', { count: inside.length })}</AppText>
        {inside.length ? list(inside) : <AppText variant="bodySm" color="textSecondary">{t('gate.nobodyInside')}</AppText>}
      </Card>
      {left.length ? (
        <Card padding="lg" tone="outline" style={{ gap: spacing.sm }}>
          <AppText variant="title">{t('gate.recentlyLeft')}</AppText>
          {list(left)}
        </Card>
      ) : null}
    </>
  );
}
