import type { VoiceService } from '../types';
import { AppError } from '@/utils/errors';
import { api } from './apiClient';

type SpokenAudio = { mimeType: string; audio: string };

export const httpVoiceService: VoiceService = {
  async speak(text, locale, priority) {
    try {
      return await api<SpokenAudio>('/voice/speak', { method: 'POST', body: { text, locale, priority } });
    } catch (error) {
      // The web app can deploy before the API. An API that predates `priority`
      // rejects the unknown field (400): ask again without it.
      if (priority && error instanceof AppError && Number(error.details?.status) === 400) {
        return api<SpokenAudio>('/voice/speak', { method: 'POST', body: { text, locale } });
      }
      throw error;
    }
  },
};
