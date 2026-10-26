import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Minus, Plus } from 'lucide-react-native';
import { AppText, IconButton } from '@/components/ui';
import { useLocale } from '@/hooks/useLocale';
import { useTheme } from '@/theme/ThemeProvider';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';

export interface StepperRowProps {
  icon?: ReactNode;
  label: string;
  value: string;
  onMinus: () => void;
  onPlus: () => void;
  minusDisabled?: boolean;
  plusDisabled?: boolean;
}

/**
 * A labelled − value + control, used for dates, times, seats and durations.
 * One recessed track holds both buttons and the value, so it reads as a single
 * instrument rather than two loose buttons around a number.
 */
export function StepperRow({ icon, label, value, onMinus, onPlus, minusDisabled, plusDisabled }: StepperRowProps) {
  const { row } = useLocale();
  const { colors } = useTheme();
  const stepButton = { backgroundColor: colors.surface, borderRadius: radius.sm };

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: row, alignItems: 'center', gap: spacing.sm }}>
        {icon}
        <AppText variant="label" color="textSecondary">{label}</AppText>
      </View>
      <View
        style={{
          flexDirection: row,
          alignItems: 'center',
          padding: 4,
          borderRadius: radius.md,
          backgroundColor: colors.track,
        }}
      >
        <IconButton
          icon={<Minus size={18} color={colors.text} strokeWidth={2.3} />}
          tone="ghost"
          size={44}
          onPress={onMinus}
          disabled={minusDisabled}
          accessibilityLabel={`${label} −`}
          style={stepButton}
        />
        <AppText variant="titleLg" numeric align="center" style={{ flex: 1 }}>{value}</AppText>
        <IconButton
          icon={<Plus size={18} color={colors.text} strokeWidth={2.3} />}
          tone="ghost"
          size={44}
          onPress={onPlus}
          disabled={plusDisabled}
          accessibilityLabel={`${label} +`}
          style={stepButton}
        />
      </View>
    </View>
  );
}
