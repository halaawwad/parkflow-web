import { Switch, View, type StyleProp, type ViewStyle } from 'react-native';
import { AppText } from './AppText';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/spacing';
import { useLocale } from '@/hooks/useLocale';
import { haptics } from '@/utils/haptics';

export interface SwitchRowProps {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function SwitchRow({
  label,
  description,
  value,
  onValueChange,
  disabled = false,
  style,
}: SwitchRowProps) {
  const { colors } = useTheme();
  const { row } = useLocale();

  return (
    <View
      style={[
        {
          flexDirection: row,
          alignItems: 'center',
          gap: spacing.lg,
          paddingVertical: spacing.sm,
        },
        style,
      ]}
    >
      {/* Only the control dims when disabled: the text often explains why, so it must stay readable. */}
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="title" color={disabled ? 'textSecondary' : 'text'}>{label}</AppText>
        {description ? (
          <AppText variant="bodySm" color="textSecondary">
            {description}
          </AppText>
        ) : null}
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          haptics.select();
          onValueChange(next);
        }}
        trackColor={{ false: colors.borderStrong, true: colors.brand }}
        thumbColor={colors.surface}
        // react-native-web paints an "on" thumb in Material teal unless told otherwise.
        {...({ activeThumbColor: colors.surface } as object)}
        ios_backgroundColor={colors.borderStrong}
        accessibilityLabel={label}
        accessibilityState={{ checked: value, disabled }}
        style={{ opacity: disabled ? 0.45 : 1 }}
      />
    </View>
  );
}
