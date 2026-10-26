import { View } from 'react-native';
import { ShieldCheck, ShieldX, TrafficCone, CircleHelp } from 'lucide-react-native';
import { AppText } from '@/components/ui/AppText';
import { useTheme } from '@/theme/ThemeProvider';
import type { ColorScheme } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { shadow } from '@/theme/shadows';
import type { CheckpointStatus } from '@/types';
import type { CheckpointDirection } from '@/types/road';
import { useLocale } from '@/hooks/useLocale';

type PassageStatus = Pick<CheckpointDirection, 'id' | 'status'>;
export function checkpointDisplayStatus(passages: PassageStatus[] | undefined, fallback: CheckpointStatus): CheckpointStatus {
  return (['closed', 'severe', 'congested', 'conflicting', 'unknown', 'open'] as CheckpointStatus[])
    .find(status => passages?.some(p => p.status === status)) ?? fallback;
}

export function checkpointColor(
  status: CheckpointStatus,
  _assumed: boolean,
  colors: ColorScheme,
): string {
  if (status === 'unknown' || status === 'conflicting') return colors.textTertiary;
  if (status === 'closed') return colors.danger;
  if ((status === 'congested' || status === 'severe')) return colors.warning;
  return colors.success;
}

export function CheckpointIcon({
  status,
  color,
  size = 14,
}: {
  status: CheckpointStatus;
  color: string;
  size?: number;
}) {
  const Icon = status === 'unknown' || status === 'conflicting' ? CircleHelp : status === 'closed' ? ShieldX : (status === 'congested' || status === 'severe') ? TrafficCone : ShieldCheck;
  return <Icon size={size} color={color} strokeWidth={2.4} />;
}

export interface CheckpointMarkerProps {
  status: CheckpointStatus;
  assumed: boolean;
  label?: string;
  directions?: PassageStatus[];
  zoom?: number;
}

/** Map pin for a checkpoint: status colour and icon, so it never relies on colour alone. */
export function CheckpointMarker({ status, assumed, label, directions, zoom = 15 }: CheckpointMarkerProps) {
  const { colors } = useTheme();
  const { t, row } = useLocale();
  const displayStatus = checkpointDisplayStatus(directions, status);
  const color = checkpointColor(displayStatus, assumed, colors);
  const compact = zoom < 14;
  const tiny = zoom < 11;

  if (compact) {
    return <View
      accessible
      accessibilityLabel={[label, ...(directions ?? []).map(p => `${t(p.id === 'entrance' ? 'roads.entrance' : 'roads.exit')}: ${t(`roads.status.${p.status}`)}`)].filter(Boolean).join(', ')}
      style={[{
        flexDirection: row, alignItems: 'center', gap: tiny ? 3 : 4,
        padding: tiny ? 3 : 4, borderRadius: radius.pill,
        borderWidth: 1, borderColor: color, backgroundColor: colors.surface,
      }, shadow.sm]}
    >
      {directions?.length ? directions.map(p => {
        const passageColor = checkpointColor(p.status, assumed, colors);
        return tiny
          ? <View key={p.id} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: passageColor }} />
          : <CheckpointIcon key={p.id} status={p.status} color={passageColor} size={11} />;
      }) : <CheckpointIcon status={displayStatus} color={color} size={tiny ? 9 : 11} />}
    </View>;
  }

  return (
    <View
      style={[
        {
          alignItems: 'stretch',
          gap: 4,
          paddingVertical: 4,
          paddingHorizontal: 8,
          borderRadius: directions?.length ? radius.lg : radius.pill,
          borderWidth: 2,
          borderColor: color,
          backgroundColor: colors.surface,
        },
        shadow.sm,
      ]}
    >
      <View style={{ flexDirection: row, alignItems: 'center', gap: 4 }}>
        <CheckpointIcon status={displayStatus} color={color} />
        {label ? (
          <AppText variant="caption" numberOfLines={1} style={{ maxWidth: 160 }}>
            {label}
          </AppText>
        ) : null}
      </View>
      {directions?.map(passage => {
        const passageColor = checkpointColor(passage.status, assumed, colors);
        return <View key={passage.id} style={{ flexDirection: row, alignItems: 'center', gap: 4 }}>
          <CheckpointIcon status={passage.status} color={passageColor} size={12} />
          <AppText variant="caption" style={{ color: passageColor }}>
            {t(passage.id === 'entrance' ? 'roads.entrance' : 'roads.exit')}: {t(`roads.status.${passage.status}`)}
          </AppText>
        </View>;
      })}
    </View>
  );
}
