import { memo, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, View } from 'react-native';
import {
  CircleCheck,
  CloudOff,
  ListOrdered,
  LocateFixed,
  MapPinOff,
  Pause,
  Play,
  RefreshCw,
  Repeat2,
  SatelliteDish,
  ShieldAlert,
  TriangleAlert,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppButton, AppText, BottomSheet, PressableScale, Reveal, SwitchRow } from '@/components/ui';
import { useLocale } from '@/hooks/useLocale';
import type { TurnByTurnNavigation } from '@/hooks/useTurnByTurnNavigation';
import type { TranslationKey } from '@/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { radius } from '@/theme/radius';
import { shadow } from '@/theme/shadows';
import { spacing } from '@/theme/spacing';
import { displayDistance, localizedStreet, maneuverInstruction, spokenDistance, type GuidanceLocale } from '@/utils/navigation/instructions';
import type { Maneuver } from '@/utils/navigation/maneuvers';
import { guidanceReliable } from '@/utils/navigation/session';
import { followingManeuver } from '@/utils/navigation/voiceScheduler';
import { ManeuverIcon } from './ManeuverIcon';

/**
 * Everything drawn over the map while turn-by-turn navigation runs: the
 * maneuver card, status banners, trip summary with controls, and the
 * arrival/error states. Built voice-first: every control has a large target and
 * a spoken label, and announcements are mirrored to a live region so screen
 * reader users hear guidance without looking at the map.
 */

const CONTROL_HEIGHT = 64;
const THEN_VISIBLE_METERS = 300;

function formatEta(seconds: number, dateLocale: string) {
  const eta = new Date(Date.now() + seconds * 1000);
  return new Intl.DateTimeFormat(dateLocale, { hour: 'numeric', minute: '2-digit' }).format(eta);
}

