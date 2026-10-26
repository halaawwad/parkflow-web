import { View } from 'react-native';
import { Camera, CameraOff, Pause, Play, RotateCcw, TriangleAlert } from 'lucide-react-native';
import { AppText, PressableScale } from '@/components/ui';
import { useLocale } from '@/hooks/useLocale';
import { useObstacleAwareness } from '@/hooks/useObstacleAwareness';
import type { TurnByTurnNavigation } from '@/hooks/useTurnByTurnNavigation';
import type { TranslationKey } from '@/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { radius } from '@/theme/radius';
import { shadow } from '@/theme/shadows';
import { spacing } from '@/theme/spacing';
import type { ObstacleStatus } from '@/utils/obstacles/warnings';
import { ObstacleCameraPreview } from './ObstacleCameraPreview';

const PREVIEW_W = 72;
const PREVIEW_H = 96;

function statusKey(status: ObstacleStatus): TranslationKey {
  switch (status.state) {
    case 'active': return 'obstacles.active';
    case 'unreliable': return 'obstacles.unreliable';
    case 'paused': return 'obstacles.paused';
    case 'unavailable':
      return status.reason === 'unsupported' ? 'obstacles.unsupported'
        : status.reason === 'permission-denied' ? 'obstacles.permission'
        : status.reason === 'front-camera' ? 'obstacles.noRearCamera'
        : 'obstacles.unavailable';
    default: return 'obstacles.starting';
  }
}

/**
 * Camera obstacle alerts during accessible walking: a small live preview, the
 * monitoring status and one pause / resume control. Mounted only while
 * walking guidance runs, so leaving guidance always releases the camera.
 */
export function ObstacleAwarenessPanel({ nav }: { nav: TurnByTurnNavigation }) {
  const { colors } = useTheme();
  const { t, locale, row, isRTL } = useLocale();
  const obstacles = useObstacleAwareness({ enabled: true, locale, announce: nav.announce });
  const { status } = obstacles;
  const watching = status.state === 'active';
  const warning = status.state === 'unreliable' || status.state === 'unavailable';
  const retryable = status.state === 'unavailable' && (status.reason === 'camera-error' || status.reason === 'model-error');
  const blocked = status.state === 'unavailable' && !retryable && status.reason !== 'background';

  const control = obstacles.paused
    ? { label: t('obstacles.resume'), icon: <Play size={18} color={colors.text} />, onPress: obstacles.resume }
    : retryable
    ? { label: t('obstacles.retry'), icon: <RotateCcw size={18} color={colors.text} />, onPress: obstacles.retry }
    : blocked
    ? undefined
    : { label: t('obstacles.pause'), icon: <Pause size={18} color={colors.text} />, onPress: obstacles.pause };

  return (
    <View
      style={[{
        flexDirection: row,
        alignSelf: isRTL ? 'flex-start' : 'flex-end',
        alignItems: 'center',
        gap: spacing.sm,
        padding: spacing.xs,
        borderRadius: radius.lg,
        backgroundColor: colors.surface,
        maxWidth: 280,
      }, shadow.md]}
    >
      {watching || status.state === 'unreliable' ? <ObstacleCameraPreview stream={obstacles.stream} width={PREVIEW_W} height={PREVIEW_H} /> : null}
      <View style={{ flexShrink: 1, gap: spacing.xs, paddingHorizontal: spacing.xs }}>
        <View accessible accessibilityLabel={`${t('obstacles.title')}: ${t(statusKey(status))}`} style={{ flexDirection: row, alignItems: 'center', gap: spacing.xs }}>
          {warning
            ? status.state === 'unreliable' ? <TriangleAlert size={16} color={colors.warningText} /> : <CameraOff size={16} color={colors.textSecondary} />
            : <Camera size={16} color={watching ? colors.brand : colors.textSecondary} />}
          <AppText variant="caption" color={status.state === 'unreliable' ? 'warningText' : 'textSecondary'} numberOfLines={2} style={{ flexShrink: 1 }}>
            {t(statusKey(status))}
          </AppText>
        </View>
        {control ? (
          <PressableScale
            onPress={control.onPress}
            accessibilityRole="button"
            accessibilityLabel={control.label}
            hitSlop={4}
            style={{ flexDirection: row, alignItems: 'center', gap: spacing.xs, minHeight: 44, minWidth: 44, paddingHorizontal: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceAlt }}
          >
            {control.icon}
            <AppText variant="caption" numberOfLines={1}>{control.label}</AppText>
          </PressableScale>
        ) : null}
      </View>
    </View>
  );
}
