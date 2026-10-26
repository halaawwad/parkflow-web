import { describe, expect, it } from 'vitest';
import { createNeuralSpeechEngine, type AudioPlayer } from '@/utils/navigation/neuralSpeech';
import type { SpeechEngine } from '@/utils/navigation/speechQueue';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(options: { synthesize?: (text: string, priority: 'now' | 'soon') => Promise<string>; permanent?: (e: unknown) => boolean; onUnavailable?: () => void } = {}) {
  const device: string[] = [];
  const played: string[] = [];
  let playing: { onEnd: () => void; onError: (e: unknown) => void } | undefined;
  const timers = new Map<number, () => void>();
  let id = 0;
  const fallback: SpeechEngine = {
    speak: (text, cb) => {
      device.push(text);
      cb.onDone();
    },
    stop: () => undefined,
  };
  const player: AudioPlayer = {
    play: (source, cb) => {
      played.push(source);
      playing = cb;
    },
    stop: () => {
      playing = undefined;
    },
    isPlaying: () => Boolean(playing),
  };
  const requests: string[] = [];
  const engine = createNeuralSpeechEngine({
    synthesize: options.synthesize ?? ((text) => {
      requests.push(text);
      return Promise.resolve(`audio:${text}`);
    }),
    fallback,
    player,
    isPermanentError: options.permanent,
    onUnavailable: options.onUnavailable,
    timers: {
      setTimeout: (fn) => {
        timers.set(++id, fn);
        return id;
      },
      clearTimeout: (handle) => void timers.delete(handle as number),
    },
  });
  const fireTimers = () => [...timers.values()].forEach((fn) => fn());
  return { engine, device, played, requests, fireTimers, finish: () => playing?.onEnd(), fail: (e: unknown) => playing?.onError(e) };
}

