import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMirror } from '@posthog/rrweb-snapshot';
import { CanvasManager } from '../../src/record/observers/canvas/canvas-manager';
import MutationBuffer from '../../src/record/mutation';

vi.mock('../../src/record/observers/canvas/canvas', () => ({
  default: () => () => {},
}));

vi.mock('../../src/record/observers/canvas/2d', () => ({
  default: () => () => {},
}));

vi.mock('../../src/record/observers/canvas/webgl', () => ({
  default: () => () => {},
}));

// Controls the mocked inline worker so individual tests can simulate a worker that fails to
// load — either by throwing at construction (synchronous importScripts failure) or by firing an
// error event (asynchronous blob-script load failure under a strict CSP).
const workerControl = vi.hoisted(() => ({
  throwOnConstruct: false,
  instances: [] as Array<{
    onmessage: ((e: MessageEvent) => void) | null;
    onerror: ((e: ErrorEvent) => void) | null;
    postMessage: (...args: unknown[]) => void;
    terminate: () => void;
  }>,
}));

vi.mock(
  '../../src/record/workers/image-bitmap-data-url-worker?worker&inline',
  () => ({
    default: class {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: ErrorEvent) => void) | null = null;
      postMessage = vi.fn();
      terminate = vi.fn();
      constructor() {
        if (workerControl.throwOnConstruct) {
          throw new DOMException(
            "Failed to execute 'importScripts' on 'WorkerGlobalScope'",
            'NetworkError',
          );
        }
        workerControl.instances.push(this);
      }
    },
  }),
);

describe('CanvasManager FPS observer', () => {
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let nextRafId: number;

  beforeEach(() => {
    rafCallbacks = new Map();
    nextRafId = 1;
    workerControl.throwOnConstruct = false;
    workerControl.instances = [];

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

  it('should not throw and should not start the rAF loop when the worker fails to construct', () => {
    workerControl.throwOnConstruct = true;
    const win = {
      document: { querySelectorAll: vi.fn(() => []) },
      OffscreenCanvas: class {},
    };

    // A CSP-blocked blob worker throws NetworkError on construction; this must not escape.
    expect(() => createCanvasManager(win)).not.toThrow();
    expect(rafCallbacks.size).toBe(0);
  });

  it('should stop the rAF loop when the worker fires an error event', () => {
    const win = {
      document: { querySelectorAll: vi.fn(() => []) },
      OffscreenCanvas: class {},
    };

    createCanvasManager(win);
    expect(rafCallbacks.size).toBeGreaterThan(0);

    const worker = workerControl.instances[0];
    expect(worker).toBeDefined();
    expect(worker.onerror).toBeTypeOf('function');

    // Simulate the asynchronous blob-script load failure.
    worker.onerror!({ message: 'NetworkError' } as ErrorEvent);

    expect(worker.terminate).toHaveBeenCalled();
    // The capture loop must not schedule any further frames.
    flushRaf(1000);
    expect(rafCallbacks.size).toBe(0);
  });

  it('should terminate the worker on normal teardown, exactly once', () => {
    const win = {
      document: { querySelectorAll: vi.fn(() => []) },
      OffscreenCanvas: class {},
    };

    const manager = createCanvasManager(win);
    manager.acquire();
    const worker = workerControl.instances[0];
    expect(worker).toBeDefined();

    manager.reset();
    // A second reset must not double-terminate (teardown is latched).
    manager.reset();

    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(rafCallbacks.size).toBe(0);
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

  it('should skip WebGL canvases while the GL context is lost', async () => {
    const isContextLost = vi.fn().mockReturnValue(true);
    const getContextAttributes = vi.fn();
    const fakeContext = {
      isContextLost,
      getContextAttributes,
    } as unknown as WebGLRenderingContext;

    const fakeCanvas = {
      width: 300,
      height: 150,
      clientWidth: 300,
      clientHeight: 150,
      __context: 'webgl',
      getContext: vi.fn().mockReturnValue(fakeContext),
    } as unknown as HTMLCanvasElement;

    const mirror = createMirror();
    // @ts-expect-error -- using internal method to set up mirror state
    mirror.add(fakeCanvas, { id: 99 });

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
      mutationCb: vi.fn(),
      win,
      blockClass: 'rr-block',
      blockSelector: null,
      mirror,
      sampling: 4,
      dataURLOptions: {},
    });

    const createImageBitmapMock = vi.fn();
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);

    // Tick the snapshot loop while the context is lost.
    flushRaf(1000);
    await new Promise((resolve) => setTimeout(resolve, 10));

    // While the context is lost we must not call createImageBitmap, otherwise
    // we capture a transparent bitmap and poison lastFingerprintMap.
    expect(isContextLost).toHaveBeenCalled();
    expect(createImageBitmapMock).not.toHaveBeenCalled();
    // The preserveDrawingBuffer attribute branch must not run either —
    // calling getContextAttributes on a lost context is wasted work.
    expect(getContextAttributes).not.toHaveBeenCalled();

    // Once the GL context is restored, the next tick should snapshot normally.
    isContextLost.mockReturnValue(false);
    getContextAttributes.mockReturnValue({ preserveDrawingBuffer: true });
    const fakeBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    createImageBitmapMock.mockResolvedValue(fakeBitmap);

    flushRaf(2000);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(createImageBitmapMock).toHaveBeenCalledTimes(1);
  });

  it('should keep the rAF loop alive when getCanvas throws', async () => {
    const fakeCanvas = {
      width: 300,
      height: 150,
      clientWidth: 300,
      clientHeight: 150,
    } as unknown as HTMLCanvasElement;

    const mirror = createMirror();
    // @ts-expect-error -- using internal method to set up mirror state
    mirror.add(fakeCanvas, { id: 7 });

    let throwOnNextCall = true;
    const win = {
      document: {
        querySelectorAll: vi.fn((selector: string) => {
          if (throwOnNextCall) {
            throwOnNextCall = false;
            throw new Error('shadow root traversal blew up');
          }
          if (selector === 'canvas') return [fakeCanvas];
          return [];
        }),
      },
      OffscreenCanvas: class {},
      HTMLCanvasElement: { prototype: { getContext: vi.fn() } },
    };

    new CanvasManager({
      recordCanvas: true,
      mutationCb: vi.fn(),
      win,
      blockClass: 'rr-block',
      blockSelector: null,
      mirror,
      sampling: 4,
      dataURLOptions: {},
    });

    const fakeBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue(fakeBitmap),
    );

    // First tick — querySelectorAll throws. The loop must survive.
    flushRaf(1000);
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Second tick — querySelectorAll behaves and returns the canvas.
    flushRaf(2000);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(vi.mocked(createImageBitmap)).toHaveBeenCalled();
  });
});

