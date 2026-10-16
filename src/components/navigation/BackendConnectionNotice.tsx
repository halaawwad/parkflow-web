import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { InlineNotice } from '@/components/ui/InlineNotice';
import { useApiConnectionStore } from '@/store/apiConnectionStore';
import { useLocale } from '@/hooks/useLocale';
import { spacing, screenPadding } from '@/theme/spacing';
import { zIndex } from '@/theme/zIndex';

export function BackendConnectionNotice() {
  const slowRequests = useApiConnectionStore(s => s.slowRequests);
  const { locale } = useLocale();
  const insets = useSafeAreaInsets();
  if (!slowRequests) return null;
  return <View pointerEvents="none" style={{ position: 'absolute', top: insets.top + spacing.sm,
    left: screenPadding, right: screenPadding, zIndex: zIndex.toast }}>
    <InlineNotice tone="info"
      title={locale === 'ar' ? 'جارٍ الاتصال بالخادم…' : 'Connecting to ParkFlow…'}
      body={locale === 'ar'
        ? 'قد يحتاج الخادم بعض الوقت ليصبح جاهزًا. يرجى الانتظار؛ مشكلة اتصال مؤقتة لا تنهي جلستك.'
        : 'The server may need time to start. Please wait; temporary connection issues will not sign you out.'} />
  </View>;
}
