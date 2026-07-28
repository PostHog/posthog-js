/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const snapshotSpy = vi.hoisted(() => vi.fn());

vi.mock('@posthog/rrweb-snapshot', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@posthog/rrweb-snapshot')>();
  return {
    ...actual,
    snapshot: (...args: Parameters<typeof actual.snapshot>) => {
      snapshotSpy(...args);
      return actual.snapshot(...args);
    },
  };
});

vi.mock('../../src/record/observers/canvas/canvas', () => ({
  default: () => () => {},
}));

vi.mock('../../src/record/observers/canvas/2d', () => ({
  default: () => () => {},
}));

vi.mock('../../src/record/observers/canvas/webgl', () => ({
  default: () => () => {},
}));

vi.mock(
  '../../src/record/workers/image-bitmap-data-url-worker?worker&inline',
  () => ({
    default: class {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: ErrorEvent) => void) | null = null;
      postMessage = vi.fn();
      terminate = vi.fn();
    },
  }),
);

import record from '../../src/record';

describe('full snapshot canvas masking flag', () => {
  let stop: (() => void) | undefined;

  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.clearAllMocks();
  });

  it('passes canvasMaskingConfigured to the full snapshot when canvasMasking is configured', () => {
    stop = record({
      emit: vi.fn(),
      recordCanvas: true,
      canvasMasking: { configured: true, regionsFn: () => [] },
    });

    expect(snapshotSpy).toHaveBeenCalledTimes(1);
    const options = snapshotSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(options.recordCanvas).toBe(true);
    expect(options.canvasMaskingConfigured).toBe(true);
  });

  it('does not set canvasMaskingConfigured when only recordCanvas is on', () => {
    stop = record({
      emit: vi.fn(),
      recordCanvas: true,
      canvasMasking: { regionsFn: () => undefined },
    });

    expect(snapshotSpy).toHaveBeenCalledTimes(1);
    const options = snapshotSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(options.recordCanvas).toBe(true);
    expect(options.canvasMaskingConfigured).toBe(false);
  });
});