function formatDuration(seconds: number, t: (key: TranslationKey, params?: Record<string, string | number>) => string) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return t('nav.minutes', { minutes });
  return t('nav.hoursMinutes', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

const distanceText = (meters: number, locale: GuidanceLocale) => {
  const { value, unit } = displayDistance(meters, locale);
  return `${value} ${unit}`;
};

// ---------------------------------------------------------------------------

const GuidanceCard = memo(function GuidanceCard({
  maneuver,
  distance,
  then,
  reliable,
}: {
  maneuver: Maneuver;
  distance: number;
  then?: Maneuver;
  reliable: boolean;
}) {
  const { colors } = useTheme();
  const { t, locale, row } = useLocale();
  const { value, unit } = displayDistance(distance, locale);
  const instruction = maneuverInstruction(maneuver, locale, localizedStreet(maneuver.street, locale));

  return (
    <View
      testID="navigation-guidance-card"
      accessible
      accessibilityRole="header"
      // Screen readers get the spoken form ("90 مترًا"), not the abbreviation on the card ("90 م").
      accessibilityLabel={reliable ? t('nav.cardLabel', { distance: spokenDistance(distance, locale), instruction }) : instruction}
      style={[styles.card, { backgroundColor: colors.deep, opacity: reliable ? 1 : 0.62 }, shadow.lg]}
    >
      <View style={{ flexDirection: row, alignItems: 'center', gap: spacing.md, padding: spacing.lg }}>
        <View style={[styles.iconTile, { backgroundColor: 'rgba(255,255,255,0.13)' }]}>
          <ManeuverIcon kind={maneuver.kind} exit={maneuver.exit} size={54} color={colors.onDeep} ghostColor="rgba(255,255,255,0.32)" />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View style={{ flexDirection: row, alignItems: 'baseline', gap: 6 }}>
            <AppText numeric weight="bold" color="onDeep" style={styles.distanceValue}>
              {reliable ? value : '—'}
            </AppText>
            {reliable ? <AppText variant="titleLg" color="onDeepMuted">{unit}</AppText> : null}
          </View>
          <AppText variant="titleLg" color="onDeep" numberOfLines={2}>
            {instruction}
          </AppText>
        </View>
      </View>
      {then ? (
        <View style={[styles.thenStrip, { flexDirection: row, backgroundColor: 'rgba(0,0,0,0.16)' }]}>
          <AppText variant="label" color="onDeepMuted">{t('nav.then')}</AppText>
          <ManeuverIcon kind={then.kind} exit={then.exit} size={22} color={colors.onDeep} />
          <AppText variant="label" color="onDeep" numberOfLines={1} style={{ flex: 1 }}>
            {maneuverInstruction(then, locale, localizedStreet(then.street, locale))}
          </AppText>
        </View>
      ) : null}
    </View>
  );
});

type BannerTone = 'info' | 'warning' | 'danger';

function Banner({ tone, icon, text, onPress, busy }: { tone: BannerTone; icon: ReactNode; text: string; onPress?: () => void; busy?: boolean }) {
  const { colors } = useTheme();
  const { row } = useLocale();
  const background = tone === 'danger' ? colors.dangerSoft : tone === 'warning' ? colors.warningSoft : colors.infoSoft;
  const textColor = tone === 'danger' ? 'dangerText' : tone === 'warning' ? 'warningText' : 'infoText';
  const content = (
    <>
      {busy ? <ActivityIndicator size="small" color={colors[textColor]} /> : icon}
      <AppText variant="label" color={textColor} style={{ flex: 1 }}>{text}</AppText>
    </>
  );
  const style = [styles.banner, { flexDirection: row, backgroundColor: background }, shadow.sm];
  if (onPress) {
    return (
      <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={text} style={style}>
        {content}
      </PressableScale>
    );
  }
  return (
    <View accessible accessibilityRole="alert" accessibilityLabel={text} style={style}>
      {content}
    </View>
  );
}

function ControlButton({
  icon,
  label,
  accessibilityLabel,
  onPress,
  tone = 'neutral',
  selected,
  testID,
}: {
  icon: ReactNode;
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  tone?: 'neutral' | 'danger' | 'active';
  selected?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  const background = tone === 'danger' ? colors.dangerSoft : tone === 'active' ? colors.brandSoft : colors.surfaceAlt;
  return (
    <PressableScale
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={selected === undefined ? undefined : { selected }}
      style={[styles.control, { backgroundColor: background }]}
    >
      {icon}
      <AppText variant="caption" color={tone === 'danger' ? 'dangerText' : 'text'} numberOfLines={1}>
        {label}
      </AppText>
    </PressableScale>
  );
}

function Stat({ value, label, emphasis }: { value: string; label: string; emphasis?: boolean }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
      <AppText variant={emphasis ? 'h2' : 'h3'} color={emphasis ? 'brand' : 'text'} numeric numberOfLines={1}>
        {value}
      </AppText>
      <AppText variant="caption" color="textSecondary" numberOfLines={1}>{label}</AppText>
    </View>
  );
}

function Panel({ children, testID }: { children: ReactNode; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={[styles.panel, { backgroundColor: colors.surface }, shadow.lg]}>
      {children}
    </View>
  );
}

function StepsSheet({ nav, visible, onClose }: { nav: TurnByTurnNavigation; visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const { t, locale, row } = useLocale();
  const route = nav.state.route;
  const along = nav.state.progress?.along ?? 0;
  const steps = useMemo(
    () => (route ? route.maneuvers.filter((m) => m.announce && m.along >= along - 5) : []),
    [route, along],
  );
  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('nav.stepsTitle')} scrollable>
      <ScrollView style={{ maxHeight: 360 }} accessibilityRole="list">
        {steps.map((step, index) => (
          <View
            key={step.id}
            accessible
            accessibilityLabel={`${maneuverInstruction(step, locale, localizedStreet(step.street, locale))}. ${t('nav.stepDistance', { distance: distanceText(step.along - along, locale) })}`}
            style={{ flexDirection: row, alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: index === steps.length - 1 ? 0 : StyleSheet.hairlineWidth, borderColor: colors.divider }}
          >
            <View style={[styles.stepIcon, { backgroundColor: index === 0 ? colors.brand : colors.brandSoft }]}>
              <ManeuverIcon kind={step.kind} exit={step.exit} size={26} color={index === 0 ? colors.onBrand : colors.brand} ghostColor={index === 0 ? 'rgba(255,255,255,0.4)' : undefined} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <AppText variant="title" numberOfLines={2}>{maneuverInstruction(step, locale, localizedStreet(step.street, locale))}</AppText>
            </View>
            <AppText variant="label" color="textSecondary" numeric>{distanceText(Math.max(0, step.along - along), locale)}</AppText>
          </View>
        ))}
      </ScrollView>
      <View style={{ gap: spacing.sm, paddingTop: spacing.md }}>
        <SwitchRow
          label={t('nav.vibration')}
          description={nav.vibration ? t('nav.vibrationOn') : t('nav.vibrationOff')}
          value={nav.vibration}
          onValueChange={nav.setVibration}
        />
        <AppText variant="caption" color="textSecondary">{t('nav.safety')}</AppText>
      </View>
    </BottomSheet>
  );
}

