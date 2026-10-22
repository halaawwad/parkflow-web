import { useEffect, useState } from 'react';
import { View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ChevronDown, ChevronUp, ImageUp, LogIn, LogOut, X } from 'lucide-react-native';

import { AppButton, AppText, Card, Divider, InlineNotice, StatusBadge, TextField } from '@/components/ui';
import { PlateBadge } from '@/components/domain/PlateBadge';
import { useGateScan, usePlateLookup, useRecognizePlate } from '@/hooks/useGates';
import { useLocale } from '@/hooks/useLocale';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/spacing';
import { formatMoney } from '@/utils/money';
import { formatTime } from '@/utils/time';
import { errorMessage } from '@/utils/errors';
import { haptics } from '@/utils/haptics';
import type { GateLookup, GateResult, PlateRecognition } from '@/types';

type Direction = 'entry' | 'exit';

/** An exit this soon after entry is probably the camera seeing the same car again. */
const RECENT_ENTRY_MS = 2 * 60_000;
/** Below this, the operator is asked to check the number. */
const LOW_CONFIDENCE = 0.85;

interface Reading { source: 'photo' | 'manual'; confidence?: number; candidates: PlateRecognition['candidates']; lookup: GateLookup }

/**
 * Optional fallback for when the automatic cameras cannot help (a damaged plate, a
 * camera outage): type a plate or read one photo, check it, and confirm entry or
 * exit by hand. Normal operation never needs this.
 */
export function GateManualEntry({ zoneId }: { zoneId: string }) {
  const { t, row } = useLocale();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [reading, setReading] = useState<Reading>();
  const [plate, setPlate] = useState('');
  const [outcome, setOutcome] = useState<{ direction: Direction; result: GateResult }>();
  const [photoNote, setPhotoNote] = useState<{ reason?: string; reading?: string }>();

  const recognize = useRecognizePlate();
  const lookup = usePlateLookup();
  const scan = useGateScan();

  useEffect(() => { setReading(undefined); setOutcome(undefined); setPlate(''); setPhotoNote(undefined); }, [zoneId]);

  const show = (next: Reading) => { setOutcome(undefined); setPhotoNote(undefined); setReading(next); setPlate(next.lookup.plateNumber); };

  // A corrected number is looked up again before it can be confirmed.
  const digits = plate.replace(/\D/g, '');
  const stale = Boolean(reading) && digits !== reading?.lookup.plateNumber;
  useEffect(() => {
    if (!reading || digits.length < 4 || digits === reading.lookup.plateNumber) return;
    const timer = setTimeout(() => lookup.mutate({ zoneId, plate: digits }, {
      onSuccess: (next) => setReading((current) => (current ? { ...current, lookup: next } : current)),
    }), 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digits, reading?.lookup.plateNumber, zoneId]);

  const checkTyped = () => {
    const value = typed.replace(/\D/g, '');
    if (value.length < 4) return;
    lookup.mutate({ zoneId, plate: value }, { onSuccess: (next) => { show({ source: 'manual', candidates: [], lookup: next }); setTyped(''); } });
  };

  const usePhoto = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, allowsMultipleSelection: false });
    const asset = picked.canceled ? undefined : picked.assets[0];
    if (!asset) return;
    recognize.mutate({ zoneId, frame: { uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg' } }, {
      onSuccess: (result) => {
        if (result.plateNumber && result.lookup) show({ source: 'photo', confidence: result.confidence, candidates: result.candidates, lookup: result.lookup });
        else { haptics.warning(); setPhotoNote({ reason: result.reason, reading: result.reading }); }
      },
    });
  };

  const confirm = (direction: Direction) => {
    if (!reading || stale) return;
    scan.mutate({ direction, scan: { zoneId, plate: reading.lookup.plateNumber } }, {
      onSuccess: (result) => { haptics.success(); setOutcome({ direction, result }); setReading(undefined); setPlate(''); },
      onError: () => haptics.error(),
    });
  };

  const dismiss = () => { setReading(undefined); setPlate(''); scan.reset(); };

  return (
    <Card padding="lg" tone="outline" style={{ gap: spacing.md }}>
      <AppButton variant="ghost" size="sm" fullWidth={false} label={t('smartGate.manual.title')} onPress={() => setOpen((o) => !o)}
        icon={open ? <ChevronUp size={16} color={colors.text} /> : <ChevronDown size={16} color={colors.text} />} />
      {open ? (
        <>
          <AppText variant="caption" color="textTertiary">{t('smartGate.manual.note')}</AppText>
          <TextField label={t('gate.plate')} hint={t('smartGate.manualHint')} value={typed} onChangeText={setTyped} keyboardType="number-pad" maxLength={12}
            onSubmitEditing={checkTyped} />
          <View style={{ flexDirection: row, gap: spacing.sm, flexWrap: 'wrap' }}>
            <AppButton size="sm" fullWidth={false} label={t('smartGate.checkPlate')} loading={lookup.isPending && !reading} disabled={typed.replace(/\D/g, '').length < 4} onPress={checkTyped} />
            <AppButton size="sm" fullWidth={false} variant="secondary" label={t('smartGate.usePhoto')} icon={<ImageUp size={16} color={colors.text} />}
              loading={recognize.isPending} onPress={() => void usePhoto()} />
          </View>
          {lookup.isError && !reading ? <AppText variant="caption" color="danger">{errorMessage(lookup.error)}</AppText> : null}
          {recognize.isError ? <InlineNotice tone="warning" title={t('smartGate.recognitionFailed')} body={errorMessage(recognize.error)} /> : null}
          {photoNote ? (
            <View style={{ gap: 2 }}>
              <AppText variant="bodySm" color="warningText">{t(`smartGate.hint.${(photoNote.reason ?? 'unreadable') as 'unreadable'}`)}</AppText>
              {photoNote.reading ? <AppText variant="caption" color="textTertiary" numeric>{t('smartGate.uncertainReading', { reading: photoNote.reading })}</AppText> : null}
            </View>
          ) : null}
          {reading ? (
            <ReadingPanel reading={reading} plate={plate} onPlate={setPlate} stale={stale} checking={lookup.isPending}
              busy={scan.isPending} error={scan.isError ? errorMessage(scan.error) : undefined} onConfirm={confirm} onDismiss={dismiss} />
          ) : null}
          {outcome ? <Outcome {...outcome} /> : null}
        </>
      ) : null}
    </Card>
  );
}

