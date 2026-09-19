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
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');

    stop = record({ emit: () => {}, recordAfter: 'DOMContentLoaded' });

    expect(record.isRecording()).toBe(false);

    document.dispatchEvent(new Event('DOMContentLoaded'));

    expect(record.isRecording()).toBe(true);
  });
});
