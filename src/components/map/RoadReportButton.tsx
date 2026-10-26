import { TriangleAlert } from 'lucide-react-native';
import { AppText } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { useLocale } from '@/hooks/useLocale';
import { useTheme } from '@/theme/ThemeProvider';
import { radius } from '@/theme/radius';
import { shadow } from '@/theme/shadows';
import { spacing } from '@/theme/spacing';

export function RoadReportButton({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  const { t, row } = useLocale();
  return (
    <PressableScale
      onPress={onPress}
      haptic="light"
      scaleTo={0.96}
      accessibilityRole="button"
      accessibilityLabel={t('roadReports.report')}
      style={[{
        flexDirection: row,
        alignItems: 'center',
        gap: spacing.xs + 2,
        flexShrink: 0,
        paddingStart: spacing.md,
        paddingEnd: spacing.md + 2,
        height: 44,
        borderRadius: radius.pill,
        backgroundColor: colors.deep,
      }, shadow.sm]}
    >
      {/* Brass marks the one action on the map that reports a hazard. */}
      <TriangleAlert color={colors.accent} size={16} strokeWidth={2.3} />
      <AppText variant="buttonSm" style={{ color: colors.onDeep }}>{t('roadReports.report')}</AppText>
    </PressableScale>
  );
}
