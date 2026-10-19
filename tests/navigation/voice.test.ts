import { describe, expect, it } from 'vitest';
import { SpeechQueue, type SpeechEngine, type SpeechQueueStatus } from '@/utils/navigation/speechQueue';
import { announcementDistances, markSpoken, planAnnouncement, tierKey } from '@/utils/navigation/voiceScheduler';
import { fixtures, navRoute } from './helpers';
import { computeProgress } from '@/utils/navigation/progress';

class FakeEngine implements SpeechEngine {
  isSpeaking?: () => boolean;
  log: string[] = [];
  active?: { text: string; done: () => void; stopped: () => void; error: (e: unknown) => void };
  speak(text: string, cb: { onDone: () => void; onStopped: () => void; onError: (e: unknown) => void }) {
    if (this.active) throw new Error(`overlap: "${text}" while "${this.active.text}" is playing`);
    this.log.push(text);
    this.active = { text, done: cb.onDone, stopped: cb.onStopped, error: cb.onError };
  }
  stop() {
    const active = this.active;
    this.active = undefined;
    active?.stopped();
  }
  finish() {
    const active = this.active;
    this.active = undefined;
    active?.done();
  }
  fail(error: unknown) {
    const active = this.active;
    this.active = undefined;
    active?.error(error);
  }
}

