import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { AppText } from './AppText';
import { AppButton, type ButtonVariant } from './AppButton';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/spacing';
import { radius } from '@/theme/radius';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  body?: string;
  /** `variant` quiets the button when the screen already shows the same action as its primary. */
  action?: { label: string; onPress: () => void; variant?: ButtonVariant };
  secondaryAction?: { label: string; onPress: () => void };
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  secondaryAction,
  compact = false,
  style,
}: EmptyStateProps) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        {
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: compact ? spacing.xxl : spacing.huge,
          paddingHorizontal: spacing.xl,
          gap: spacing.sm,
        },
        style,
      ]}
    >
      {icon ? (
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: radius.pill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.brandSoft,
            marginBottom: spacing.xs,
          }}
        >
          {icon}
        </View>
      ) : null}

      <AppText variant="titleLg" align="center" style={{ marginTop: spacing.xs }}>
        {title}
      </AppText>

      {body ? (
        <AppText variant="bodySm" color="textSecondary" align="center" style={{ maxWidth: 280 }}>
          {body}
        </AppText>
      ) : null}

      {action ? (
        <AppButton
          label={action.label}
          onPress={action.onPress}
          variant={action.variant}
          size="md"
          fullWidth={false}
          style={{ alignSelf: 'center', marginTop: spacing.sm, paddingHorizontal: spacing.xxl }}
        />
      ) : null}

      {secondaryAction ? (
        <AppButton
          label={secondaryAction.label}
          onPress={secondaryAction.onPress}
          variant="ghost"
          size="sm"
          fullWidth={false}
          style={{ alignSelf: 'center' }}
        />
      ) : null}
    </View>
  );
}