/** Off-screen text that assistive technology reads whenever a new announcement is made. */
function LiveRegion({ message, label }: { message: string; label: string }) {
  return (
    <View
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      {...(Platform.OS === 'web' ? ({ role: 'status', 'aria-live': 'polite' } as object) : null)}
      style={styles.visuallyHidden}
    >
      <AppText>{message}</AppText>
    </View>
  );
}

// ---------------------------------------------------------------------------

export function NavigationOverlay({
  nav,
  destinationName,
  bottomOffset = 0,
  onDestinationAction,
  destinationActionLabel,
}: {
  nav: TurnByTurnNavigation;
  destinationName: string;
  bottomOffset?: number;
  onDestinationAction?: () => void;
  destinationActionLabel?: string;
}) {
  const { colors } = useTheme();
  const { t, locale, row, dateLocale, isRTL } = useLocale();
  const insets = useSafeAreaInsets();
  const [stepsOpen, setStepsOpen] = useState(false);
  const { state } = nav;
  const route = state.route;
  const progress = state.progress;
  const reliable = guidanceReliable(state);
  const maneuver = route && progress ? route.maneuvers[progress.nextIndex] : undefined;
  // "Then" only matters once the next turn is close; far out it is noise.
  const then = route && progress && reliable && progress.distanceToNext <= THEN_VISIBLE_METERS
    ? followingManeuver(route, progress.nextIndex, state.speed)
    : undefined;
  const preparing = state.status === 'locating' || state.status === 'routing';

  const banner = (() => {
    if (state.status === 'arrived' || state.status === 'error' || preparing) return null;
    if (state.paused) return <Banner tone="info" icon={<Pause size={18} color={colors.infoText} />} text={t('nav.paused')} />;
    if (state.signal === 'lost') return <Banner tone="warning" icon={<MapPinOff size={18} color={colors.warningText} />} text={t('nav.signalLost')} />;
    if (state.signal === 'weak') return <Banner tone="warning" icon={<SatelliteDish size={18} color={colors.warningText} />} text={t('nav.weakSignal')} />;
    if (state.wrongWay) return <Banner tone="danger" icon={<TriangleAlert size={18} color={colors.dangerText} />} text={t('nav.wrongWay')} busy={state.status === 'rerouting'} />;
    if (state.status === 'rerouting') return <Banner tone="info" icon={null} text={t('nav.rerouting')} busy />;
    if (state.offline) return <Banner tone="warning" icon={<CloudOff size={18} color={colors.warningText} />} text={t('nav.offline')} />;
    if (nav.voiceStatus.blocked && !nav.muted) return <Banner tone="info" icon={<Volume2 size={18} color={colors.infoText} />} text={t('nav.voiceBlocked')} onPress={nav.repeat} />;
    if (!nav.voice.available && !nav.muted) return <Banner tone="info" icon={<VolumeX size={18} color={colors.infoText} />} text={t('nav.voiceMissing')} />;
    return null;
  })();

  const errorCopy: Record<NonNullable<typeof state.error>, [TranslationKey, TranslationKey]> = {
    'permission-denied': ['nav.errorPermissionTitle', 'nav.errorPermissionBody'],
    'location-unavailable': ['nav.errorLocationTitle', 'nav.errorLocationBody'],
    'routing-failed': ['nav.errorRoutingTitle', 'nav.errorRoutingBody'],
    'no-guidance': ['nav.errorNoGuidanceTitle', 'nav.errorNoGuidanceBody'],
  };

  const eta = progress ? formatEta(progress.remainingSeconds, dateLocale) : '';
  const remainingTime = progress ? formatDuration(progress.remainingSeconds, t) : '';
  const remainingDistance = progress ? distanceText(progress.remainingMeters, locale) : '';

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <LiveRegion message={nav.liveMessage} label={t('nav.liveRegion')} />

      <View pointerEvents="box-none" style={{ paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.md, gap: spacing.sm }}>
        {maneuver && progress && state.status !== 'arrived' && state.status !== 'error' ? (
          <Reveal offset={-10}>
            <GuidanceCard maneuver={maneuver} distance={progress.distanceToNext} then={then} reliable={reliable} />
          </Reveal>
        ) : null}
        {banner ? <Reveal key={String(banner.props.text)} offset={-6}>{banner}</Reveal> : null}
      </View>

      <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: bottomOffset + Math.max(insets.bottom, spacing.md), paddingHorizontal: spacing.md, gap: spacing.sm }}>
        {!nav.following && route && state.status !== 'arrived' ? (
          <PressableScale
            testID="navigation-recenter"
            onPress={() => nav.setFollowing(true)}
            accessibilityRole="button"
            accessibilityLabel={t('nav.recenterMap')}
            style={[styles.recenter, { flexDirection: row, alignSelf: isRTL ? 'flex-start' : 'flex-end', backgroundColor: colors.surface }, shadow.md]}
          >
            <LocateFixed size={20} color={colors.brand} strokeWidth={2.4} />
            <AppText variant="label" color="brand">{t('nav.recenter')}</AppText>
          </PressableScale>
        ) : null}

        {state.status === 'error' && state.error ? (
          <Reveal offset={12}>
            <Panel testID="navigation-error">
              <View accessible accessibilityRole="alert" style={{ flexDirection: row, gap: spacing.md, alignItems: 'flex-start' }}>
                <View style={[styles.roundIcon, { backgroundColor: colors.warningSoft }]}>
                  <ShieldAlert size={22} color={colors.warningText} />
                </View>
                <View style={{ flex: 1, gap: spacing.xs }}>
                  <AppText variant="h3">{t(errorCopy[state.error][0])}</AppText>
                  <AppText variant="bodySm" color="textSecondary">{t(errorCopy[state.error][1])}</AppText>
                </View>
              </View>
              <View style={{ flexDirection: row, gap: spacing.sm }}>
                <AppButton label={t('nav.close')} variant="secondary" size="md" style={{ flex: 1 }} onPress={nav.stop} />
                <AppButton label={t('nav.tryAgain')} size="md" style={{ flex: 1 }} onPress={nav.retry} icon={<RefreshCw size={16} color={colors.onBrand} />} />
              </View>
            </Panel>
          </Reveal>
        ) : state.status === 'arrived' ? (
          <Reveal offset={12}>
            <Panel testID="navigation-arrived">
              <View accessible accessibilityRole="alert" style={{ alignItems: 'center', gap: spacing.sm }}>
                <View style={[styles.arrivalIcon, { backgroundColor: colors.successSoft }]}>
                  <CircleCheck size={34} color={colors.success} strokeWidth={2.2} />
                </View>
                <AppText variant="h2" align="center">{t('nav.arrived')}</AppText>
                <AppText variant="body" color="textSecondary" align="center" numberOfLines={2}>{destinationName}</AppText>
              </View>
              <View style={{ flexDirection: row, gap: spacing.sm }}>
                {onDestinationAction && destinationActionLabel ? (
                  <AppButton label={destinationActionLabel} variant="secondary" size="lg" style={{ flex: 1 }} onPress={() => { nav.stop(); onDestinationAction(); }} />
                ) : null}
                <AppButton testID="navigation-done" label={t('nav.done')} size="lg" style={{ flex: 1 }} onPress={nav.stop} />
              </View>
            </Panel>
          </Reveal>
        ) : preparing ? (
          <Reveal offset={12}>
            <Panel testID="navigation-preparing">
              <View style={{ flexDirection: row, alignItems: 'center', gap: spacing.md }} accessible accessibilityRole="progressbar" accessibilityLabel={state.status === 'locating' ? t('nav.locating') : t('nav.routing')}>
                <ActivityIndicator color={colors.brand} />
                <View style={{ flex: 1 }}>
                  <AppText variant="title">{state.status === 'locating' ? t('nav.locating') : t('nav.routing')}</AppText>
                  <AppText variant="caption" color="textSecondary" numberOfLines={1}>{destinationName}</AppText>
                </View>
              </View>
              <AppText variant="caption" color="textSecondary">{t('nav.safety')}</AppText>
              <AppButton label={t('nav.cancel')} variant="secondary" size="md" onPress={nav.stop} />
            </Panel>
          </Reveal>
        ) : route && progress ? (
          <Reveal offset={12}>
            <Panel testID="navigation-trip-panel">
              <View
                accessible
                accessibilityLabel={t('nav.tripSummary', { eta, minutes: remainingTime, distance: remainingDistance })}
                style={{ flexDirection: row, alignItems: 'center' }}
              >
                <Stat value={eta} label={t('nav.arrival')} emphasis />
                <View style={[styles.divider, { backgroundColor: colors.divider }]} />
                <Stat value={remainingTime} label={t('nav.remaining')} />
                <View style={[styles.divider, { backgroundColor: colors.divider }]} />
                <Stat value={remainingDistance} label={destinationName} />
              </View>
              <View style={{ flexDirection: row, gap: spacing.sm }}>
                <ControlButton
                  testID="navigation-end"
                  icon={<X size={22} color={colors.dangerText} strokeWidth={2.6} />}
                  label={t('nav.end')}
                  accessibilityLabel={t('nav.endNavigation')}
                  onPress={nav.stop}
                  tone="danger"
                />
                <ControlButton
                  icon={state.paused ? <Play size={21} color={colors.text} strokeWidth={2.4} /> : <Pause size={21} color={colors.text} strokeWidth={2.4} />}
                  label={state.paused ? t('nav.resume') : t('nav.pause')}
                  accessibilityLabel={state.paused ? t('nav.resumeNavigation') : t('nav.pauseNavigation')}
                  onPress={state.paused ? nav.resume : nav.pause}
                />
                <ControlButton
                  testID="navigation-repeat"
                  icon={<Repeat2 size={21} color={colors.text} strokeWidth={2.4} />}
                  label={t('nav.repeat')}
                  accessibilityLabel={t('nav.repeatInstruction')}
                  onPress={nav.repeat}
                />
                <ControlButton
                  testID="navigation-mute"
                  icon={nav.muted ? <VolumeX size={21} color={colors.text} strokeWidth={2.4} /> : <Volume2 size={21} color={colors.brand} strokeWidth={2.4} />}
                  label={nav.muted ? t('nav.unmute') : t('nav.mute')}
                  accessibilityLabel={nav.muted ? t('nav.unmuteVoice') : t('nav.muteVoice')}
                  onPress={() => nav.setMuted(!nav.muted)}
                  tone={nav.muted ? 'neutral' : 'active'}
                  selected={!nav.muted}
                />
                <ControlButton
                  icon={<ListOrdered size={21} color={colors.text} strokeWidth={2.4} />}
                  label={t('nav.steps')}
                  accessibilityLabel={t('nav.showSteps')}
                  onPress={() => setStepsOpen(true)}
                />
              </View>
            </Panel>
          </Reveal>
        ) : null}
      </View>

      <StepsSheet nav={nav} visible={stepsOpen && Boolean(route)} onClose={() => setStepsOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.xxxl, overflow: 'hidden' },
  iconTile: { width: 76, height: 76, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  distanceValue: { fontSize: 40, lineHeight: 48 },
  thenStrip: { alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: 10 },
  banner: { alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 12, borderRadius: radius.lg, minHeight: 48 },
  panel: { borderRadius: radius.xxxl, padding: spacing.lg, gap: spacing.md },
  control: { flex: 1, minHeight: CONTROL_HEIGHT, borderRadius: 18, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 2 },
  recenter: { alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.lg, height: 48, borderRadius: radius.pill },
  roundIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  arrivalIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  stepIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  divider: { width: StyleSheet.hairlineWidth * 2, height: 34 },
  visuallyHidden: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0.01, left: -10000 },
});