function fakeTimers() {
  let now = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let id = 0;
  return {
    now: () => now,
    setTimeout: (fn: () => void, ms: number) => {
      timers.set(++id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (handle: unknown) => void timers.delete(handle as number),
    advance(ms: number) {
      now += ms;
      for (const [key, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(key);
          timer.fn();
        }
      }
    },
  };
}

function setup() {
  const engine = new FakeEngine();
  const timers = fakeTimers();
  const statuses: SpeechQueueStatus[] = [];
  const queue = new SpeechQueue(engine, (s) => statuses.push(s), timers);
  return { engine, timers, queue, statuses };
}

describe('speech queue', () => {
  it('never overlaps and keeps only the newest waiting prompt', () => {
    const { engine, queue } = setup();
    queue.enqueue({ text: 'one' });
    queue.enqueue({ text: 'two' });
    queue.enqueue({ text: 'three' });
    engine.finish();
    engine.finish();
    expect(engine.log).toEqual(['one', 'three']);
  });

  it('lets an urgent prompt cut off a routine one', () => {
    const { engine, queue } = setup();
    queue.enqueue({ text: 'Continue straight for 2 kilometers.' });
    queue.enqueue({ text: 'Turn right.', priority: 'high' });
    expect(engine.log).toEqual(['Continue straight for 2 kilometers.', 'Turn right.']);
    expect(engine.active?.text).toBe('Turn right.');
  });

  it('suppresses the same sentence said moments ago', () => {
    const { engine, queue, timers } = setup();
    queue.enqueue({ text: 'Route updated.' });
    engine.finish();
    queue.enqueue({ text: 'Route updated.' });
    expect(engine.log).toHaveLength(1);
    timers.advance(7000);
    queue.enqueue({ text: 'Route updated.' });
    expect(engine.log).toHaveLength(2);
  });

  it('mutes immediately, stays silent, and repeats the last instruction on request', () => {
    const { engine, queue } = setup();
    queue.enqueue({ text: 'In 200 meters, turn left.', instruction: true });
    queue.setMuted(true);
    expect(engine.active).toBeUndefined();
    queue.enqueue({ text: 'Turn left.', instruction: true, priority: 'high' });
    expect(engine.log).toEqual(['In 200 meters, turn left.']);
    expect(queue.repeat()).toBe(false);
    queue.setMuted(false);
    // The latest instruction is remembered even while muted.
    expect(queue.repeat()).toBe(true);
    expect(engine.log).toEqual(['In 200 meters, turn left.', 'Turn left.']);
    engine.finish();
    expect(queue.repeat()).toBe(true);
    expect(engine.log[2]).toBe('Turn left.');
  });

  it('never lets a routine prompt displace a waiting urgent one', () => {
    const { engine, queue } = setup();
    queue.enqueue({ text: 'Turn left, then turn right.', priority: 'high' });
    queue.enqueue({ text: 'At the roundabout, take the second exit.', priority: 'high' });
    queue.enqueue({ text: 'Continue straight for 1 kilometer.' });
    engine.finish();
    expect(engine.active?.text).toBe('At the roundabout, take the second exit.');
    engine.finish();
    expect(engine.active?.text).toBe('Continue straight for 1 kilometer.');
  });

  it('drops a waiting prompt whose maneuver has already been passed', () => {
    const { engine, queue } = setup();
    let passed = false;
    queue.enqueue({ text: 'Turn left, then turn right.', priority: 'high' });
    queue.enqueue({ text: 'Bear right.', priority: 'high', isCurrent: () => !passed });
    queue.enqueue({ text: 'Continue straight for 600 meters.' });
    passed = true;
    engine.finish();
    expect(engine.log).toEqual(['Turn left, then turn right.', 'Continue straight for 600 meters.']);
  });

  it('stays usable after being silenced, and a new session cannot repeat the previous trip', () => {
    const { engine, queue } = setup();
    queue.enqueue({ text: 'You have arrived at your destination.', instruction: true });
    queue.clear(); // what an unmount or dev remount does
    queue.enqueue({ text: 'Navigation started.' });
    expect(engine.active?.text).toBe('Navigation started.');
    engine.finish();
    queue.reset(); // a new navigation session
    expect(queue.repeat()).toBe(false);
    queue.setMuted(true);
    queue.enqueue({ text: 'In 90 meters, turn left.', instruction: true });
    queue.setMuted(false);
    expect(queue.repeat()).toBe(true);
    expect(engine.active?.text).toBe('In 90 meters, turn left.');
  });

  it('recovers when the platform never reports the end of an utterance', () => {
    const { engine, queue, timers } = setup();
    queue.enqueue({ text: 'first' });
    queue.enqueue({ text: 'second' });
    engine.active = undefined; // the engine silently lost the callback
    timers.advance(10_000);
    expect(engine.log).toEqual(['first', 'second']);
  });

  it('waits for a slow voice that is still audibly speaking past its estimate', () => {
    const { engine, queue, timers } = setup();
    let speaking = true;
    engine.isSpeaking = () => speaking;
    queue.enqueue({ text: 'انعطف يسارًا، ثم انعطف يمينًا.' });
    queue.enqueue({ text: 'انعطف يمينًا.' });
    timers.advance(9_000);
    expect(engine.log).toHaveLength(1);
    speaking = false;
    engine.active = undefined; // the end event was lost
    timers.advance(1_000);
    expect(engine.log).toEqual(['انعطف يسارًا، ثم انعطف يمينًا.', 'انعطف يمينًا.']);
  });

  it('reports a browser autoplay block and clears it after a successful utterance', () => {
    const { engine, queue, statuses } = setup();
    queue.enqueue({ text: 'Navigation started.' });
    engine.fail({ error: 'not-allowed' });
    expect(statuses[statuses.length - 1]).toMatchObject({ blocked: true, errors: 1, speaking: false });
    queue.enqueue({ text: 'Turn right.' });
    engine.finish();
    expect(statuses[statuses.length - 1]).toMatchObject({ blocked: false, speaking: false });
  });
});

describe('voice scheduling', () => {
  it('scales announcement distances with speed', () => {
    const slow = announcementDistances(3);
    const fast = announcementDistances(22);
    expect(slow.prepare).toBeLessThan(fast.prepare);
    expect(slow.now).toBe(25);
    expect(fast.far).toBeGreaterThan(900);
  });

  it('skips stale earlier prompts when the driver is already at the turn', () => {
    const route = navRoute(fixtures.manara);
    const turn = route.maneuvers[3]!;
    const progress = computeProgress(route, turn.location, turn.along - 30, 200, 30);
    const spoken = new Set<string>();
    const announcement = planAnnouncement({ route, progress: { ...progress, nextIndex: 3, distanceToNext: 20 }, speed: 8, spoken, locale: 'en' })!;
    expect(announcement.tier).toBe('now');
    markSpoken(spoken, announcement);
    expect(spoken.has(tierKey(turn.id, 'prepare'))).toBe(true);
    expect(planAnnouncement({ route, progress: { ...progress, nextIndex: 3, distanceToNext: 15 }, speed: 8, spoken, locale: 'en' })).toBeUndefined();
  });

  it('chains two turns that come in quick succession', () => {
    const route = navRoute(fixtures.manara);
    // Al-Yarmouk (end of road, left) is 34 m before the right onto شارع القدس.
    const index = route.maneuvers.findIndex((m) => m.street === 'Al-Yarmouk');
    const progress = computeProgress(route, route.maneuvers[index]!.location, route.maneuvers[index]!.along - 10, 200, 30);
    const announcement = planAnnouncement({ route, progress: { ...progress, nextIndex: index, distanceToNext: 10 }, speed: 6, spoken: new Set(), locale: 'en' });
    expect(announcement?.text).toBe('Turn left onto Al-Yarmouk, then turn right.');
    // The chained turn was just described, so its "in X meters" warning is not repeated.
    const spoken = new Set<string>();
    markSpoken(spoken, announcement!);
    const following = route.maneuvers[index + 1]!;
    expect(spoken.has(tierKey(following.id, 'prepare'))).toBe(true);
    expect(spoken.has(tierKey(following.id, 'now'))).toBe(false);
  });
});
