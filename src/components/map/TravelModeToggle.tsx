import { Car, Footprints } from 'lucide-react-native';
import { View } from 'react-native';

import { AppText, PressableScale } from '@/components/ui';
import { useLocale } from '@/hooks/useLocale';
import { useTheme } from '@/theme/ThemeProvider';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import type { TravelMode } from '@/types';

const MODES: { mode: TravelMode; Icon: typeof Car }[] = [
  { mode: 'driving', Icon: Car },
  { mode: 'walking', Icon: Footprints },
];

/**
 * Driving / walking switch. Choosing a mode re-plans the route with that
 * profile straight away, so the line, time and steps always match the mode.
 */
export function TravelModeToggle({ value, onChange, disabled = false }: { value: TravelMode; onChange: (mode: TravelMode) => void; disabled?: boolean }) {
  const { colors } = useTheme();
  const { t, row } = useLocale();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t('travelMode.label')}
      style={{ flexDirection: row, gap: 4, padding: 4, borderRadius: radius.lg, backgroundColor: colors.surfaceAlt }}
    >
      {MODES.map(({ mode, Icon }) => {
        const selected = value === mode;
        return (
          <PressableScale
            key={mode}
            testID={`travel-mode-${mode}`}
            onPress={() => !selected && onChange(mode)}
            disabled={disabled}
            haptic="select"
            accessibilityRole="radio"
            // aria-* reaches the DOM on web (react-native-web ignores accessibilityState); native reads both.
            accessibilityState={{ checked: selected, disabled }}
            aria-checked={selected}
            aria-disabled={disabled}
            accessibilityLabel={t(`travelMode.${mode}` as const)}
            style={{
              flex: 1,
              minHeight: 44,
              flexDirection: row,
              alignItems: 'center',
              justifyContent: 'center',
              gap: spacing.xs,
              borderRadius: radius.md,
              backgroundColor: selected ? colors.surface : 'transparent',
              opacity: disabled ? 0.5 : 1,
            }}
          >
            <Icon size={17} color={selected ? colors.brand : colors.textSecondary} strokeWidth={selected ? 2.5 : 2.1} />
            <AppText variant="label" color={selected ? 'text' : 'textSecondary'}>
              {t(`travelMode.${mode}` as const)}
            </AppText>
          </PressableScale>
        );
      })}
    </View>
  );
}
