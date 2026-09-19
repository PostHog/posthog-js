/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import record from '../../src/record';
import { EventType, type eventWithTime } from '@posthog/rrweb-types';

// The deferred-start listeners stay registered until the stop drains them, and page
// code can dispatch its own DOMContentLoaded after the browser's. init() must not run
// a second time: that would take another full snapshot and stack a second observer
// set on the first.
describe('repeated DOMContentLoaded', () => {
  let stop: (() => void) | undefined;

  afterEach(() => {
    stop?.();
    stop = undefined;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    record.mirror.reset();
  });

  it('initializes once when DOMContentLoaded is dispatched again', () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    document.body.innerHTML = '<div>content</div>';

    const events: eventWithTime[] = [];

    stop = record({
      recordAfter: 'DOMContentLoaded',
      emit: (event) => events.push(event),
    });

    document.dispatchEvent(new Event('DOMContentLoaded'));
    document.dispatchEvent(new Event('DOMContentLoaded'));

    const fullSnapshots = events.filter(
      (event) => event.type === EventType.FullSnapshot,
    );
    expect(fullSnapshots).toHaveLength(1);
  });
});
