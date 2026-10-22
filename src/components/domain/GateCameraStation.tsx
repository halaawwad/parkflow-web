import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pause, Play } from 'lucide-react-native';

import { AppButton, AppText, Card, InlineNotice, Segmented, StatusBadge } from '@/components/ui';
import { PlateBadge } from '@/components/domain/PlateBadge';
import { CameraFeed, type CameraFeedHandle, type CameraStatus } from '@/components/domain/CameraFeed';
import { services } from '@/services';
import { useLocale } from '@/hooks/useLocale';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/spacing';
import { radius } from '@/theme/radius';
import { errorMessage } from '@/utils/errors';
import type { GateDirection, GateFrameResult } from '@/types';

/** Gap between frames once the previous one was answered. */
const FRAME_GAP_MS = 350;
/** Retry delays after errors grow to this. */
const MAX_BACKOFF_MS = 10_000;
/** A lost camera is reopened after this long. */
const RECONNECT_MS = 3_000;

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/**
 * Turns this browser or phone into the lot's unattended entry or exit camera. It
 * sends frames continuously; the server accepts a plate only when several frames
 * agree, records the entry or exit, and updates occupancy. Nobody needs to tap
 * anything — the owner just watches.
 */
export function GateCameraStation({ zoneId }: { zoneId: string }) {
  const { t, row } = useLocale();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const feed = useRef<CameraFeedHandle>(null);
  const [direction, setDirection] = useState<GateDirection>('entry');
  const [running, setRunning] = useState(true);
  const [camera, setCamera] = useState<CameraStatus>({ state: 'starting' });
  const [attempt, setAttempt] = useState(0);
  const [last, setLast] = useState<GateFrameResult>();
  const [lastPlate, setLastPlate] = useState<string>();
  const [error, setError] = useState<string>();
  const station = useMutation({ mutationFn: (d: GateDirection) => services.gates.station(zoneId, d) });
  const { mutate: openStation } = station;
  const deviceId = station.data?.direction === direction ? station.data.id : undefined;

  useEffect(() => { openStation(direction); }, [zoneId, direction, openStation]);

  // A disconnected camera is reopened by itself.
  useEffect(() => {
    if (!running || camera.state !== 'error' || camera.detail === 'permission' || camera.detail === 'no_camera') return;
    const timer = setTimeout(() => setAttempt((n) => n + 1), RECONNECT_MS);
    return () => clearTimeout(timer);
  }, [running, camera]);

  const onStatus = useCallback((status: CameraStatus) => setCamera(status), []);

  // One frame at a time, forever, until stopped. Errors back off; nothing is recorded on errors.
  useEffect(() => {
    if (!running || camera.state !== 'live' || !deviceId) return;
    let cancelled = false;
    (async () => {
      let failures = 0;
      while (!cancelled) {
        const started = Date.now();
        try {
          const shot = await feed.current?.capture();
          if (shot && !cancelled) {
            const result = await services.gates.sendFrame(deviceId, shot);
            if (cancelled) break;
            failures = 0;
            setError(undefined);
            setLast(result);
            if (result.plateNumber) setLastPlate(result.plateNumber);
            if (result.event) {
              void queryClient.invalidateQueries({ queryKey: ['gate-live'] });
              void queryClient.invalidateQueries({ queryKey: ['gate-occupancy'] });
              void queryClient.invalidateQueries({ queryKey: ['gate-visits'] });
            }
          }
        } catch (e) {
          failures += 1;
          if (!cancelled) setError(errorMessage(e));
        }
        const wait = failures ? Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (failures - 1)) : Math.max(0, FRAME_GAP_MS - (Date.now() - started));
        await sleep(wait);
      }
    })();
    return () => { cancelled = true; };
  }, [running, camera.state, deviceId, queryClient]);

  const live = running && camera.state === 'live' && Boolean(deviceId);
  const stateText = !running ? t('smartGate.auto.stopped')
    : camera.state === 'error' ? t(`smartGate.auto.camera.${camera.detail ?? 'unavailable'}` as 'smartGate.auto.camera.unavailable')
    : camera.state === 'starting' || !deviceId ? t('smartGate.auto.starting')
    : error ? t('smartGate.auto.retrying')
    : last?.state === 'tracking' && last.leading ? t('smartGate.auto.tracking', { plate: last.leading, votes: last.votes, needed: last.needed })
    : last?.state === 'tracking' ? t('smartGate.auto.reading')
    : t('smartGate.auto.watching');
  const event = last?.event;

  return (
    <Card padding="lg" style={{ gap: spacing.md }}>
      <View style={{ flexDirection: row, alignItems: 'center', gap: spacing.sm }}>
        <AppText variant="title" style={{ flex: 1 }}>{t('smartGate.auto.title')}</AppText>
        <StatusBadge label={live && !error ? t('smartGate.auto.live') : t('smartGate.auto.notLive')} tone={live && !error ? 'success' : running ? 'warning' : 'neutral'} />
      </View>
      <Segmented variant="inset" value={direction} onChange={(d) => { setLast(undefined); setDirection(d); }} options={[
        { value: 'entry', label: t('smartGate.auto.entryCamera') }, { value: 'exit', label: t('smartGate.auto.exitCamera') },
      ]} />
      <AppText variant="caption" color="textTertiary">{direction === 'entry' ? t('smartGate.auto.entryNote') : t('smartGate.auto.exitNote')}</AppText>

      <View style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: colors.deep, alignItems: 'center', justifyContent: 'center' }}>
        <CameraFeed key={attempt} ref={feed} active={running} onStatus={onStatus} />
        <View pointerEvents="none" style={{ position: 'absolute', bottom: spacing.md, left: spacing.md, right: spacing.md, flexDirection: row, justifyContent: 'space-between', gap: spacing.sm }}>
          <View style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: 'rgba(0,0,0,0.6)', flexShrink: 1 }}>
            <AppText variant="caption" color="onDeep" numberOfLines={1}>{stateText}</AppText>
          </View>
          {camera.resolution ? (
            <View style={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: 'rgba(0,0,0,0.6)' }}>
              <AppText variant="caption" color="onDeepMuted" numeric>{camera.resolution}</AppText>
            </View>
          ) : null}
        </View>
      </View>

      {error ? <InlineNotice tone="warning" title={t('smartGate.auto.errorTitle')} body={error} /> : null}
      {camera.state === 'error' && (camera.detail === 'permission' || camera.detail === 'no_camera') ? (
        <InlineNotice tone="danger" title={t(`smartGate.auto.camera.${camera.detail}`)} action={{ label: t('smartGate.auto.tryAgain'), onPress: () => setAttempt((n) => n + 1) }} />
      ) : null}

      <View style={{ flexDirection: row, alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
        <AppText variant="label" color="textSecondary">{t('smartGate.auto.lastPlate')}</AppText>
        {lastPlate ? <PlateBadge plateNumber={lastPlate} /> : <AppText variant="bodySm" color="textTertiary">—</AppText>}
      </View>
      {event ? (
        <InlineNotice tone={event.outcome === 'entry' || event.outcome === 'exit' ? 'success' : event.needsReview ? 'warning' : 'info'}
          title={`${event.plateNumber ?? event.reading ?? ''} · ${t(`smartGate.outcome.${event.outcome}`)}`} />
      ) : null}

      <AppButton size="sm" variant="secondary" fullWidth={false} label={running ? t('smartGate.auto.stop') : t('smartGate.auto.start')}
        icon={running ? <Pause size={16} color={colors.text} /> : <Play size={16} color={colors.text} />}
        onPress={() => { setLast(undefined); setError(undefined); setRunning((r) => !r); }} />
    </Card>
  );
}
