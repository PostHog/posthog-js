// @vitest-environment jsdom
import { vi } from 'vitest';
import { MediaInteractions, ReplayerEvents } from '@posthog/rrweb-types';
import { MediaManager } from '../../src/replay/media';

type ManagerOptions = ConstructorParameters<typeof MediaManager>[0];

function createMediaManager() {
  const handlers = new Map<string, () => void>();
  const warn = vi.fn();
  const mediaManager = new MediaManager({
    warn,
    service: {
      state: { matches: () => true },
    } as unknown as ManagerOptions['service'],
    speedService: {
      subscribe: vi.fn(),
      state: { context: { timer: { speed: 1 } } },
    } as unknown as ManagerOptions['speedService'],
    emitter: {
      on: (event: string, handler: () => void) => handlers.set(event, handler),
    } as unknown as ManagerOptions['emitter'],
    getCurrentTime: () => 0,
  });
  const pausePlayer = () => handlers.get(ReplayerEvents.Pause)!();
  return { mediaManager, warn, pausePlayer };
}

describe('MediaManager', () => {
  // Recordings made before the recorder ignored them can hold media
  // interactions for elements that are not media elements.
  it.each([
    { tagName: 'video', isPaused: true },
    { tagName: 'audio', isPaused: true },
    { tagName: 'div', isPaused: false },
  ])(
    'a recorded pause on a $tagName pauses it: $isPaused, and never warns',
    ({ tagName, isPaused }) => {
      const { mediaManager, warn, pausePlayer } = createMediaManager();
      const pause = vi.fn();
      const target = Object.assign(document.createElement(tagName), { pause });

      mediaManager.mediaMutation({
        target: target as unknown as HTMLMediaElement,
        timeOffset: 0,
        mutation: { type: MediaInteractions.Pause, id: 1 },
      });
      pausePlayer();

      expect(pause.mock.calls.length > 0).toBe(isPaused);
      expect(warn).not.toHaveBeenCalled();
    },
  );
});
