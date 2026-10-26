import { useState } from 'react';
import { StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { Search, X } from 'lucide-react-native';
import { IconButton } from './IconButton';
import { useTheme } from '@/theme/ThemeProvider';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typeFace, maxFontSizeMultiplier } from '@/theme/typography';
import { useLocale } from '@/hooks/useLocale';

export interface SearchFieldProps {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  onSubmit?: () => void;
  autoFocus?: boolean;
  /** Floating variant sits over the map and needs its own elevation. */
  tone?: 'surface' | 'plain';
  trailing?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function SearchField({
  value,
  onChangeText,
  placeholder,
  onSubmit,
  autoFocus = false,
  tone = 'surface',
  trailing,
  style,
  testID,
}: SearchFieldProps) {
  const { colors } = useTheme();
  const { row, textAlign, isRTL, t } = useLocale();
  const [focused, setFocused] = useState(false);
  const inputTextAlign = value.length > 0 ? (/[\u0600-\u06ff]/.test(value) ? 'right' : 'left') : textAlign;
  const inputDirection = value.length > 0 ? (/[\u0600-\u06ff]/.test(value) ? 'rtl' : 'ltr') : undefined;

  return (
    <View
      testID={testID}
      style={[
        {
          flexDirection: row,
          alignItems: 'center',
          gap: spacing.sm + 2,
          height: 48,
          paddingHorizontal: spacing.md + 2,
          borderRadius: radius.lg,
          backgroundColor: tone === 'surface' ? colors.surface : colors.surfaceAlt,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: colors.border,
        },
        style,
        // Focus shows on the field itself (the browser ring is suppressed below).
        focused ? { borderColor: colors.brand } : null,
      ]}
    >
      <Search size={18} color={colors.textTertiary} strokeWidth={2.2} style={{ flexShrink: 0 }} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.placeholder}
        onSubmitEditing={onSubmit}
        autoFocus={autoFocus}
        returnKeyType="search"
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        accessibilityLabel={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        {...({ dataSet: { ownfocus: 'true' } } as object)}
        style={{
          flex: 1,
          // Web inputs carry an intrinsic width; without this they push the icons out of the field.
          minWidth: 0,
          color: colors.text,
          fontFamily: typeFace(isRTL, 'medium'),
          fontWeight: isRTL ? '500' : undefined,
          fontSize: 15,
          textAlign: inputTextAlign,
          writingDirection: inputDirection,
          paddingVertical: 0,
        }}
      />
      {value.length > 0 ? (
        <IconButton
          icon={<X size={16} color={colors.textSecondary} strokeWidth={2.4} />}
          tone="ghost"
          size={28}
          onPress={() => onChangeText('')}
          accessibilityLabel={t('common.close')}
          style={{ backgroundColor: colors.surfaceAlt }}
        />
      ) : (
        trailing
      )}
    </View>
  );
}
