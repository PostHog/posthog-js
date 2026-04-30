import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import initCanvasContextObserver from '../../src/record/observers/canvas/canvas';

class FakeCanvasElement {
  public nodeType = 1;
  public ELEMENT_NODE = 1;
  public classList = { contains: () => false };
  public __lastWebGPUConfigure?: { usage?: number };
  public __webgpuContext?: FakeGPUCanvasContext;

  closest() {
    return null;
  }

  matches() {
    return false;
  }

  getContext(contextType: string, ..._args: unknown[]) {
    if (contextType === 'webgpu') {
      if (!this.__webgpuContext) {
        this.__webgpuContext = new FakeGPUCanvasContext(this);
      }

      return this.__webgpuContext as unknown as RenderingContext;
    }

    return null;
  }
}

class FakeOffscreenCanvas {
  public __lastWebGPUConfigure?: { usage?: number };
}

class FakeGPUCanvasContext {
  constructor(public canvas: FakeCanvasElement | FakeOffscreenCanvas) {}

  configure(configuration: { usage?: number }) {
    this.canvas.__lastWebGPUConfigure = configuration;
  }
}

const createFakeWindow = () => ({
  HTMLCanvasElement: FakeCanvasElement,
  GPUCanvasContext: FakeGPUCanvasContext,
  GPUTextureUsage: {
    COPY_SRC: 0x100,
    TEXTURE_BINDING: 0x400,
    RENDER_ATTACHMENT: 0x1000,
  },
});

describe('initCanvasContextObserver', () => {
  const originalGPUTextureUsage = (
    globalThis as typeof globalThis & {
      GPUTextureUsage?: {
        COPY_SRC: number;
        RENDER_ATTACHMENT: number;
        TEXTURE_BINDING: number;
      };
    }
  ).GPUTextureUsage;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        GPUTextureUsage?: {
          COPY_SRC: number;
          RENDER_ATTACHMENT: number;
          TEXTURE_BINDING: number;
        };
      }
    ).GPUTextureUsage = {
      COPY_SRC: 0x01,
      TEXTURE_BINDING: 0x04,
      RENDER_ATTACHMENT: 0x10,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();

    (
      globalThis as typeof globalThis & {
        GPUTextureUsage?: {
          COPY_SRC: number;
          RENDER_ATTACHMENT: number;
          TEXTURE_BINDING: number;
        };
      }
    ).GPUTextureUsage = originalGPUTextureUsage;
  });

  it('adds the snapshot-safe usage flags when webgpu contexts are configured', () => {
    const win = createFakeWindow();
    const getContextSpy = vi.spyOn(FakeCanvasElement.prototype, 'getContext');

    const restore = initCanvasContextObserver(
      win as unknown as Parameters<typeof initCanvasContextObserver>[0],
      'rr-block',
      null,
      true,
    );

    const canvas = new FakeCanvasElement();
    const context = canvas.getContext('webgpu') as FakeGPUCanvasContext;
    const { GPUTextureUsage: textureUsage } = win;

    context.configure({
      usage: textureUsage.TEXTURE_BINDING,
    });

    expect(
      (canvas as FakeCanvasElement & { __context?: string }).__context,
    ).toBe('webgpu');
    expect(getContextSpy).toHaveBeenCalledWith('webgpu');
    expect(canvas.__lastWebGPUConfigure).toEqual({
      usage:
        textureUsage.TEXTURE_BINDING |
        textureUsage.COPY_SRC |
        textureUsage.RENDER_ATTACHMENT,
    });

    restore();
  });

  it('patches webgpu contexts created before the observer starts', () => {
    const win = createFakeWindow();
    const canvas = new FakeCanvasElement();
    const context = canvas.getContext('webgpu') as FakeGPUCanvasContext;
    const { GPUTextureUsage: textureUsage } = win;

    const restore = initCanvasContextObserver(
      win as unknown as Parameters<typeof initCanvasContextObserver>[0],
      'rr-block',
      null,
      true,
    );

    context.configure({
      usage: textureUsage.TEXTURE_BINDING,
    });

    expect(
      (canvas as FakeCanvasElement & { __context?: string }).__context,
    ).toBe('webgpu');
    expect(canvas.__lastWebGPUConfigure).toEqual({
      usage:
        textureUsage.TEXTURE_BINDING |
        textureUsage.COPY_SRC |
        textureUsage.RENDER_ATTACHMENT,
    });

    restore();
  });

  it('patches webgpu contexts backed by offscreen canvases', () => {
    const win = createFakeWindow();
    const canvas = new FakeOffscreenCanvas();
    const context = new FakeGPUCanvasContext(canvas);
    const { GPUTextureUsage: textureUsage } = win;

    const restore = initCanvasContextObserver(
      win as unknown as Parameters<typeof initCanvasContextObserver>[0],
      'rr-block',
      null,
      true,
    );

    context.configure({
      usage: textureUsage.TEXTURE_BINDING,
    });

    expect(canvas.__lastWebGPUConfigure).toEqual({
      usage:
        textureUsage.TEXTURE_BINDING |
        textureUsage.COPY_SRC |
        textureUsage.RENDER_ATTACHMENT,
    });

    restore();
  });

  it('leaves other contexts unchanged', () => {
    const contextAttributes: WebGLContextAttributes = {};
    const win = {
      HTMLCanvasElement: FakeCanvasElement,
    };
    const getContext = vi
      .spyOn(FakeCanvasElement.prototype, 'getContext')
      .mockReturnValue({} as RenderingContext);
    const restore = initCanvasContextObserver(
      win as unknown as Parameters<typeof initCanvasContextObserver>[0],
      'rr-block',
      null,
      true,
    );

    const canvas = new FakeCanvasElement();
    canvas.getContext('webgl', contextAttributes);

    expect(
      (canvas as FakeCanvasElement & { __context?: string }).__context,
    ).toBe('webgl');
    expect(contextAttributes.preserveDrawingBuffer).toBe(true);
    expect(getContext).toHaveBeenCalledWith('webgl', contextAttributes);

    restore();
  });
});
