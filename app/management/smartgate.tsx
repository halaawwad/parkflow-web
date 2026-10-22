import { useEffect, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { AppHeader, InlineNotice, Screen } from '@/components/ui';
import { GateZonePicker } from '@/components/domain/GateZonePicker';
import { GateOccupancyCard } from '@/components/domain/GateOccupancyCard';
import { GateVisitList } from '@/components/domain/GateVisitList';
import { GateCameraStation } from '@/components/domain/GateCameraStation';
import { GateLiveEvents } from '@/components/domain/GateLiveEvents';
import { GateManualEntry } from '@/components/domain/GateManualEntry';
import { useGateZones, useIsGateStaff, useOccupancy, useVisits } from '@/hooks/useGates';
import { useLocale } from '@/hooks/useLocale';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/spacing';

/**
 * SmartGate: a laptop or phone at the gate runs as the lot's automatic entry or exit
 * camera. Plates the cameras read reliably are entered and exited by themselves,
 * occupancy updates, and the owner only watches. Any plate can enter — cars not in
 * ParkFlow are counted like the rest, just never charged. Typing a plate remains as
 * a fallback.
 */
export default function SmartGateScreen() {
  const { t } = useLocale();
  const { colors } = useTheme();
  const { gate } = useIsGateStaff();
  const zones = useGateZones(gate);
  const [zoneId, setZoneId] = useState<string>();
  const zone = zones.data?.find((z) => z.id === zoneId);
  const occupancy = useOccupancy(zone?.id);
  const visits = useVisits(zone?.id);
  // One lot is the usual case for an owner: open straight onto it.
  useEffect(() => { if (!zoneId && zones.data?.length === 1) setZoneId(zones.data[0].id); }, [zoneId, zones.data]);

  return (
    <Screen bottomInset={spacing.giant} scrollProps={{
      refreshControl: <RefreshControl refreshing={visits.isRefetching || occupancy.isRefetching} tintColor={colors.brand}
        onRefresh={() => { void visits.refetch(); void occupancy.refetch(); }} />,
    }}>
      <AppHeader title={t('smartGate.title')} subtitle={t('smartGate.subtitle')} />
      {!gate ? <InlineNotice tone="warning" title={t('smartGate.ownersOnly')} /> : (
        <View style={{ gap: spacing.lg }}>
          <GateZonePicker zones={zones.data ?? []} loading={zones.isPending} value={zone} onChange={(z) => setZoneId(z?.id)} />
          {zone ? (
            <>
              <GateOccupancyCard occupancy={occupancy.data} loading={occupancy.isPending} />
              <GateCameraStation key={zone.id} zoneId={zone.id} />
              <GateLiveEvents zoneId={zone.id} />
              <GateVisitList visits={visits.data} loading={visits.isPending} />
              <GateManualEntry key={`manual-${zone.id}`} zoneId={zone.id} />
            </>
          ) : null}
        </View>
      )}
    </Screen>
  );
}
