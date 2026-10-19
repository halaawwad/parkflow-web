import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { LogoMark } from '@/components/brand/Logo';
import { AppText } from '@/components/ui/AppText';
import { useLocale } from '@/hooks/useLocale';
import { useTheme } from '@/theme/ThemeProvider';
import { WEB_APP_MAX_WIDTH, WEB_VIEWPORT_HEIGHT, useWebFrame } from './appShellMetrics';

const STYLE_ID = 'parkflow-web-polish';

/**
 * Global web polish that React Native styles cannot express: a visible
 * keyboard focus ring on every control (and none for mouse or touch), crisp
 * font rendering, brand text selection, quiet scrollbars and no grey tap flash.
 */
function useWebPolish(brand: string, focusRing: string) {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const css = `
      html, body { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-rendering: optimizeLegibility; }
      * { -webkit-tap-highlight-color: transparent; }
      ::selection { background: ${brand}33; }
      :focus { outline: none; }
      :focus-visible { outline: 2.5px solid ${focusRing} !important; outline-offset: 2px !important; }
      input:focus-visible, textarea:focus-visible { outline-offset: 0 !important; }
      * { scrollbar-width: thin; scrollbar-color: ${brand}40 transparent; }
      *::-webkit-scrollbar { width: 8px; height: 8px; }
      *::-webkit-scrollbar-thumb { background: ${brand}40; border-radius: 8px; }
      *::-webkit-scrollbar-track { background: transparent; }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { animation-duration: 1ms !important; animation-delay: 0ms !important; transition-duration: 1ms !important; }
      }
    `;
    let tag = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!tag) {
      tag = document.createElement('style');
      tag.id = STYLE_ID;
      document.head.appendChild(tag);
    }
    tag.textContent = css;
  }, [brand, focusRing]);
}

/** Keeps the web build at phone dimensions without changing native layouts. */
export function WebAppShell({ children }: { children: ReactNode }) {
  const { colors, isDark } = useTheme();
  const { t } = useLocale();
  const { staged, height: frameHeight, radius } = useWebFrame();
  useWebPolish(colors.brand, isDark ? colors.brand : colors.info);

  return (
    <View style={[styles.stage, { height: WEB_VIEWPORT_HEIGHT, backgroundColor: colors.deepAlt }]}>
      {staged ? (
        <>
          {/* Soft brand light behind the device column. */}
          <View pointerEvents="none" style={[styles.glow, { backgroundColor: colors.deep }]} />
          <View pointerEvents="none" style={styles.caption} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <LogoMark size={36} tone="dark" />
            <AppText variant="title" color="onDeep">ParkFlow</AppText>
            <AppText variant="caption" color="onDeepMuted">{t('brand.tagline')}</AppText>
          </View>
        </>
      ) : null}
      <View
        style={[
          styles.column,
          { backgroundColor: colors.background, maxWidth: WEB_APP_MAX_WIDTH },
          staged
            ? [styles.frame, { height: frameHeight, borderRadius: radius, borderColor: 'rgba(255,255,255,0.10)' }]
            : { height: WEB_VIEWPORT_HEIGHT },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { width: '100%', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  glow: {
    position: 'absolute',
    width: 1100,
    height: 1100,
    borderRadius: 550,
    opacity: 0.55,
    // Web-only blur gives the stage depth without an image asset.
    filter: 'blur(120px)',
  } as object,
  caption: { position: 'absolute', top: 32, left: 40, flexDirection: 'row', alignItems: 'center', gap: 12, opacity: 0.92 },
  // Explicit basis: RN Web turns `flex: 0` into a zero basis that would override the height.
  column: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', width: '100%', minWidth: 0, overflow: 'hidden', position: 'relative' },
  frame: {
    borderWidth: 1,
    boxShadow: '0 40px 120px rgba(0,0,0,0.45), 0 12px 32px rgba(0,0,0,0.25)',
  } as object,
});
