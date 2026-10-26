import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ArrowDownUp, Check, ChevronDown, MapPin } from 'lucide-react-native';
import { AppText, BottomSheet, PressableScale } from '@/components/ui';
import { CITIES } from '@/data/cities';
import { useLocale } from '@/hooks/useLocale';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/spacing';
import { radius } from '@/theme/radius';

/**
 * City selection as a field that opens a list, instead of a wall of chips.
 * `allowAny` adds an "Any city" option with the value ''.
 */

function useCityLabel() {
  const { locale, t } = useLocale();
  return (value: string) => (value ? (locale === 'ar' ? CITIES.find((c) => c.name === value)?.nameAr ?? value : value) : t('ride.anyCity'));
}

/** The list of cities in a bottom sheet. */
function CitySheet({ visible, title, value, allowAny, onClose, onSelect }: {
  visible: boolean; title: string; value: string; allowAny?: boolean; onClose: () => void; onSelect: (city: string) => void;
}) {
  const { locale, t, row } = useLocale();
  const { colors } = useTheme();
  const options = [
    ...(allowAny ? [{ value: '', label: t('ride.anyCity') }] : []),
    ...CITIES.map((city) => ({ value: city.name, label: locale === 'ar' ? city.nameAr : city.name })),
  ];
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title} scrollable>
      <View style={{ gap: 2 }}>
        {options.map((option) => {
          const on = option.value === value;
          return (
            <PressableScale
              key={option.value || 'any'}
              testID={`city-option-${option.value || 'any'}`}
              onPress={() => { onSelect(option.value); onClose(); }}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              {...({ 'aria-checked': on } as object)}
              style={[styles.option, { flexDirection: row, backgroundColor: on ? colors.brandSoft : 'transparent' }]}
            >
              <View style={[styles.optionIcon, { backgroundColor: on ? colors.surface : colors.surfaceAlt }]}>
                <MapPin size={16} color={on ? colors.brand : colors.textSecondary} strokeWidth={2.2} />
              </View>
              <AppText variant="title" color={on ? 'brand' : 'text'} style={{ flex: 1 }}>{option.label}</AppText>
              {on ? <Check size={20} color={colors.brand} strokeWidth={2.6} /> : null}
            </PressableScale>
          );
        })}
      </View>
    </BottomSheet>
  );
}

/** One row of a picker: icon, small label, the chosen city, and a chevron. */
function CityRow({ icon, label, value, placeholder, onPress, testID }: {
  icon: React.ReactNode; label: string; value: string; placeholder: boolean; onPress: () => void; testID?: string;
}) {
  const { row } = useLocale();
  const { colors } = useTheme();
  return (
    <PressableScale
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      style={[styles.row, { flexDirection: row }]}
    >
      {/* A fixed slot so the ring and the pin centre on one axis and the labels align. */}
      <View style={{ width: 20, alignItems: 'center' }}>{icon}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <AppText variant="caption" color="textTertiary">{label}</AppText>
        <AppText variant="title" color={placeholder ? 'textSecondary' : 'text'} numberOfLines={1}>{value}</AppText>
      </View>
      <ChevronDown size={18} color={colors.textTertiary} strokeWidth={2.2} />
    </PressableScale>
  );
}

/** A single city field (e.g. the city of a parking spot). */
export function CityPicker({ label, value, onChange, allowAny }: {
  label: string; value: string; onChange: (city: string) => void; allowAny?: boolean;
}) {
  const { colors } = useTheme();
  const cityLabel = useCityLabel();
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* Styled as a TextField (white, 1.5px hairline) so it sits in a form with them. */}
      <View style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1.5 }]}>
        <CityRow
          icon={<MapPin size={18} color={colors.brand} strokeWidth={2.2} />}
          label={label}
          value={cityLabel(value)}
          placeholder={!value}
          onPress={() => setOpen(true)}
        />
      </View>
      <CitySheet visible={open} title={label} value={value} allowAny={allowAny} onClose={() => setOpen(false)} onSelect={onChange} />
    </>
  );
}

/** From → to, in one card, with a button that swaps the two cities. */
export function CityRoutePicker({ from, to, onChangeFrom, onChangeTo, allowAny }: {
  from: string; to: string; onChangeFrom: (city: string) => void; onChangeTo: (city: string) => void; allowAny?: boolean;
}) {
  const { t, isRTL } = useLocale();
  const { colors } = useTheme();
  const cityLabel = useCityLabel();
  const [open, setOpen] = useState<'from' | 'to'>();
  const swap = () => { onChangeFrom(to); onChangeTo(from); };

  return (
    <>
      <View style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <CityRow
          testID="city-from"
          icon={<View style={[styles.dot, { borderColor: colors.brand }]} />}
          label={t('ride.from')}
          value={cityLabel(from)}
          placeholder={!from}
          onPress={() => setOpen('from')}
        />
        <View style={[styles.divider, { backgroundColor: colors.divider }]} />
        <CityRow
          testID="city-to"
          icon={<MapPin size={18} color={colors.onBrand} fill={colors.brand} strokeWidth={2} />}
          label={t('ride.to')}
          value={cityLabel(to)}
          placeholder={!to}
          onPress={() => setOpen('to')}
        />
        <PressableScale
          testID="city-swap"
          onPress={swap}
          disabled={!from && !to}
          accessibilityRole="button"
          accessibilityLabel={t('ride.swapCities')}
          style={[styles.swap, { [isRTL ? 'left' : 'right']: 44, backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <ArrowDownUp size={16} color={colors.brand} strokeWidth={2.4} />
        </PressableScale>
      </View>
      <CitySheet
        visible={open !== undefined}
        title={open === 'to' ? t('ride.pickTo') : t('ride.pickFrom')}
        value={open === 'to' ? to : from}
        allowAny={allowAny}
        onClose={() => setOpen(undefined)}
        onSelect={open === 'to' ? onChangeTo : onChangeFrom}
      />
    </>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth * 2, overflow: 'visible' },
  row: { alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 64 },
  divider: { height: StyleSheet.hairlineWidth * 2, marginHorizontal: spacing.lg },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 3 },
  swap: { position: 'absolute', top: '50%', marginTop: -18, width: 36, height: 36, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth * 2, alignItems: 'center', justifyContent: 'center' },
  option: { alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.lg, minHeight: 52 },
  optionIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
