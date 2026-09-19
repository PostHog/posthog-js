/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import record from '../../src/record';
import type { eventWithTime } from '@posthog/rrweb-types';

// takeFullSnapshot runs the user's mask callbacks inside the serialize pass, and one
// of them can stop the recorder (the browser SDK restarts on a session id change).
// The tree the pass built is keyed to a mirror the replacement has already reset, so
// the stale full snapshot must not emit.
describe('stop from inside the serialize pass', () => {
  let stop: (() => void) | undefined;

  afterEach(() => {
    stop?.();
    stop = undefined;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    record.mirror.reset();
  });

  it('does not emit the full snapshot when maskTextFn stops the recorder', () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    document.body.innerHTML = '<div class="rr-mask">sensitive</div>';

    const eventsAfterStop: eventWithTime[] = [];
    let hasStopped = false;

    stop = record({
      recordAfter: 'DOMContentLoaded',
      maskTextFn: () => {
        if (!hasStopped) {
          hasStopped = true;
          stop?.();
          stop = undefined;
        }
        return '***';
      },
      emit: (event) => {
        if (hasStopped) eventsAfterStop.push(event);
      },
    });

    document.dispatchEvent(new Event('DOMContentLoaded'));

    expect(eventsAfterStop).toEqual([]);
    expect(record.isRecording()).toBe(false);
  });
});