// A single root tearing down must not stop canvas recording for the whole page.
describe('CanvasManager reference-counted teardown', () => {
  const makeManager = (): {
    manager: CanvasManager;
    resetObservers: ReturnType<typeof vi.fn>;
  } => {
    const manager = new CanvasManager({
      recordCanvas: false, // skip real observer setup; we inject a spy below
      mutationCb: vi.fn(),
      win: {} as never,
      blockClass: 'rr-block',
      blockSelector: null,
      mirror: {} as never,
      dataURLOptions: {},
    });
    const resetObservers = vi.fn();
    (manager as unknown as { resetObservers: () => void }).resetObservers =
      resetObservers;
    return { manager, resetObservers };
  };

  it.each([
    ['one acquire, one reset', (m: CanvasManager) => m.reset()],
    [
      'extra resets are clamped',
      (m: CanvasManager) => {
        m.reset();
        m.reset();
        m.reset();
      },
    ],
  ])('tears down exactly once: %s', (_label, releaseAll) => {
    const { manager, resetObservers } = makeManager();
    manager.acquire();

    releaseAll(manager);

    expect(resetObservers).toHaveBeenCalledTimes(1);
  });

  it('does not tear down while other consumers are still attached', () => {
    const { manager, resetObservers } = makeManager();
    manager.acquire(); // main document
    manager.acquire(); // e.g. an iframe / shadow root

    manager.reset(); // secondary root torn down

    expect(resetObservers).not.toHaveBeenCalled();

    manager.reset(); // last consumer (main document) released

    expect(resetObservers).toHaveBeenCalledTimes(1);
  });
});

describe('MutationBuffer canvas reference balance', () => {
  const makeBuffer = (): {
    buffer: MutationBuffer;
    canvasManager: {
      acquire: ReturnType<typeof vi.fn>;
      reset: ReturnType<typeof vi.fn>;
    };
    shadowDomManager: { reset: ReturnType<typeof vi.fn> };
  } => {
    const canvasManager = { acquire: vi.fn(), reset: vi.fn() };
    const shadowDomManager = { reset: vi.fn() };
    const buffer = new MutationBuffer();
    buffer.init({ canvasManager, shadowDomManager } as never);
    return { buffer, canvasManager, shadowDomManager };
  };

  it('acquires the canvas manager exactly once on init', () => {
    const { canvasManager } = makeBuffer();

    expect(canvasManager.acquire).toHaveBeenCalledTimes(1);
  });

  it('releases the canvas manager only once even if reset runs multiple times', () => {
    const { buffer, canvasManager } = makeBuffer();

    buffer.reset();
    buffer.reset();

    expect(canvasManager.reset).toHaveBeenCalledTimes(1);
  });

  it('releaseCanvasManager is idempotent with reset', () => {
    const { buffer, canvasManager } = makeBuffer();

    buffer.releaseCanvasManager();
    buffer.reset();

    expect(canvasManager.reset).toHaveBeenCalledTimes(1);
  });
});
