/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EventType,
  ReplayerEvents,
  type eventWithTime,
} from '@posthog/rrweb-types';
import { Replayer } from '../../src/replay';

const events: eventWithTime[] = [
  {
    type: EventType.Meta,
    data: { width: 800, height: 600, href: '' },
    timestamp: 1000,
  },
  {
    type: EventType.Custom,
    data: { tag: 'queued-before-destroy', payload: null },
    timestamp: 1100,
  },
];

describe('Replayer.destroy after host children are cleared', () => {
  let root: HTMLDivElement;
  let replayer: Replayer;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'performance',
      ],
    });
    root = document.createElement('div');
    document.body.appendChild(root);
    replayer = new Replayer(events, { root, mouseTail: false });
  });

  afterEach(() => {
    // Contain pending work even when a teardown assertion fails.
    replayer.timer.clear();
    replayer.destroy();
    root.remove();
    vi.useRealTimers();
  });

  it('delivers the queued custom event during ordinary playback', () => {
    const customEvent = vi.fn();
    replayer.on(ReplayerEvents.CustomEvent, customEvent);
    replayer.play(1);
    expect(replayer.timer.isActive()).toBe(true);
    expect(customEvent).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);

    expect(customEvent).toHaveBeenCalledOnce();
  });

  it.each(['attached', 'detached root', 'cleared children'])(
    'cleans up ordinary playback once with %s',
    (hostState) => {
      const customEvent = vi.fn();
      const destroyed = vi.fn();
      const paused = vi.fn();
      replayer.on(ReplayerEvents.CustomEvent, customEvent);
      replayer.on(ReplayerEvents.Destroy, destroyed);
      replayer.on(ReplayerEvents.Pause, paused);
      replayer.play(1);
      expect(replayer.timer.isActive()).toBe(true);
      expect(replayer.timer['actions']).toHaveLength(1);
      expect(replayer['timeouts'].size).toBeGreaterThan(0);
      expect(replayer['emitterHandlers'].length).toBeGreaterThan(0);
      expect(replayer['serviceSubscription']).toBeDefined();
      expect(replayer['speedServiceSubscription']).toBeDefined();

      if (hostState === 'detached root') root.remove();
      if (hostState === 'cleared children') root.replaceChildren();
      replayer.destroy();
      replayer.destroy();
      const cleanup = {
        activeTimer: replayer.timer.isActive(),
        queuedActions: replayer.timer['actions'].length,
        timeouts: replayer['timeouts'].size,
        handlers: replayer['emitterHandlers'].length,
        subscribed: !!replayer['serviceSubscription'],
        speedSubscribed: !!replayer['speedServiceSubscription'],
        destroyEvents: destroyed.mock.calls.length,
        pauseEvents: paused.mock.calls.length,
        wrapperParent: replayer.wrapper.parentNode,
        pendingTimers: vi.getTimerCount(),
      };
      vi.advanceTimersByTime(200);

      expect({
        ...cleanup,
        customEvents: customEvent.mock.calls.length,
      }).toEqual({
        activeTimer: false,
        queuedActions: 0,
        timeouts: 0,
        handlers: 0,
        subscribed: false,
        speedSubscribed: false,
        customEvents: 0,
        destroyEvents: 1,
        pauseEvents: 1,
        wrapperParent: null,
        pendingTimers: 0,
      });
    },
  );
});
