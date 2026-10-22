import { View } from 'react-native';
import { AppButton, AppText, Card, Divider, SkeletonGroup, StatusBadge } from '@/components/ui';
import { useGateLive, useMarkReviewed } from '@/hooks/useGates';
import { useLocale } from '@/hooks/useLocale';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/spacing';
import { formatTime } from '@/utils/time';
import type { BadgeTone } from '@/components/ui/StatusBadge';
import type { GateEvent, GateOutcome } from '@/types';

const TONE: Record<GateOutcome, BadgeTone> = {
  entry: 'success', exit: 'success', already_inside: 'neutral', not_inside: 'warning', too_soon: 'warning', review: 'warning', error: 'danger',
};

/** What the automatic cameras are doing: their status and every event, refreshed every few seconds. */
export function GateLiveEvents({ zoneId }: { zoneId: string }) {
  const { t, row, dateLocale } = useLocale();
  const { colors } = useTheme();
  const live = useGateLive(zoneId);
  const review = useMarkReviewed();
  if (live.isPending) return <SkeletonGroup count={2} height={64} />;
  const cameras = live.data?.cameras ?? [];
  const events = live.data?.events ?? [];
  const attention = events.filter((e) => e.needsReview);

  const line = (e: GateEvent) => [
    `${formatTime(e.createdAt, dateLocale)} · ${t(`smartGate.auto.${e.direction}Camera`)}`,
    e.frames ? t('smartGate.auto.frames', { count: e.frames }) : undefined,
    e.message,
  ].filter(Boolean).join(' · ');

  return (
    <>
      <Card padding="lg" style={{ gap: spacing.sm }}>
        <AppText variant="title">{t('smartGate.auto.cameras')}</AppText>
        {cameras.length === 0 ? <AppText variant="bodySm" color="textSecondary">{t('smartGate.auto.noCameras')}</AppText> : cameras.map((c, i) => (
          <View key={c.id} style={{ gap: 2 }}>
            {i ? <Divider /> : null}
            <View style={{ flexDirection: row, alignItems: 'center', gap: spacing.sm, paddingTop: i ? spacing.sm : 0 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.online ? colors.success : colors.textTertiary }} />
              <AppText variant="label" style={{ flex: 1 }}>{c.name}</AppText>
              <AppText variant="caption" color="textSecondary">{c.online ? t('smartGate.auto.online') : t('smartGate.auto.offline')}</AppText>
            </View>
            <AppText variant="caption" color="textSecondary">
              {[c.lastPlate ? t('smartGate.auto.lastRead', { plate: c.lastPlate }) : undefined, c.lastSeenAt ? t('smartGate.auto.seenAt', { time: formatTime(c.lastSeenAt, dateLocale) }) : undefined].filter(Boolean).join(' · ')}
            </AppText>
            {c.lastError ? <AppText variant="caption" color="danger">{c.lastError}</AppText> : null}
          </View>
        ))}
      </Card>

      {attention.length ? (
        <Card padding="lg" style={{ gap: spacing.sm }}>
          <AppText variant="title">{t('smartGate.auto.needsReview', { count: attention.length })}</AppText>
          <AppText variant="caption" color="textTertiary">{t('smartGate.auto.reviewNote')}</AppText>
          {attention.map((e, i) => (
            <View key={e.id} style={{ gap: spacing.xs }}>
              {i ? <Divider /> : null}
              <View style={{ flexDirection: row, alignItems: 'center', gap: spacing.sm, paddingTop: i ? spacing.sm : 0 }}>
                <AppText variant="titleLg" numeric style={{ flex: 1 }}>{e.plateNumber ?? e.reading ?? '—'}</AppText>
                <StatusBadge label={t(`smartGate.outcome.${e.outcome}`)} tone={TONE[e.outcome]} size="sm" />
              </View>
              <AppText variant="caption" color="textSecondary">{line(e)}</AppText>
              <AppButton size="sm" variant="ghost" fullWidth={false} label={t('smartGate.auto.markReviewed')}
                loading={review.isPending && review.variables === e.id} onPress={() => review.mutate(e.id)} />
            </View>
          ))}
        </Card>
      ) : null}

      <Card padding="lg" tone="outline" style={{ gap: spacing.sm }}>
        <AppText variant="title">{t('smartGate.auto.events')}</AppText>
        {events.length === 0 ? <AppText variant="bodySm" color="textSecondary">{t('smartGate.auto.noEvents')}</AppText> : events.slice(0, 20).map((e, i) => (
          <View key={e.id} style={{ gap: 2 }}>
            {i ? <Divider /> : null}
            <View style={{ flexDirection: row, alignItems: 'center', gap: spacing.sm, paddingTop: i ? spacing.sm : 0 }}>
              <AppText variant="title" numeric style={{ flex: 1 }}>{e.plateNumber ?? e.reading ?? '—'}</AppText>
              <StatusBadge label={t(`smartGate.outcome.${e.outcome}`)} tone={TONE[e.outcome]} size="sm" />
            </View>
            <AppText variant="caption" color="textSecondary">{line(e)}</AppText>
          </View>
        ))}
      </Card>
    </>
  );
}
