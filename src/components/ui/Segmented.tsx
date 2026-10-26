import { useEffect, useRef, useState } from 'react';
import { ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';
import { useTheme } from '@/theme/ThemeProvider';
import { radius } from '@/theme/radius';
import { shadow } from '@/theme/shadows';
import { spacing } from '@/theme/spacing';
import { useLocale } from '@/hooks/useLocale';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Optional count shown after the label, e.g. filter result totals. */
  badge?: number;
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** `pills` scroll horizontally; `inset` fills the width evenly. */
  variant?: 'pills' | 'inset';
  style?: StyleProp<ViewStyle>;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  variant = 'pills',
  style,
}: SegmentedProps<T>) {
  const { colors } = useTheme();
  const { row, isRTL } = useLocale();
  const scrollRef = useRef<ScrollView>(null);
  // Where each pill sits in the scroll row, so the selected one can be brought into view.
  const pillX = useRef<Record<string, { x: number; width: number }>>({});
  const [viewportWidth, setViewportWidth] = useState(0);
  const revealSelected = () => {
    const pill = pillX.current[value];
    if (!pill || !viewportWidth) {
      // RTL rows are laid out from the right edge, but scrolling starts at the left.
      if (isRTL) scrollRef.current?.scrollToEnd({ animated: false });
      return;
    }
    const centred = pill.x + pill.width / 2 - viewportWidth / 2;
    scrollRef.current?.scrollTo({ x: Math.max(0, centred), animated: false });
  };
  // Only when the selection or the row's width changes, so a user's own scrolling is left alone.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(revealSelected, [value, viewportWidth]);

  const items = options.map((option) => {
    const active = option.value === value;
    return (
      <PressableScale
        key={option.value}
        onLayout={variant === 'inset' ? undefined : (event) => {
          pillX.current[option.value] = { x: event.nativeEvent.layout.x, width: event.nativeEvent.layout.width };
          if (option.value === value) revealSelected();
        }}
        onPress={() => onChange(option.value)}
        haptic="select"
        scaleTo={0.96}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        accessibilityLabel={option.label}
        style={{
          flex: variant === 'inset' ? 1 : undefined,
          flexDirection: row,
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.xs + 2,
          paddingHorizontal: variant === 'inset' ? spacing.sm : spacing.lg,
          minHeight: 44,
          borderRadius: variant === 'inset' ? radius.sm : radius.pill,
          // The selected inset segment is a raised chip on the track.
          ...(active && variant === 'inset' ? shadow.xs : null),
          // Inactive pills sit on the recessed track so they read as controls, not loose text.
          backgroundColor: active
            ? variant === 'inset'
              ? colors.surface
              : colors.brandSoft
            : variant === 'inset'
              ? 'transparent'
              : colors.track,
        }}
      >
        <AppText
          variant="label"
          numberOfLines={1}
          style={{
            color: active
              ? variant === 'inset'
                ? colors.text
                : colors.successText
              : colors.textSecondary,
          }}
        >
          {option.label}
        </AppText>
        {option.badge != null && option.badge > 0 ? (
          <AppText
            variant="caption"
            numeric
            style={{ color: active ? colors.successText : colors.textTertiary }}
          >
            {option.badge}
          </AppText>
        ) : null}
      </PressableScale>
    );
  });

  if (variant === 'inset') {
    return (
      <View
        style={[
          {
            flexDirection: row,
            padding: 4,
            gap: 4,
            borderRadius: radius.md,
            backgroundColor: colors.track,
          },
          style,
        ]}
      >
        {items}
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      // Without flexGrow 0 a horizontal row stretches to fill a vertical scroll container.
      style={[{ flexGrow: 0 }, style]}
      contentContainerStyle={{ flexDirection: row, gap: spacing.sm }}
      onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}
      onContentSizeChange={revealSelected}
    >
      {items}
    </ScrollView>
  );
}