function Outcome({ direction, result }: { direction: Direction; result: GateResult }) {
  const { t } = useLocale();
  const o = result.occupancy;
  const count = o.capacity ? `${o.inside}/${o.capacity}` : String(o.inside);
  const lines = [
    t('smartGate.nowInside', { count }),
    !result.registered ? t('smartGate.unregisteredTracked') : undefined,
    direction === 'entry' && result.sessionId && !result.alreadyInside ? t('smartGate.sessionStarted') : undefined,
    result.charge ? t(result.charge.paymentStatus === 'paid' ? 'smartGate.charged' : 'smartGate.chargeUnpaid', { amount: formatMoney(result.charge.amount) }) : undefined,
  ].filter(Boolean).join(' ');
  return (
    <InlineNotice tone={result.alreadyInside ? 'info' : 'success'}
      title={`${result.plateNumber} · ${result.alreadyInside ? t('smartGate.alreadyInside') : direction === 'entry' ? t('smartGate.entryRecorded') : t('smartGate.exitRecorded')}`}
      body={lines} />
  );
}

function ReadingPanel({ reading, plate, onPlate, stale, checking, busy, error, onConfirm, onDismiss }: {
  reading: Reading; plate: string; onPlate: (value: string) => void; stale: boolean; checking: boolean; busy: boolean; error?: string;
  onConfirm: (direction: Direction) => void; onDismiss: () => void;
}) {
  const { t, row, dateLocale } = useLocale();
  const { colors } = useTheme();
  const l = reading.lookup;
  const enteredAgo = l.visit ? Date.now() - new Date(l.visit.enteredAt).getTime() : Infinity;
  const others = reading.candidates.filter((c) => c.plateNumber !== l.plateNumber);
  const details = l.vehicle ? [l.vehicle.color, l.vehicle.make, l.vehicle.model].filter(Boolean).join(' ') : '';
  // Only the action the gate state allows: entry for a car outside, exit for one inside.
  const action = l.suggested;
  return (
    <View style={{ gap: spacing.md }}>
      <Divider />
      <View style={{ flexDirection: row, alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
        <PlateBadge plateNumber={l.plateNumber} size="lg" />
        <View style={{ flex: 1 }} />
        <StatusBadge label={l.registered ? t('smartGate.registered') : t('gate.status.unregistered')} tone={l.registered ? 'brand' : 'neutral'} showDot={false} />
        <StatusBadge label={l.inside ? t('smartGate.insideNow') : t('smartGate.notInside')} tone={l.inside ? 'success' : 'neutral'} />
      </View>
      <TextField label={t('smartGate.correct')} value={plate} onChangeText={onPlate} keyboardType="number-pad" maxLength={12}
        hint={reading.confidence !== undefined ? t('smartGate.confidence', { percent: Math.round(reading.confidence * 100) }) : undefined} />
      {others.length ? (
        <View style={{ flexDirection: row, flexWrap: 'wrap', gap: spacing.xs, alignItems: 'center' }}>
          <AppText variant="caption" color="textSecondary">{t('smartGate.otherReadings')}</AppText>
          {others.map((c) => <AppButton key={c.plateNumber} size="sm" fullWidth={false} variant="tonal" label={c.plateNumber} onPress={() => onPlate(c.plateNumber)} />)}
        </View>
      ) : null}
      {!l.inside && l.similarInside.length ? (
        <View style={{ gap: spacing.xs }}>
          <AppText variant="caption" color="textSecondary">{t('smartGate.similarInside')}</AppText>
          <View style={{ flexDirection: row, flexWrap: 'wrap', gap: spacing.xs }}>
            {l.similarInside.map((s) => <AppButton key={s.plateNumber} size="sm" fullWidth={false} variant="tonal"
              label={`${s.plateNumber} · ${formatTime(s.enteredAt, dateLocale)}`} onPress={() => onPlate(s.plateNumber)} />)}
          </View>
        </View>
      ) : null}
      <AppText variant="bodySm" color="textSecondary">
        {l.registered ? [details, l.vehicle?.autoParking ? t('smartGate.autoParkingOn') : t('smartGate.autoParkingOff')].filter(Boolean).join(' · ') : t('smartGate.unregisteredBody')}
      </AppText>
      {l.visit ? <AppText variant="bodySm" color="textSecondary">{t('smartGate.insideSince', { time: formatTime(l.visit.enteredAt, dateLocale) })}</AppText> : null}
      {reading.confidence !== undefined && reading.confidence < LOW_CONFIDENCE ? <InlineNotice tone="warning" title={t('smartGate.lowConfidence')} /> : null}
      {l.inside && enteredAgo < RECENT_ENTRY_MS ? <InlineNotice tone="warning" title={t('smartGate.justEntered')} /> : null}
      {!l.inside && l.occupancy.status === 'full' ? <InlineNotice tone="warning" title={t('smartGate.lotFull')} /> : null}
      {error ? <InlineNotice tone="danger" title={t('common.somethingWrong')} body={error} /> : null}
      <View style={{ flexDirection: row, gap: spacing.sm }}>
        <AppButton style={{ flex: 2 }} label={action === 'entry' ? t('smartGate.confirmEntry') : t('smartGate.confirmExit')}
          icon={action === 'entry' ? <LogIn size={18} color={colors.onBrand} /> : <LogOut size={18} color={colors.onBrand} />}
          loading={busy} disabled={stale || checking} onPress={() => onConfirm(action)} />
        <AppButton style={{ flex: 1 }} variant="ghost" label={t('smartGate.dismiss')} icon={<X size={18} color={colors.text} />} disabled={busy} onPress={onDismiss} />
      </View>
      {stale ? <AppText variant="caption" color="textTertiary">{t('smartGate.checking')}</AppText> : null}
    </View>
  );
}
