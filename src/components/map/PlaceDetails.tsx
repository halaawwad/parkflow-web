import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppButton, AppText } from '@/components/ui';
import { useLocale } from '@/hooks/useLocale';
import { useTheme } from '@/theme/ThemeProvider';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';

/**
 * Shared presentation for the place sheets on the map (EV stations, car
 * services, tourism places): facts on one recessed tray, notes beneath, then
 * actions, so every place reads in the same order as the parking zone sheet.
 */

export type DetailRow = [label: string, value: ReactNode];

/** Label above value, hairline between rows. Rows with no value are dropped. */
export function DetailList({ rows }: { rows: DetailRow[] }) {
  const { colors } = useTheme();
  const visible = rows.filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (visible.length === 0) return null;

  return (
    <View
      style={{
        borderRadius: radius.lg,
        backgroundColor: colors.background,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: colors.divider,
        overflow: 'hidden',
      }}
    >
      {visible.map(([label, value], index) => (
        <View
          key={`${label}-${index}`}
          style={{
            gap: 2,
            paddingVertical: spacing.sm + 2,
            paddingHorizontal: spacing.md + 2,
            borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth * 2,
            borderTopColor: colors.divider,
          }}
        >
          {label ? <AppText variant="caption" color="textTertiary">{label}</AppText> : null}
          {typeof value === 'string' ? <AppText variant="bodySm">{value}</AppText> : value}
        </View>
      ))}
    </View>
  );
}

/** Small print under the facts: disclaimers, data notes. */
export function DetailNote({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warning' | 'danger' }) {
  return (
    <AppText variant="caption" color={tone === 'warning' ? 'warningText' : tone === 'danger' ? 'danger' : 'textTertiary'}>
      {children}
    </AppText>
  );
}

/** A location caveat: a warning tint, so it is noticed without shouting. */
export function DetailCaveat({ title, body }: { title: string; body: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 2, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningSoft }}>
      <AppText variant="label" color="warningText">{title}</AppText>
      <AppText variant="caption" color="warningText">{body}</AppText>
    </View>
  );
}

/**
 * The action block: one primary (route) and a wrap of quiet link chips (call,
 * website, sources), then close. Chips share the flat-track style of header actions.
 */
export function DetailActions({
  routeLabel,
  onRoute,
  links,
  closeLabel,
  onClose,
}: {
  routeLabel: string;
  onRoute: () => void;
  links: { key: string; label: string; onPress: () => void }[];
  closeLabel: string;
  onClose: () => void;
}) {
  const { row } = useLocale();
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <AppButton label={routeLabel} size="md" onPress={onRoute} />
      {links.length ? (
        <View style={{ flexDirection: row, flexWrap: 'wrap', gap: spacing.sm }}>
          {links.map((link) => (
            <AppButton
              key={link.key}
              label={link.label}
              size="sm"
              variant="ghost"
              fullWidth={false}
              onPress={link.onPress}
              style={{ flexGrow: 1, paddingHorizontal: spacing.md, backgroundColor: colors.track }}
            />
          ))}
        </View>
      ) : null}
      <AppButton label={closeLabel} variant="ghost" size="sm" onPress={onClose} />
    </View>
  );
}
