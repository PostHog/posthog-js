/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import record from '../../src/record';
import type { eventWithTime } from '@posthog/rrweb-types';

// A site can add the mask class from its own, non-capture DOMContentLoaded listener.
// `on()` registers rrweb's own listener with `{ capture: true }`, so it always fires
// before that page listener - init() must not run inside it, or the first full
// snapshot serializes the element before the page has had a chance to mask it.
describe('mask class added by a page DOMContentLoaded listener', () => {
  let stop: (() => void) | undefined;

  afterEach(() => {
    stop?.();
    stop = undefined;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
    record.mirror.reset();
  });

  it('masks text that the page marks sensitive from its own DOMContentLoaded listener', () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    document.body.innerHTML = '<div id="target">super-secret-value</div>';

    // a normal (non-capture) listener, like a site would register
    document.addEventListener('DOMContentLoaded', () => {
      document.getElementById('target')!.classList.add('rr-mask');
    });

    const events: eventWithTime[] = [];

    stop = record({
      recordAfter: 'DOMContentLoaded',
      emit: (event) => events.push(event),
    });

    document.dispatchEvent(new Event('DOMContentLoaded'));
    vi.runOnlyPendingTimers();

    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('super-secret-value');
  });
});
