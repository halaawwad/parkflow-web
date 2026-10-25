import { StyleSheet, View } from 'react-native';
import { Radio, WifiOff } from 'lucide-react-native';
import { AppText } from '@/components/ui';
import { useLocale } from '@/hooks/useLocale';
import { useTheme } from '@/theme/ThemeProvider';
import { radius } from '@/theme/radius';
import { shadow } from '@/theme/shadows';

/**
 * Small pill over the map saying checkpoint states come from user reports and
 * how fresh they are. Turns amber when the live feed is disconnected.
 */
export function CommunityFreshness({ connected, updatedAt, showSource = true }: {
  connected: boolean;
  updatedAt?: number;
  /** Off where the screen title already says the data comes from user reports. */
  showSource?: boolean;
}) {
  const { t, row, dateLocale, isRTL } = useLocale();
  const { colors } = useTheme();
  const time = updatedAt
    ? new Intl.DateTimeFormat(dateLocale, { hour: 'numeric', minute: '2-digit' }).format(new Date(updatedAt))
    : undefined;
  const text = connected
    ? [showSource ? t('roads.community') : undefined, time ? t('roads.lastUpdate', { time }) : undefined].filter(Boolean).join(' · ')
    : t('roads.disconnected');

  return (
    <View
      accessible
      accessibilityLabel={text}
      style={[
        styles.pill,
        shadow.sm,
        {
          flexDirection: row,
          alignSelf: isRTL ? 'flex-end' : 'flex-start',
          backgroundColor: connected ? colors.surface : colors.warningSoft,
          borderColor: connected ? colors.border : colors.warningSoft,
        },
      ]}
    >
      {connected ? <Radio size={14} color={colors.success} strokeWidth={2.4} /> : <WifiOff size={14} color={colors.warningText} strokeWidth={2.4} />}
      <AppText variant="caption" color={connected ? 'textSecondary' : 'warningText'} numberOfLines={2} style={{ flexShrink: 1 }}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
});
