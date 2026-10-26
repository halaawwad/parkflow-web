import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env';
import { clearVoiceCache, pcmToWav, speak } from '../src/modules/voice/service';

const originalKey = env.GEMINI_API_KEY;
const originalVoiceKey = env.GEMINI_TTS_API_KEY;
beforeEach(() => {
  env.GEMINI_TTS_API_KEY = undefined;
});
afterEach(() => {
  env.GEMINI_API_KEY = originalKey;
  env.GEMINI_TTS_API_KEY = originalVoiceKey;
  clearVoiceCache();
  vi.unstubAllGlobals();
});

const pcm = Buffer.from([1, 0, 2, 0, 3, 0, 4, 0]);
const geminiAudio = (mimeType = 'audio/L16;codec=pcm;rate=24000') => ({
  ok: true,
  status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType, data: pcm.toString('base64') } }] } }] }),
});

describe('navigation voice', () => {
  it('wraps Gemini PCM in a playable WAV file', () => {
    const wav = pcmToWav(pcm, 24000);
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    expect(wav.subarray(8, 12).toString()).toBe('WAVE');
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(pcm.length);
    expect(wav.length).toBe(44 + pcm.length);
  });

  it('asks Gemini for audio in the configured voice and caches repeated sentences', async () => {
    env.GEMINI_API_KEY = 'test-key';
    const fetchMock = vi.fn().mockResolvedValue(geminiAudio('audio/L16;codec=pcm;rate=16000'));
    vi.stubGlobal('fetch', fetchMock);

    const first = await speak('انعطف يمينًا.', 'ar');
    const second = await speak('انعطف يمينًا.', 'ar');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain(`/models/${env.GEMINI_TTS_MODEL}:generateContent`);
    expect(init.headers['x-goog-api-key']).toBe('test-key');
    const body = JSON.parse(init.body);
    expect(body.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe(env.GEMINI_TTS_VOICE);
    expect(body.contents[0].parts[0].text).toContain('انعطف يمينًا.');

    expect(first.mimeType).toBe('audio/wav');
    const wav = Buffer.from(first.audio, 'base64');
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(second).toBe(first);
  });

  it('uses the dedicated voice key when one is set', async () => {
    env.GEMINI_API_KEY = 'shared-key';
    env.GEMINI_TTS_API_KEY = 'voice-key';
    const fetchMock = vi.fn().mockResolvedValue(geminiAudio());
    vi.stubGlobal('fetch', fetchMock);
    await speak('Turn left.', 'en');
    expect(fetchMock.mock.calls[0]![1].headers['x-goog-api-key']).toBe('voice-key');
  });

  it('works with only the dedicated voice key', async () => {
    env.GEMINI_API_KEY = undefined;
    env.GEMINI_TTS_API_KEY = 'voice-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(geminiAudio()));
    await expect(speak('Turn left.', 'en')).resolves.toMatchObject({ mimeType: 'audio/wav' });
  });

  it('passes WAV audio from Gemini 3.8 TTS through without a second header', async () => {
    env.GEMINI_API_KEY = 'test-key';
    const wav = pcmToWav(pcm, 24000);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } }] } }] }),
      }),
    );
    const result = await speak('Turn right.', 'en');
    expect(result.mimeType).toBe('audio/wav');
    expect(Buffer.from(result.audio, 'base64').equals(wav)).toBe(true);
  });

  it('recognises a WAV file by its header even under another mime type', async () => {
    env.GEMINI_API_KEY = 'test-key';
    const wav = pcmToWav(pcm, 24000);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ...geminiAudio(), json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: wav.toString('base64') } }] } }] }) }));
    const result = await speak('Turn right.', 'en');
    expect(Buffer.from(result.audio, 'base64').equals(wav)).toBe(true);
  });

  it('shares one provider call between simultaneous requests for the same sentence', async () => {
    env.GEMINI_API_KEY = 'test-key';
    const fetchMock = vi.fn().mockResolvedValue(geminiAudio());
    vi.stubGlobal('fetch', fetchMock);
    await Promise.all([speak('Turn left.', 'en'), speak('Turn left.', 'en'), speak('Turn left.', 'en')]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a missing key, rate limits and empty responses clearly', async () => {
    env.GEMINI_API_KEY = undefined;
    await expect(speak('Turn left.', 'en')).rejects.toMatchObject({ status: 503, code: 'VOICE_NOT_CONFIGURED' });

    env.GEMINI_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) }));
    await expect(speak('Turn left.', 'en')).rejects.toMatchObject({ status: 429, code: 'VOICE_RATE_LIMITED' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{}] } }] }) }));
    await expect(speak('Turn right.', 'en')).rejects.toMatchObject({ status: 502, code: 'VOICE_MALFORMED' });
  });
});
