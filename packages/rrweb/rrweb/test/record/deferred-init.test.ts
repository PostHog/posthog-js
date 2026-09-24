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
    vi.useRealTimers();
    record.mirror.reset();
  });

  const recordAndStopOn = (stopOn: EventType) => {
    vi.useFakeTimers();
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
    vi.runOnlyPendingTimers();

    return eventsAfterStop;
  };

  it('does not snapshot or observe when the DomContentLoaded emit stops the recorder', () => {
    const eventsAfterStop = recordAndStopOn(EventType.DomContentLoaded);

    expect(eventsAfterStop).toEqual([]);
    expect(record.isRecording()).toBe(false);
  });

  it('does not snapshot or observe when the Meta emit stops the recorder', () => {
    const eventsAfterStop = recordAndStopOn(EventType.Meta);

    expect(eventsAfterStop).toEqual([]);
    expect(record.isRecording()).toBe(false);
  });

  it('does not observe or emit when the full snapshot emit stops the recorder', () => {
    const eventsAfterStop = recordAndStopOn(EventType.FullSnapshot);

    expect(eventsAfterStop).toEqual([]);
    expect(record.isRecording()).toBe(false);
  });

  // the browser SDK's session rotation stops and immediately starts a replacement
  // from inside the emit; the stale callback must not snapshot into its stream
  it('a replacement started from the DomContentLoaded emit sees exactly one full snapshot', () => {
    vi.useFakeTimers();
    const readyState = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');

    const replacementEvents: eventWithTime[] = [];
    let replaced = false;

    stop = record({
      recordAfter: 'DOMContentLoaded',
      emit: (event) => {
        if (replaced || event.type !== EventType.DomContentLoaded) return;
        replaced = true;
        stop?.();
        // the browser is 'interactive' while DOMContentLoaded dispatches, so the
        // replacement inits synchronously
        readyState.mockReturnValue('interactive');
        stop = record({ emit: (e) => replacementEvents.push(e) });
      },
    });

    document.dispatchEvent(new Event('DOMContentLoaded'));
    vi.runOnlyPendingTimers();

    expect(replacementEvents.filter((e) => e.type === EventType.FullSnapshot)).toHaveLength(1);
    expect(record.isRecording()).toBe(true);
  });
});
