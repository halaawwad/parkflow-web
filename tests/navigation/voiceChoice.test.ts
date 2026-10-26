import { describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ OS: 'web' as string }));
const voices = vi.hoisted(() => ({ list: [] as { identifier: string; name: string; language: string; quality: string }[] }));
vi.mock('react-native', () => ({ Platform: platform, Vibration: { vibrate: () => undefined } }));
vi.mock('expo-haptics', () => ({}));
vi.mock('@/services', () => ({ services: {} }));
vi.mock('@/store/preferencesStore', () => ({ usePreferencesStore: { getState: () => ({ locale: 'ar' }) } }));
vi.mock('expo-speech', () => ({
  VoiceQuality: { Default: 'Default', Enhanced: 'Enhanced' },
  getAvailableVoicesAsync: async () => voices.list,
}));

vi.stubGlobal('__DEV__', false);
const { chooseVoice } = await import('@/utils/navigation/platform');

const voice = (name: string, language = 'ar-SA', quality = 'Default') => ({ identifier: name, name, language, quality });

describe('device voice choice', () => {
  it('marks the legacy Windows Arabic voice as robotic on web', async () => {
    platform.OS = 'web';
    voices.list = [voice('Microsoft Naayf - Arabic (Saudi)')];
    await expect(chooseVoice('ar')).resolves.toMatchObject({ voice: 'Microsoft Naayf - Arabic (Saudi)', natural: false });
  });

  it('prefers and accepts a natural browser voice', async () => {
    platform.OS = 'web';
    voices.list = [voice('Microsoft Naayf - Arabic (Saudi)'), voice('Microsoft Hamed Online (Natural) - Arabic (Saudi Arabia)')];
    await expect(chooseVoice('ar')).resolves.toMatchObject({ voice: 'Microsoft Hamed Online (Natural) - Arabic (Saudi Arabia)', natural: true });
  });

  it('treats phone voices as natural', async () => {
    platform.OS = 'android';
    voices.list = [voice('ar-xa-x-arz-local', 'ar')];
    await expect(chooseVoice('ar')).resolves.toMatchObject({ natural: true });
  });
});
