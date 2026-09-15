/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import record from '../../src/record';
import { EventType } from '@posthog/rrweb-types';
import type { eventWithTime } from '@posthog/rrweb-types';

// A deferred start emits its DomContentLoaded event before it calls init(), and the
// emit callback can stop the recorder synchronously (the browser SDK restarts on a
// session id change). The stale callback must not init after that.
describe('deferred init after stop', () => {
  let stop: (() => void) | undefined;

  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.restoreAllMocks();
    record.mirror.reset();
  });

  const recordAndStopOn = (stopOn: EventType) => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');

    const eventsAfterStop: eventWithTime[] = [];
    let hasStopped = false;

    stop = record({
      recordAfter: 'DOMContentLoaded',
      emit: (event) => {
        if (hasStopped) {
          eventsAfterStop.push(event);
          return;
        }
        if (event.type === stopOn) {
          hasStopped = true;
          stop?.();
          stop = undefined;
        }
      },
    });

    document.dispatchEvent(new Event('DOMContentLoaded'));

    return eventsAfterStop;
  };

  it('does not snapshot or observe when the DomContentLoaded emit stops the recorder', () => {
    const eventsAfterStop = recordAndStopOn(EventType.DomContentLoaded);

    expect(eventsAfterStop).toEqual([]);
    expect(record.isRecording()).toBe(false);
  });

  it('does not observe when the full snapshot emit stops the recorder', () => {
    recordAndStopOn(EventType.FullSnapshot);

    expect(record.isRecording()).toBe(false);
  });
});
