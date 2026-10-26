import { useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { AppText, BottomSheet } from '@/components/ui';
import { useLocale } from '@/hooks/useLocale';
import type { EvChargingStation } from '@/types';
import { spacing } from '@/theme/spacing';
import { DetailActions, DetailList, DetailNote, type DetailRow } from './PlaceDetails';

function safeSource(value?: string): string | undefined {
  if (!value) return;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; } catch { return; }
}
export function EvStationDetailsSheet({ station, onClose, onRoute }: { station?: EvChargingStation; onClose: () => void; onRoute: (station: EvChargingStation) => void }) {
  const { t, row, dateLocale } = useLocale();
  const [linkError, setLinkError] = useState(false);
  const source = safeSource(station?.sourceUrl);
  const phoneDigits = station?.phone?.replace(/\D/g, '').length ?? 0;
  const phone = station?.phone && /^\+?[0-9][0-9 ()-]{4,30}[0-9]$/.test(station.phone) && phoneDigits >= 7 && phoneDigits <= 15 ? station.phone.replace(/[ ()-]/g, '') : undefined;
  const open = async (url: string) => { setLinkError(false); try { await Linking.openURL(url); } catch { setLinkError(true); } };
  const rows = station ? [
    [t('ev.operator'), station.operatorName], ['', [station.address, station.city].filter(Boolean).join(' · ')],
    [t('ev.pricing'), station.pricingText], [t('ev.hours'), station.openingHoursText],
    [t('ev.call'), phone ? station.phone : undefined], [t('ev.source'), station.sourceName],
    [t('ev.verified'), station.lastVerifiedAt ? new Date(station.lastVerifiedAt).toLocaleDateString(dateLocale) : undefined],
  ] : [];
  return <BottomSheet visible={Boolean(station)} onClose={onClose} title={station?.name} subtitle={t('ev.station')}>
    {station ? <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: spacing.md }} showsVerticalScrollIndicator={false}>
      <DetailList rows={[
        [t('ev.statusLabel'), <AppText key="status" variant="title">{t(`ev.status.${station.status}`)}</AppText>],
        [t('ev.accessLabel'), t(`ev.access.${station.accessType}`)],
        ...(rows as DetailRow[]),
      ]} />
      {station.pricingText ? <DetailNote>{t('ev.pricingNote')}</DetailNote> : null}
      {station.connectors.length ? (
        <DetailList rows={[[
          `${t('ev.connector')} · ${t('ev.power')}`,
          <View key="connectors" style={{ gap: spacing.xs, marginTop: 2 }}>
            {station.connectors.map((c, i) => (
              <View key={i} style={{ flexDirection: row, justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
                <AppText variant="label">{t(`ev.connector.${c.type}`)}</AppText>
                <AppText variant="caption" color="textSecondary" numeric>{t('ev.quantity', { count: c.quantity, power: c.powerKw })}</AppText>
              </View>
            ))}
          </View>,
        ]]} />
      ) : null}
      <DetailNote>{t('ev.liveNote')}</DetailNote>
      {linkError ? <DetailNote tone="danger">{t('ev.linkFailed')}</DetailNote> : null}
      <DetailActions
        routeLabel={t('ev.route')}
        onRoute={() => onRoute(station)}
        links={[
          ...(phone ? [{ key: 'call', label: t('ev.call'), onPress: () => void open(`tel:${phone}`) }] : []),
          ...(source ? [{ key: 'source', label: t('ev.openSource'), onPress: () => void open(source) }] : []),
        ]}
        closeLabel={t('ev.close')}
        onClose={onClose}
      />
    </ScrollView> : null}
  </BottomSheet>;
}
