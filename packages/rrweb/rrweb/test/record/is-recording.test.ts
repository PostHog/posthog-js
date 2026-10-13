/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import record from '../../src/record';

describe('record.isRecording()', () => {
  let stop: (() => void) | undefined;

  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.restoreAllMocks();
    vi.useRealTimers();
    record.mirror.reset();
  });

  it('reports false before recording and true once the observers run', () => {
    expect(record.isRecording()).toBe(false);

    stop = record({ emit: () => {} });

    expect(record.isRecording()).toBe(true);
  });

  it('reports false after recording stops', () => {
    stop = record({ emit: () => {} });
    stop();
    stop = undefined;

    expect(record.isRecording()).toBe(false);
  });

  it('reports false while init is deferred, and true after DOMContentLoaded', () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');

    stop = record({ emit: () => {}, recordAfter: 'DOMContentLoaded' });

    expect(record.isRecording()).toBe(false);

    document.dispatchEvent(new Event('DOMContentLoaded'));

    // init() now runs in a later task, after the page's own DOMContentLoaded listeners
    expect(record.isRecording()).toBe(false);

    vi.runOnlyPendingTimers();

    expect(record.isRecording()).toBe(true);
  });
});
