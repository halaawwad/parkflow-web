import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Info, TriangleAlert, CircleCheck, CircleAlert, ArrowLeft, ArrowRight } from 'lucide-react-native';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';
import { useTheme } from '@/theme/ThemeProvider';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { useLocale } from '@/hooks/useLocale';

export type NoticeTone = 'info' | 'warning' | 'danger' | 'success';

export interface InlineNoticeProps {
  tone?: NoticeTone;
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void };
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Contextual banner for low balance, overstay, payment failure and offline. */
export function InlineNotice({
  tone = 'info',
  title,
  body,
  action,
  icon,
  style,
}: InlineNoticeProps) {
  const { colors } = useTheme();
  const { row, isRTL } = useLocale();
  const Arrow = isRTL ? ArrowLeft : ArrowRight;

  const config = {
    info: { bg: colors.infoSoft, fg: colors.infoText, Icon: Info },
    warning: { bg: colors.warningSoft, fg: colors.warningText, Icon: TriangleAlert },
    danger: { bg: colors.dangerSoft, fg: colors.dangerText, Icon: CircleAlert },
    success: { bg: colors.successSoft, fg: colors.successText, Icon: CircleCheck },
  }[tone];

  return (
    <View
      accessibilityRole="alert"
      style={[
        {
          flexDirection: row,
          gap: spacing.md,
          paddingVertical: spacing.md + 2,
          paddingHorizontal: spacing.lg,
          borderRadius: radius.lg,
          backgroundColor: config.bg,
          alignItems: 'flex-start',
        },
        style,
      ]}
    >
      {icon ?? <config.Icon size={18} color={config.fg} strokeWidth={2.2} style={{ marginTop: 2 }} />}

      <View style={{ flex: 1, gap: 4 }}>
        <AppText variant="title" style={{ color: config.fg }}>
          {title}
        </AppText>
        {body ? (
          <AppText variant="bodySm" style={{ color: config.fg, opacity: 0.9 }}>
            {body}
          </AppText>
        ) : null}
        {action ? (
          <PressableScale
            onPress={action.onPress}
            haptic="light"
            hitSlop={8}
            accessibilityRole="button"
            style={{ marginTop: spacing.xs, flexDirection: row, alignItems: 'center', gap: spacing.xs, alignSelf: isRTL ? 'flex-end' : 'flex-start' }}
          >
            <AppText variant="label" style={{ color: config.fg }}>
              {action.label}
            </AppText>
            <Arrow size={14} color={config.fg} strokeWidth={2.4} />
          </PressableScale>
        ) : null}
      </View>
    </View>
  );
}
