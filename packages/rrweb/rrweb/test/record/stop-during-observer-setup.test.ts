/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import record from '../../src/record';
import { EventType, type eventWithTime } from '@posthog/rrweb-types';

// A plugin observer can emit while it is still setting up (the network plugin
// replays the performance entries the page already has), and that emit can stop
// the recorder. The stop drains the handler list before observe() has returned
// its cleanup, so the observers it started must be released on the spot - they
// have no reachable stop path once init() returns.
describe('stop from inside observer setup', () => {
  let stop: (() => void) | undefined;

  afterEach(() => {
    stop?.();
    stop = undefined;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    record.mirror.reset();
  });

  it('releases the observers when a plugin emit stops the recorder during setup', () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');

    const eventsAfterStop: eventWithTime[] = [];
    let hasStopped = false;
    let pluginTornDown = false;

    stop = record({
      recordAfter: 'DOMContentLoaded',
      plugins: [
        {
          name: 'test/stops-during-setup',
          observer: (cb) => {
            cb({ during: 'setup' });
            return () => {
              pluginTornDown = true;
            };
          },
          options: {},
        },
      ],
      emit: (event) => {
        if (hasStopped) {
          eventsAfterStop.push(event);
          return;
        }
        if (event.type === EventType.Plugin) {
          hasStopped = true;
          stop?.();
          stop = undefined;
        }
      },
    });

    document.dispatchEvent(new Event('DOMContentLoaded'));

    expect(pluginTornDown).toBe(true);
    expect(record.isRecording()).toBe(false);
    expect(eventsAfterStop).toEqual([]);
  });
});
