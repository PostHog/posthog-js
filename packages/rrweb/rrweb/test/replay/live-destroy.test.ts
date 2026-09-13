/**
 * @vitest-environment jsdom
 */
import { vi } from 'vitest';
import {
  EventType,
  ReplayerEvents,
  type eventWithTime,
} from '@posthog/rrweb-types';
import { Replayer } from '../../src/replay';

const customEvent = (timestamp: number): eventWithTime => ({
  type: EventType.Custom,
  timestamp,
  data: { tag: 'queued-before-destroy', payload: null },
});

describe('destroying live playback', () => {
  let replayer: Replayer | undefined;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        'Date',
        'performance',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'setTimeout',
        'clearTimeout',
      ],
    });
  });

  afterEach(() => {
    replayer?.destroy();
    vi.useRealTimers();
  });

  it.each([true, false])(
    'cancels queued callbacks and frames (liveMode=%s)',
    async (liveMode) => {
      const now = Date.now();
      replayer = new Replayer(
        liveMode ? [] : [customEvent(now), customEvent(now + 100)],
        {
          liveMode,
          mouseTail: false,
        },
      );
      if (liveMode) {
        replayer.startLive(now);
        replayer.addEvent(customEvent(now + 100));
        // addEvent enqueues through a microtask, before destroy is called.
        await Promise.resolve();
      } else {
        replayer.play(1);
      }
      const callback = vi.fn();
      replayer.on(ReplayerEvents.CustomEvent, callback);
      expect(replayer.timer.isActive()).toBe(true);
      expect(replayer.timer['actions']).toHaveLength(1);
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      replayer.destroy();
      expect(() => replayer!.destroy()).not.toThrow();
      expect(replayer.timer.isActive()).toBe(false);
      expect(replayer.timer['actions']).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);

      vi.advanceTimersByTime(250);
      expect(callback).not.toHaveBeenCalled();
      expect(replayer.timer.isActive()).toBe(false);
    },
  );

  it('clears a live timer waiting for its next event', () => {
    replayer = new Replayer([], { liveMode: true, mouseTail: false });
    replayer.startLive(Date.now());
    vi.advanceTimersByTime(20);
    expect(replayer.timer.isActive()).toBe(true);
    expect(replayer.timer['actions']).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);

    replayer.destroy();

    expect(replayer.timer.isActive()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('delivers queued live events before destruction', async () => {
    const now = Date.now();
    replayer = new Replayer([], { liveMode: true, mouseTail: false });
    const callback = vi.fn();
    replayer.on(ReplayerEvents.CustomEvent, callback);
    replayer.startLive(now);
    replayer.addEvent(customEvent(now + 100));
    await Promise.resolve();

    vi.advanceTimersByTime(250);

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining(customEvent(now + 100)),
    );
  });
});
