import { useLocalSearchParams } from 'expo-router';
import { CheckpointLiveDetails } from '@/components/map/CheckpointLiveDetails';
import { CommunityFreshness } from '@/components/map/CommunityFreshness';
import { useCheckpointConnectionStore } from '@/store/checkpointConnectionStore';
import { useState } from 'react';
import { View } from 'react-native';

import {
  AppHeader,
  AppText,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  PressableScale,
  Screen,
  SectionHeader,
  Skeleton,
  StatusBadge,
} from '@/components/ui';
import { CheckpointIcon, checkpointColor, checkpointDisplayStatus } from '@/components/map/CheckpointMarker';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/spacing';
import { radius } from '@/theme/radius';
import { useLocale } from '@/hooks/useLocale';
import { useCheckpoints, useRoadFeed } from '@/hooks/useCommunity';
import type { CheckpointStatus } from '@/types';
import { haptics } from '@/utils/haptics';

const STATUS_TONE = { open: 'success', congested: 'warning', severe: 'warning', closed: 'danger', unknown: 'neutral', conflicting: 'warning' } as const;
const SEVERITY: Record<CheckpointStatus, number> = { closed: 0, severe: 1, congested: 2, conflicting: 3, unknown: 4, open: 5 };

const minutesSince = (iso: string) =>
  Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));

