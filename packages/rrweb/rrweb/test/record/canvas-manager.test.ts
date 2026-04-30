import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMirror } from '@posthog/rrweb-snapshot';
import { CanvasManager } from '../../src/record/observers/canvas/canvas-manager';

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
      postMessage() {}
    },
  }),
);

describe('CanvasManager FPS observer', () => {
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let nextRafId: number;

  beforeEach(() => {
    rafCallbacks = new Map();
    nextRafId = 1;

    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((cb: FrameRequestCallback) => {
        const id = nextRafId++;
        rafCallbacks.set(id, cb);
        return id;
      }),
    );

    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((id: number) => {
        rafCallbacks.delete(id);
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createCanvasManager(win: any, mutationCb?: any) {
    return new CanvasManager({
      recordCanvas: true,
      mutationCb: mutationCb || vi.fn(),
      win,
      blockClass: 'rr-block',
      blockSelector: null,
      mirror: createMirror(),
      sampling: 4,
      dataURLOptions: {},
    });
  }

  function flushRaf(timestamp: number) {
    const callbacks = Array.from(rafCallbacks.entries());
    rafCallbacks.clear();
    callbacks.forEach(([, cb]) => cb(timestamp));
  }

  it('should not start the rAF loop when OffscreenCanvas is unavailable', () => {
    const win = { document: { querySelectorAll: vi.fn(() => []) } };

    createCanvasManager(win);

    expect(rafCallbacks.size).toBe(0);
  });

  it('should start the rAF loop when OffscreenCanvas is available', () => {
    const win = {
      document: { querySelectorAll: vi.fn(() => []) },
      OffscreenCanvas: class {},
    };

    createCanvasManager(win);

    expect(rafCallbacks.size).toBeGreaterThan(0);
  });

  it('should recover from createImageBitmap errors', async () => {
    const fakeCanvas = {
      width: 300,
      height: 150,
      clientWidth: 300,
      clientHeight: 150,
    } as unknown as HTMLCanvasElement;

    const mirror = createMirror();
    // @ts-expect-error -- using internal method to set up mirror state
    mirror.add(fakeCanvas, { id: 42 });

    const mutationCb = vi.fn();
    const win = {
      document: {
        querySelectorAll: vi.fn((selector: string) => {
          if (selector === 'canvas') return [fakeCanvas];
          return [];
        }),
      },
      OffscreenCanvas: class {},
      HTMLCanvasElement: { prototype: { getContext: vi.fn() } },
    };

    new CanvasManager({
      recordCanvas: true,
      mutationCb,
      win,
      blockClass: 'rr-block',
      blockSelector: null,
      mirror,
      sampling: 4,
      dataURLOptions: {},
    });

    // First call: createImageBitmap throws
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockRejectedValueOnce(new Error('GPU context lost')),
    );

    // Trigger rAF with enough time elapsed for a snapshot
    flushRaf(1000);

    // Let the rejected promise settle
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Second call: createImageBitmap succeeds — canvas should NOT be stuck
    const fakeBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(fakeBitmap));

    flushRaf(2000);

    // Let the promise settle
    await new Promise((resolve) => setTimeout(resolve, 10));

    // The canvas should have been attempted again (not permanently stuck)
    expect(vi.mocked(createImageBitmap)).toHaveBeenCalled();
  });
});
