import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Accessibility,
  Navigation,
  Clock,
  Timer,
  Building2,
  CircleParking,
  Users,
  TriangleAlert,
  Info,
} from 'lucide-react-native';

import { AppButton, AppText, BottomSheet, Divider, StatusBadge } from '@/components/ui';
import { availabilityTone } from '@/components/map/ZoneMarker';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/spacing';
import { radius } from '@/theme/radius';
import { useLocale } from '@/hooks/useLocale';
import { useReportZone } from '@/hooks/useCommunity';
import type { ParkingZone, ReportedAvailability } from '@/types';
import { formatRate } from '@/utils/money';
import { formatClockRange, formatDurationShort, isWithinOperatingHours } from '@/utils/time';
import { formatDistance } from '@/utils/geo';

export interface ZoneSheetProps {
  zone?: ParkingZone;
  visible: boolean;
  onClose: () => void;
  /** Metres from the user, when a location fix is available. */
  distanceMeters?: number;
  onNavigate: (zone: ParkingZone) => void;
  onStartParking: (zone: ParkingZone) => void;
  onReserve: (zone: ParkingZone) => void;
  onViewParkingMap: (zone: ParkingZone) => void;
  /** Disables the CTA when the zone cannot be parked in right now. */
  startDisabled?: boolean;
}

/**
 * One line of the zone's spec list: icon and label at the start, value at the
 * end — read like a ticket, so the eye scans one column of numbers.
 */
function SpecRow({
  icon,
  label,
  value,
  tone = 'default',
  first = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'default' | 'info';
  first?: boolean;
}) {
  const { colors } = useTheme();
  const { row } = useLocale();

  return (
    <View
      style={{
        flexDirection: row,
        alignItems: 'center',
        gap: spacing.sm + 2,
        minHeight: 44,
        paddingHorizontal: spacing.md + 2,
        borderTopWidth: first ? 0 : StyleSheet.hairlineWidth * 2,
        borderTopColor: colors.divider,
      }}
    >
      {icon}
      <AppText variant="bodySm" color={tone === 'info' ? 'infoText' : 'textSecondary'} numberOfLines={1} style={{ flex: 1 }}>
        {label}
      </AppText>
      <AppText variant="title" numberOfLines={1} numeric color={tone === 'info' ? 'infoText' : 'text'}>
        {value}
      </AppText>
    </View>
  );
}