/** Road alerts — live checkpoint status from one-tap driver reports. */
export default function RoadAlertsScreen() {
  const { colors } = useTheme();
  const { t, row, locale } = useLocale();
  const { data: checkpoints, isPending, isError, error, refetch, dataUpdatedAt } = useCheckpoints();
  const { data: feed = [] } = useRoadFeed();
  const connected = useCheckpointConnectionStore(state=>state.connected);
  const params = useLocalSearchParams<{checkpointId?:string}>();

  const [expanded, setExpanded] = useState<string | undefined>(params.checkpointId);

  const nameOf = (c: { nameAr: string; nameEn: string }) => (locale === 'ar' ? c.nameAr : c.nameEn);
  const ago = (minutes: number) => (minutes < 1 ? t('roads.justNow') : t('roads.minutesAgo', { minutes }));

  const sorted = [...(checkpoints ?? [])].sort(
    (a, b) => Number(a.assumed) - Number(b.assumed) || SEVERITY[a.status] - SEVERITY[b.status],
  );

  return (
    <Screen bottomInset={spacing.lg}>
      <AppHeader title={t('roads.title')} subtitle={t('roads.community')} />

      <View style={{ gap: spacing.xl }}>
        <CommunityFreshness connected={connected && !isError} updatedAt={dataUpdatedAt || undefined} showSource={false} />
        {/* ---- Checkpoints ---------------------------------------------- */}
        <View>
          <SectionHeader title={t('roads.checkpoints')} subtitle={t('roads.reportPrompt')} />
          {isError && !checkpoints ? (
            <ErrorState error={error} onRetry={() => void refetch()} />
          ) : isPending ? (
            <Skeleton height={320} radiusToken="xl" />
          ) : (
            <Card padding="lg" style={{ paddingVertical: spacing.xs }}>
              {sorted.length === 0 ? <EmptyState compact title={t('roads.noLocations')} /> : null}
              {sorted.map((checkpoint, index) => {
                const displayStatus = checkpointDisplayStatus(checkpoint.directions, checkpoint.status);
                const color = checkpointColor(displayStatus, checkpoint.assumed, colors);
                const open = expanded === checkpoint.id;
                return (
                  <View key={checkpoint.id}>
                    {index > 0 ? <Divider /> : null}
                    <View style={{ paddingVertical: spacing.md, gap: spacing.md }}>
                      <PressableScale
                        onPress={() => {
                          haptics.select();
                          setExpanded(open ? undefined : checkpoint.id);
                        }}
                        scaleTo={0.99}
                        accessibilityRole="button"
                        accessibilityState={{ expanded: open }}
                        accessibilityLabel={nameOf(checkpoint)}
                        style={{ flexDirection: row, alignItems: 'center', gap: spacing.md }}
                      >
                        <View
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: radius.md,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: colors.surfaceAlt,
                          }}
                        >
                          <CheckpointIcon status={displayStatus} color={color} size={18} />
                        </View>
                        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                          <AppText variant="title" numberOfLines={1}>
                            {nameOf(checkpoint)}
                          </AppText>
                          <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                            {t(checkpoint.kind==='road_gate'?'roads.roadGate':'roads.checkpointKind')}{' · '}
                            {checkpoint.directions?.length ? t('roads.community') : checkpoint.assumed
                              ? t(checkpoint.status==='conflicting'?'roads.conflicting':checkpoint.status==='unknown'?'roads.unknown':'roads.unconfirmed')
                              : t('roads.reportedAgo', {
                                  ago: ago(checkpoint.minutesSinceReport ?? 0),
                                  count: checkpoint.reportCount,
                                })}
                          </AppText>
                          {/* Entry and exit share one line, each led by its own status dot. */}
                          {checkpoint.directions?.length ? (
                            <View style={{ flexDirection: row, flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.md, rowGap: 2, marginTop: 2 }}>
                              {checkpoint.directions.map(passage => {
                                const passageColor = checkpointColor(passage.status, checkpoint.assumed, colors);
                                return (
                                  <View key={passage.id} style={{ flexDirection: row, alignItems: 'center', gap: 5 }}>
                                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: passageColor }} />
                                    <AppText variant="caption" style={{ color: passageColor }}>
                                      {t(passage.id === 'entrance' ? 'roads.entrance' : 'roads.exit')}: {t(`roads.status.${passage.status}`)}
                                    </AppText>
                                  </View>
                                );
                              })}
                            </View>
                          ) : null}
                        </View>
                        {/* Unreported checkpoints already say so in the line above. */}
                        {checkpoint.assumed ? null : (
                          <StatusBadge
                            label={t(`roads.status.${checkpoint.status}` as const)}
                            tone={STATUS_TONE[checkpoint.status]}
                            size="sm"
                          />
                        )}
                      </PressableScale>

                      <View style={{display:open?'flex':'none'}}>
                        <CheckpointLiveDetails checkpoint={checkpoint} />
                      </View>
                    </View>
                  </View>
                );
              })}
            </Card>
          )}
        </View>

        {/* ---- Latest reports ------------------------------------------- */}
        <View>
          <SectionHeader title={t('roads.feed')} />
          <Card padding="lg" style={{ paddingVertical: spacing.xs }}>
            {feed.length === 0 ? (
              <EmptyState compact title={t('roads.feedEmpty')} />
            ) : (
              feed.map((item, index) => (
                <View key={item.id}>
                  {index > 0 ? <Divider /> : null}
                  <View
                    style={{
                      flexDirection: row,
                      alignItems: 'center',
                      gap: spacing.sm,
                      paddingVertical: spacing.md,
                    }}
                  >
                    {/* A single report is evidence, not a confirmed status; keep it neutral. */}
                    <StatusBadge
                      label={t(`roads.status.${item.status}` as const)}
                      tone="neutral"
                      size="sm"
                    />
                    <AppText variant="bodySm" numberOfLines={1} style={{ flex: 1 }}>
                      {locale === 'ar' ? item.checkpointNameAr : item.checkpointNameEn}
                      {item.directionId === 'entrance' || item.directionId === 'exit'
                        ? ` / ${t(item.directionId === 'entrance' ? 'roads.entrance' : 'roads.exit')}`
                        : ''}
                    </AppText>
                    <AppText variant="caption" color="textTertiary">
                      {t('roads.unconfirmed')} · {ago(minutesSince(item.observedAt??item.reportedAt))}
                    </AppText>
                  </View>
                </View>
              ))
            )}
          </Card>
        </View>
      </View>
    </Screen>
  );
}
