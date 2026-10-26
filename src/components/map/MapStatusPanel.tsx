import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { AppButton, AppText } from '@/components/ui';
import { useLocale } from '@/hooks/useLocale';
import { useTheme } from '@/theme/ThemeProvider';
import { radius } from '@/theme/radius';
import { shadow } from '@/theme/shadows';
import { spacing } from '@/theme/spacing';

/**
 * The floating status card for a non-parking map layer (EV, car services,
 * tourism). Same gutter, radius and headline weight as the nearby-parking
 * panel, so switching layers swaps content, not visual language.
 */
export function MapStatusPanel({
  loading,
  headline,
  trailing,
  children,
}: {
  loading: boolean;
  headline: string;
  trailing?: ReactNode;
  children?: ReactNode;
}) {
  const { row } = useLocale();
  const { colors } = useTheme();

  return (
    <View
      style={[
        {
          gap: spacing.sm + 2,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.lg,
          marginHorizontal: spacing.sm,
          marginBottom: spacing.md,
          borderRadius: radius.xl,
          backgroundColor: colors.surface,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: colors.border,
        },
        shadow.sm,
      ]}
    >
      <View style={{ flexDirection: row, alignItems: 'center', gap: spacing.sm, minHeight: 32 }}>
        {loading ? <ActivityIndicator size="small" color={colors.brand} /> : null}
        <AppText variant="title" numberOfLines={2} style={{ flex: 1 }}>
          {headline}
        </AppText>
        {trailing}
      </View>
      {children}
    </View>
  );
}

/** Explanatory line under the headline: why the list is empty, truncated or failed. */
export function MapStatusNote({ children }: { children: ReactNode }) {
  return (
    <AppText variant="caption" color="textSecondary">
      {children}
    </AppText>
  );
}

/** Retry sits at the reading start, as a real (secondary) button rather than bare text. */
export function MapStatusRetry({ label, onPress }: { label: string; onPress: () => void }) {
  const { alignStart } = useLocale();
  return (
    <AppButton
      size="sm"
      fullWidth={false}
      variant="secondary"
      label={label}
      onPress={onPress}
      style={{ alignSelf: alignStart, minHeight: 40, paddingHorizontal: spacing.lg }}
    />
  );
}

/** A plain list of place names from the current layer, on one recessed tray. */
export function MapStatusNameList({ basis, names, more }: { basis: string; names: string[]; more?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      <AppText variant="caption" color="textTertiary">{basis}</AppText>
      <View style={{ borderRadius: radius.lg, backgroundColor: colors.background, paddingVertical: spacing.xs }}>
        {names.map((name, index) => (
          <AppText
            key={`${name}-${index}`}
            variant="bodySm"
            numberOfLines={1}
            style={{
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.md,
              borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth * 2,
              borderTopColor: colors.divider,
            }}
          >
            {name}
          </AppText>
        ))}
      </View>
      {more ? <AppText variant="caption" color="textSecondary">{more}</AppText> : null}
    </View>
  );
}