export function ZoneSheet({
  zone,
  visible,
  onClose,
  distanceMeters,
  onNavigate,
  onStartParking,
  onReserve,
  onViewParkingMap,
  startDisabled = false,
}: ZoneSheetProps) {
  const { colors } = useTheme();
  const { t, row, dateLocale, locale } = useLocale();
  const reportZone = useReportZone();
  const [thanks, setThanks] = useState<'points' | 'counted' | undefined>();

  // Each zone starts with a fresh report prompt.
  useEffect(() => {
    setThanks(undefined);
    reportZone.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone?.id]);

  if (!zone) {
    return <BottomSheet visible={false} onClose={onClose}>{null}</BottomSheet>;
  }

  const today = zone.operatingHours.find((h) => h.weekday === new Date().getDay());
  const isOpenNow = isWithinOperatingHours(zone.operatingHours);
  const isGarage = zone.kind === 'garage' || zone.kind === 'private';
  const name = locale === 'ar' ? zone.nameAr : zone.name;
  const city = locale === 'ar' ? zone.cityAr : zone.city;

  const availabilityLabel = t(`zone.${zone.availability}` as const);
  const ownershipLabel = zone.ownership
    ? t(`ramallahParking.ownership.${zone.ownership}` as const)
    : undefined;
  const restriction =
    locale === 'ar' ? zone.accessRestrictionAr ?? zone.accessRestriction : zone.accessRestriction;

  const sendReport = (availability: ReportedAvailability) =>
    reportZone.mutate(
      { zoneId: zone.id, availability },
      { onSuccess: (result) => setThanks(result.points ? 'points' : 'counted') },
    );

  return (
    <BottomSheet visible={visible} onClose={onClose} scrollable testID="zone-sheet">
      <View style={{ gap: spacing.lg }}>
        <View style={{ flexDirection: row, alignItems: 'flex-start', gap: spacing.md }}>
          <View
            style={{
              width: 42,
              height: 42,
              borderRadius: radius.md,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: isGarage ? colors.infoSoft : colors.brandSoft,
            }}
          >
            {isGarage ? (
              <Building2 size={20} color={colors.info} strokeWidth={2.1} />
            ) : (
              <CircleParking size={20} color={colors.brand} strokeWidth={2.1} />
            )}
          </View>

          <View style={{ flex: 1, gap: 4 }}>
            <AppText variant="h2" numberOfLines={2}>
              {name}
            </AppText>
            <AppText variant="bodySm" color="textSecondary">
              {[t(`zone.kind.${zone.kind}` as const), ownershipLabel, zone.code, city]
                .filter(Boolean)
                .join(' · ')}
            </AppText>
          </View>
        </View>

        <View style={{ flexDirection: row, alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
          <StatusBadge label={availabilityLabel} tone={availabilityTone(zone.availability)} />
          {isOpenNow ? (
            <StatusBadge label={t('zone.openNow')} tone="neutral" showDot={false} />
          ) : (
            <StatusBadge label={t('zone.closedNow')} tone="info" showDot={false} />
          )}
          {distanceMeters != null ? (
            <AppText variant="bodySm" color="textTertiary">
              {formatDistance(distanceMeters, locale)} {t('common.away')}
            </AppText>
          ) : null}
        </View>

        {zone.crowd ? (
          <View style={{ flexDirection: row, alignItems: 'center', gap: spacing.sm }}>
            <Users size={14} color={colors.textTertiary} strokeWidth={2.2} />
            <AppText variant="caption" color="textSecondary" style={{ flex: 1 }}>
              {t('zone.crowdLine', {
                level: t(`zone.${zone.crowd.availability}` as const),
                minutes: zone.crowd.minutesSinceReport,
                count: zone.crowd.reportCount,
              })}
            </AppText>
          </View>
        ) : null}

        {restriction ? (
          <View
            style={{
              flexDirection: row,
              alignItems: 'flex-start',
              gap: spacing.sm,
              padding: spacing.sm,
              borderRadius: radius.md,
              backgroundColor: colors.warningSoft,
            }}
          >
            <TriangleAlert size={16} color={colors.warningText} strokeWidth={2.3} />
            <AppText variant="caption" color="warningText" style={{ flex: 1 }}>
              {restriction}
            </AppText>
          </View>
        ) : null}

        {zone.prototypeData ? (
          <View style={{ flexDirection: row, alignItems: 'center', gap: spacing.sm }}>
            <Info size={14} color={colors.textTertiary} strokeWidth={2.2} />
            <AppText variant="caption" color="textTertiary" style={{ flex: 1 }}>
              {t('zone.prototypeData')}
            </AppText>
          </View>
        ) : null}

        <View
          style={{
            borderRadius: radius.lg,
            backgroundColor: colors.background,
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: colors.divider,
            overflow: 'hidden',
          }}
        >
          <SpecRow
            first
            icon={<CircleParking size={16} color={colors.textTertiary} strokeWidth={2} />}
            label={t('zone.rate')}
            value={`${formatRate(zone.tariff.hourlyRate)}${t('common.perHour')}`}
          />
          <SpecRow
            icon={<Timer size={16} color={colors.textTertiary} strokeWidth={2} />}
            label={t('zone.maxStay')}
            value={
              zone.tariff.maxStayMinutes
                ? formatDurationShort(zone.tariff.maxStayMinutes * 60, locale)
                : '—'
            }
          />
          <SpecRow
            icon={<Clock size={16} color={colors.textTertiary} strokeWidth={2} />}
            label={t('zone.operatingHours')}
            value={
              today && !today.closed
                ? formatClockRange(today.opensAt, today.closesAt, dateLocale)
                : t('zone.closedNow')
            }
          />
          {zone.accessibleSpots ? (
            <SpecRow
              tone="info"
              icon={<Accessibility size={16} color={colors.info} strokeWidth={2} />}
              label={t('zone.accessibleShort')}
              value={String(zone.accessibleSpots)}
            />
          ) : null}
        </View>

        {/* One-tap driver report — feeds the crowd availability everyone sees. */}
        <View style={{ gap: spacing.sm }}>
          <AppText variant="caption" color="textTertiary">
            {t('zone.reportPrompt')}
          </AppText>
          {/* A quiet track: reporting is a contribution, not one of the sheet's actions. */}
          <View
            style={{
              flexDirection: row,
              gap: 4,
              padding: 4,
              borderRadius: radius.md,
              backgroundColor: colors.track,
            }}
          >
            {(['available', 'limited', 'full'] as const).map((level) => (
              <AppButton
                key={level}
                label={t(`zone.report.${level}` as const)}
                variant="ghost"
                size="sm"
                style={{ flex: 1, minHeight: 40, paddingHorizontal: spacing.sm, borderRadius: radius.sm }}
                loading={reportZone.isPending && reportZone.variables?.availability === level}
                disabled={reportZone.isPending}
                onPress={() => sendReport(level)}
              />
            ))}
          </View>
          {thanks ? (
            <AppText variant="caption" color="successText">
              {thanks === 'points'
                ? t('zone.reportThanksPoints', { points: 5 })
                : t('zone.reportThanks')}
            </AppText>
          ) : null}
          {reportZone.isError ? (
            <AppText variant="caption" color="warningText">
              {t('zone.reportFailed')}
            </AppText>
          ) : null}
        </View>

        <Divider />

        {/* Secondary actions pair up; the primary CTA alone carries colour. */}
        <View style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: row, gap: spacing.sm }}>
            <AppButton
              label={t('reservation.reserveSpot')}
              variant="secondary"
              size="md"
              onPress={() => onReserve(zone)}
              disabled={startDisabled}
              style={{ flex: 1, paddingHorizontal: spacing.md }}
              testID="zone-reserve-spot"
            />
            <AppButton
              label={t('parkingLayout.viewMap')}
              variant="secondary"
              size="md"
              onPress={() => onViewParkingMap(zone)}
              style={{ flex: 1, paddingHorizontal: spacing.md }}
              testID="zone-view-parking-map"
            />
          </View>

          <View style={{ flexDirection: row, gap: spacing.sm }}>
            <AppButton
              label={t('zone.route')}
              variant="secondary"
              onPress={() => onNavigate(zone)}
              icon={<Navigation size={17} color={colors.text} strokeWidth={2.2} />}
              style={{ flex: 1, paddingHorizontal: spacing.md }}
            />
            <AppButton
              label={t('zone.startParking')}
              onPress={() => onStartParking(zone)}
              disabled={startDisabled || zone.availability === 'full'}
              style={{ flex: 1.2, paddingHorizontal: spacing.md }}
              testID="zone-start-parking"
            />
          </View>
        </View>
      </View>
    </BottomSheet>
  );
}