describe('natural navigation voice', () => {
  it('plays prefetched audio immediately, without asking the server again', async () => {
    const { engine, played, requests } = setup();
    engine.prefetch(['Turn right.', 'Turn right.', 'Turn left.']);
    await flush();
    expect(requests).toEqual(['Turn right.', 'Turn left.']);
    let done = false;
    engine.speak('Turn right.', { onDone: () => (done = true), onStopped: () => undefined, onError: () => undefined });
    await flush();
    expect(played).toEqual(['audio:Turn right.']);
    expect(requests).toHaveLength(2);
    expect(engine.isSpeaking?.()).toBe(true);
    expect(done).toBe(false);
  });

  it('falls back to the device voice when the audio is late, and keeps the audio for next time', async () => {
    let resolve!: (source: string) => void;
    const { engine, device, played, fireTimers } = setup({ synthesize: () => new Promise((r) => (resolve = r)) });
    engine.speak('In 200 meters, turn left.', { onDone: () => undefined, onStopped: () => undefined, onError: () => undefined });
    fireTimers(); // the wait deadline passes
    expect(device).toEqual(['In 200 meters, turn left.']);
    resolve('audio:late');
    await flush();
    expect(played).toEqual([]); // never plays over the fallback
    engine.speak('In 200 meters, turn left.', { onDone: () => undefined, onStopped: () => undefined, onError: () => undefined });
    await flush();
    expect(played).toEqual(['audio:late']);
  });

  it('waits longer for natural audio on routine prompts than on urgent ones', async () => {
    const waits: number[] = [];
    const engine = createNeuralSpeechEngine({
      synthesize: () => new Promise(() => undefined),
      fallback: { speak: () => undefined, stop: () => undefined },
      player: { play: () => undefined, stop: () => undefined, isPlaying: () => false },
      timers: { setTimeout: (_fn, ms) => waits.push(ms), clearTimeout: () => undefined },
    });
    const cb = { onDone: () => undefined, onStopped: () => undefined, onError: () => undefined };
    engine.speak('Turn right.', cb, { urgent: true });
    engine.speak('In 300 meters, turn right.', cb, { urgent: false });
    expect(waits[0]).toBe(1200);
    expect(waits[1]).toBe(3500);
  });

  it('stops asking for the session when the service is not configured', async () => {
    const calls: string[] = [];
    const { engine, device } = setup({
      synthesize: (text) => {
        calls.push(text);
        return Promise.reject(new Error('VOICE_NOT_CONFIGURED'));
      },
      permanent: () => true,
    });
    engine.speak('Navigation started.', { onDone: () => undefined, onStopped: () => undefined, onError: () => undefined });
    await flush();
    expect(device).toEqual(['Navigation started.']);
    expect(engine.available).toBe(false);
    engine.speak('Turn right.', { onDone: () => undefined, onStopped: () => undefined, onError: () => undefined });
    engine.prefetch(['Turn left.']);
    await flush();
    expect(calls).toEqual(['Navigation started.']);
    expect(device).toEqual(['Navigation started.', 'Turn right.']);
  });

  it('reports a browser autoplay block instead of hiding it, and falls back on other playback errors', async () => {
    const { engine, device, fail } = setup();
    const errors: unknown[] = [];
    const callbacks = { onDone: () => undefined, onStopped: () => undefined, onError: (e: unknown) => errors.push(e) };
    engine.speak('Turn right.', callbacks);
    await flush();
    fail(Object.assign(new Error('play() failed'), { name: 'NotAllowedError' }));
    expect(errors).toEqual([{ error: 'not-allowed' }]);
    engine.speak('Turn left.', callbacks);
    await flush();
    fail(new Error('decode error'));
    expect(device).toEqual(['Turn left.']);
  });

  it('ignores audio that arrives after the sentence was stopped', async () => {
    let resolve!: (source: string) => void;
    const { engine, played, device } = setup({ synthesize: () => new Promise((r) => (resolve = r)) });
    engine.speak('Turn right.', { onDone: () => undefined, onStopped: () => undefined, onError: () => undefined });
    engine.stop();
    resolve('audio:x');
    await flush();
    expect(played).toEqual([]);
    expect(device).toEqual([]);
  });

  it('asks for the sentence being spoken as urgent and for look-ahead sentences as routine', async () => {
    const asked: [string, string][] = [];
    const { engine } = setup({ synthesize: (text, priority) => (asked.push([text, priority]), Promise.resolve(`audio:${text}`)) });
    engine.prefetch(['Turn left.']);
    engine.speak('Turn right.', { onDone: () => undefined, onStopped: () => undefined, onError: () => undefined });
    await flush();
    expect(asked).toEqual([['Turn left.', 'soon'], ['Turn right.', 'now']]);
  });

  it('gives up once on a spent quota and keeps the rest of the trip in the device voice', async () => {
    let unavailable = 0;
    const quota = new Error('VOICE_RATE_LIMITED');
    const { engine, device } = setup({
      synthesize: () => Promise.reject(quota),
      permanent: (error) => error === quota,
      onUnavailable: () => unavailable++,
    });
    const callbacks = { onDone: () => undefined, onStopped: () => undefined, onError: () => undefined };
    engine.speak('Turn right.', callbacks);
    await flush();
    engine.speak('Turn left.', callbacks);
    engine.speak('Arrived.', callbacks);
    await flush();
    expect(engine.available).toBe(false);
    expect(unavailable).toBe(1);
    expect(device).toEqual(['Turn right.', 'Turn left.', 'Arrived.']);
  });

  it('tries the natural voice again on a new trip after giving up', async () => {
    let attempts = 0;
    const quota = new Error('VOICE_RATE_LIMITED');
    const { engine } = setup({ synthesize: () => (attempts++, Promise.reject(quota)), permanent: (error) => error === quota });
    const callbacks = { onDone: () => undefined, onStopped: () => undefined, onError: () => undefined };
    engine.speak('Turn right.', callbacks);
    await flush();
    expect(engine.available).toBe(false);
    engine.retry();
    expect(engine.available).toBe(true);
    engine.speak('Turn left.', callbacks);
    await flush();
    expect(attempts).toBe(2);
  });
});
