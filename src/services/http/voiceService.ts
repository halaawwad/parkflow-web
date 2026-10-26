import type { VoiceService } from '../types';
import { api } from './apiClient';

export const httpVoiceService: VoiceService = {
  speak(text, locale, priority) {
    return api<{ mimeType: string; audio: string }>('/voice/speak', { method: 'POST', body: { text, locale, priority } });
  },
};
