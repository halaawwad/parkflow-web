import { StyleSheet, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { AppText, PressableScale } from '@/components/ui';
import { useLocale } from '@/hooks/useLocale';
import { useTheme } from '@/theme/ThemeProvider';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';

/**
 * Pick one item from a list (an organization, an operator): rows on one card
 * with a radio mark, instead of a column of buttons that all look pressable
 * and none look chosen.
 */
export function ChoiceList({
  items,
  selectedId,
  onSelect,
  disabled = false,
}: {
  items: { id: string; label: string }[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const { row } = useLocale();

  return (
    <View
      accessibilityRole="radiogroup"
      style={{
        borderRadius: radius.lg,
        backgroundColor: colors.surface,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: colors.divider,
        overflow: 'hidden',
      }}
    >
      {items.map((item, index) => {
        const active = item.id === selectedId;
        return (
          <PressableScale
            key={item.id}
            onPress={() => onSelect(item.id)}
            disabled={disabled}
            haptic="select"
            scaleTo={0.99}
            accessibilityRole="radio"
            accessibilityState={{ selected: active, disabled }}
            accessibilityLabel={item.label}
            style={{
              flexDirection: row,
              alignItems: 'center',
              gap: spacing.md,
              minHeight: 48,
              paddingHorizontal: spacing.lg,
              backgroundColor: active ? colors.brandSofter : 'transparent',
              borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth * 2,
              borderTopColor: colors.divider,
            }}
          >
            <View
              style={{
                width: 20,
                height: 20,
                borderRadius: 10,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1.5,
                borderColor: active ? colors.brand : colors.borderStrong,
                backgroundColor: active ? colors.brand : colors.surface,
              }}
            >
              {active ? <Check size={12} color={colors.onBrand} strokeWidth={3} /> : null}
            </View>
            <AppText variant="title" weight={active ? 'semibold' : 'medium'} numberOfLines={1} style={{ flex: 1 }}>
              {item.label}
            </AppText>
          </PressableScale>
        );
      })}
    </View>
  );
}
