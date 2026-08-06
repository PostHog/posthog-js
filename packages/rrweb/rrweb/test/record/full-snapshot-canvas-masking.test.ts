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

const workerInstances = vi.hoisted(
  () => [] as Array<{ postMessage: ReturnType<typeof vi.fn> }>,
);

vi.mock(
  '../../src/record/workers/image-bitmap-data-url-worker?worker&inline',
  () => ({
    default: class {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: ErrorEvent) => void) | null = null;
      postMessage = vi.fn();
      terminate = vi.fn();
      constructor() {
        workerInstances.push(this);
      }
    },
  }),
);

import record from '../../src/record';
import { EventType } from '@posthog/rrweb-types';

describe('full snapshot canvas masking flag', () => {
  let stop: (() => void) | undefined;

  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    workerInstances.length = 0;
  });

  it('passes the configured thunk itself to the full snapshot', () => {
    const configured = () => true;
    stop = record({
      emit: vi.fn(),
      recordCanvas: true,
      canvasMasking: { configured, regionsFn: () => [] },
    });

    expect(snapshotSpy).toHaveBeenCalledTimes(1);
    const options = snapshotSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(options.recordCanvas).toBe(true);
    expect(options.canvasMaskingConfigured).toBe(configured);
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
    expect(options.canvasMaskingConfigured).toBeUndefined();
  });

  it('stops serializing canvas pixels once the thunk flips true, without a restart', () => {
    const canvas = document.createElement('canvas');
    (canvas as { __context?: string }).__context = '2d';
    const getImageData = vi.fn(() => ({
      data: new Uint8ClampedArray([255, 0, 0, 255]),
    }));
    canvas.getContext = vi.fn(() => ({
      getImageData,
    })) as unknown as typeof canvas.getContext;
    canvas.toDataURL = vi.fn(() => 'data:image/webp;base64,pixels');
    document.body.appendChild(canvas);

    let providerInstalled = false;
    const events: unknown[] = [];
    stop = record({
      emit: (e) => events.push(e),
      recordCanvas: true,
      canvasMasking: {
        configured: () => providerInstalled,
        regionsFn: () => undefined,
      },
    });

    providerInstalled = true;
    record.takeFullSnapshot(true);

    const fullSnapshots = events.filter(
      (e) => (e as { type: number }).type === EventType.FullSnapshot,
    );
    expect(fullSnapshots).toHaveLength(2);
    expect(JSON.stringify(fullSnapshots[0])).toContain('rr_dataURL');
    expect(JSON.stringify(fullSnapshots[1])).not.toContain('rr_dataURL');

    canvas.remove();
  });

  it('resets canvas frame dedup on each full snapshot so idle canvases re-emit', () => {
    vi.stubGlobal('OffscreenCanvas', class {});

    stop = record({
      emit: vi.fn(),
      recordCanvas: true,
      sampling: { canvas: 4 },
    });

    expect(workerInstances).toHaveLength(1);
    const worker = workerInstances[0];
    // the initial full snapshot inside record() already resets once
    worker.postMessage.mockClear();

    record.takeFullSnapshot(true);

    expect(worker.postMessage).toHaveBeenCalledWith({ resetFrameDedup: true });
  });
});
