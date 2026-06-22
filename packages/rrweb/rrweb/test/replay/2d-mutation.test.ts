/**
 * @vitest-environment jsdom
 */
import { vi } from 'vitest';
import { polyfillWebGLGlobals } from '../utils';
polyfillWebGLGlobals();

import canvas2DMutation from '../../src/replay/canvas/2d';
import type { Replayer } from '../../src/replay';

let canvas: HTMLCanvasElement;
describe('canvas2DMutation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    canvas = document.createElement('canvas');
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('should execute all mutations after args are parsed', async () => {
    let resolve: (value: unknown) => void;
    const promise = new Promise((r) => {
      resolve = r;
    });
    const context = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(canvas, 'getContext').mockImplementation(() => {
      return context;
    });

    const createImageBitmapMock = vi.fn(() => {
      return new Promise((r) => {
        setTimeout(r, 1000);
      });
    });

    (global as any).createImageBitmap = createImageBitmapMock;

    const mutation = canvas2DMutation({
      event: {} as Parameters<Replayer['applyIncremental']>[0],
      mutations: [
        {
          property: 'clearRect',
          args: [0, 0, 1000, 1000],
        },
        {
          property: 'drawImage',
          args: [
            {
              rr_type: 'ImageBitmap',
              args: [],
            },
            0,
            0,
          ],
        },
      ],
      target: canvas,
      imageMap: new Map(),
      errorHandler: () => {},
    });

    await vi.advanceTimersByTimeAsync(100);

    await expect(createImageBitmapMock).toHaveBeenCalled();

    expect(context.clearRect).not.toBeCalled();
    expect(context.drawImage).not.toBeCalled();

    await vi.advanceTimersByTimeAsync(1000);

    await mutation;

    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 1000, 1000);
    expect(context.drawImage).toHaveBeenCalled();
  });

  // A downscaled capture records a small source frame but the canvas's true display
  // dimensions as the drawImage destination, so replay must stretch the small frame back
  // to those display dimensions — this is what keeps playback the right size and aspect
  // ratio even though we captured fewer pixels.
  it('stretches a downscaled frame back to the recorded display dimensions on replay', async () => {
    const context = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(canvas, 'getContext').mockImplementation(() => context);

    // the source bitmap is smaller than the display size (i.e. it was captured downscaled)
    const downscaledBitmap = { width: 500, height: 375 } as unknown as ImageBitmap;
    (global as any).createImageBitmap = vi.fn(() => Promise.resolve(downscaledBitmap));

    const displayWidth = 1000;
    const displayHeight = 750;

    const mutation = canvas2DMutation({
      event: {} as Parameters<Replayer['applyIncremental']>[0],
      mutations: [
        {
          property: 'clearRect',
          args: [0, 0, displayWidth, displayHeight],
        },
        {
          property: 'drawImage',
          // recorded as the 5-arg form: [image, dx, dy, dWidth, dHeight]
          args: [{ rr_type: 'ImageBitmap', args: [] }, 0, 0, displayWidth, displayHeight],
        },
      ],
      target: canvas,
      imageMap: new Map(),
      errorHandler: () => {},
    });

    await vi.advanceTimersByTimeAsync(100);
    await mutation;

    // the canvas is wiped at the display size, and the smaller frame is drawn stretched to
    // the full display dimensions (not its own 500x375 source size)
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, displayWidth, displayHeight);
    expect(context.drawImage).toHaveBeenCalledWith(
      downscaledBitmap,
      0,
      0,
      displayWidth,
      displayHeight,
    );
  });
});
