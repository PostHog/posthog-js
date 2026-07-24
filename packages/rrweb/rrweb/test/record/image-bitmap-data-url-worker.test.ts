import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CanvasMaskRegion,
  ImageBitmapDataURLWorkerParams,
} from '@posthog/rrweb-types';

type MessageHandler = (e: {
  data: ImageBitmapDataURLWorkerParams;
}) => Promise<void>;

const convertToBlob = vi.fn(
  (options?: { type?: string; quality?: number }) =>
    Promise.resolve({
      type: options?.type ?? 'image/webp',
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
    }),
);
const postMessage = vi.fn();

type FakeBitmap = { pixels: Uint8ClampedArray; close: () => void };

// deliberately does not model real canvas semantics the worker depends on:
// real getImageData returns an unpremultiplied copy and real drawImage
// composites source-over onto a premultiplied backing store
class FakeOffscreenCanvas {
  static latest: FakeOffscreenCanvas | null = null;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8ClampedArray(width * height * 4);
    FakeOffscreenCanvas.latest = this;
  }

  getContext() {
    return {
      clearRect: () => this.pixels.fill(0),
      drawImage: (bitmap: FakeBitmap) => this.pixels.set(bitmap.pixels),
      getImageData: () => ({ data: this.pixels }),
      fillStyle: 'black',
      fillRect: (x: number, y: number, w: number, h: number) => {
        for (let row = Math.max(0, y); row < Math.min(this.height, y + h); row++) {
          for (let col = Math.max(0, x); col < Math.min(this.width, x + w); col++) {
            const i = (row * this.width + col) * 4;
            this.pixels[i] = 0;
            this.pixels[i + 1] = 0;
            this.pixels[i + 2] = 0;
            this.pixels[i + 3] = 255;
          }
        }
      },
    };
  }

  convertToBlob(options?: { type?: string; quality?: number }) {
    return convertToBlob(options);
  }
}

const WIDTH = 2;
const HEIGHT = 2;
const BYTES = WIDTH * HEIGHT * 4;

const CONTENT_A = Uint8ClampedArray.from({ length: BYTES }, (_, i) => i + 1);
const CONTENT_B = Uint8ClampedArray.from({ length: BYTES }, (_, i) => i + 101);
const BLANK = new Uint8ClampedArray(BYTES);

function frame(
  id: number,
  pixels: Uint8ClampedArray,
  width = WIDTH,
  height = HEIGHT,
  maskRegions?: CanvasMaskRegion[],
): { data: ImageBitmapDataURLWorkerParams } {
  const bitmap: FakeBitmap = { pixels, close: () => {} };
  return {
    data: {
      id,
      bitmap,
      width,
      height,
      displayWidth: 4,
      displayHeight: 4,
      dataURLOptions: { type: 'image/webp', quality: 0.4 },
      maskRegions,
    } as unknown as ImageBitmapDataURLWorkerParams,
  };
}

async function loadWorker(): Promise<MessageHandler> {
  vi.resetModules();
  vi.stubGlobal('self', globalThis);
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  vi.stubGlobal('postMessage', postMessage);
  await import('../../src/record/workers/image-bitmap-data-url-worker');
  return (globalThis as { onmessage?: MessageHandler }).onmessage!;
}

describe('image-bitmap-data-url-worker', () => {
  beforeEach(() => {
    convertToBlob.mockClear();
    postMessage.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as { onmessage?: MessageHandler }).onmessage;
  });

  it('encodes an unchanged canvas only once', async () => {
    const onmessage = await loadWorker();

    await onmessage(frame(1, CONTENT_A));
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 1, base64: expect.any(String) }),
    );

    await onmessage(frame(1, CONTENT_A));
    expect(postMessage).toHaveBeenLastCalledWith({ id: 1 });

    expect(convertToBlob).toHaveBeenCalledTimes(1);
    expect(convertToBlob).toHaveBeenCalledWith({
      type: 'image/webp',
      quality: 0.4,
    });
  });

  it('retries the encode on the next frame after a transient failure', async () => {
    const onmessage = await loadWorker();
    convertToBlob.mockImplementationOnce(() =>
      Promise.reject(new Error('encode failed')),
    );

    await onmessage(frame(1, CONTENT_A));
    expect(postMessage).toHaveBeenLastCalledWith({ id: 1 });

    await onmessage(frame(1, CONTENT_A));
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 1, base64: expect.any(String) }),
    );
  });

  it.each([
    ['different content', CONTENT_A, CONTENT_B],
    ['content going blank', CONTENT_A, BLANK],
    ['content after a blank first frame', BLANK, CONTENT_A],
  ])(
    're-encodes and sends when the canvas changes to %s',
    async (_name, first, second) => {
      const onmessage = await loadWorker();

      await onmessage(frame(1, first));
      await onmessage(frame(1, second));

      expect(postMessage).toHaveBeenCalledTimes(2);
      expect(postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: 1,
          base64: expect.any(String),
          displayWidth: 4,
          displayHeight: 4,
        }),
      );
    },
  );

  it('re-sends a resized canvas even when raw pixels are byte-identical', async () => {
    const onmessage = await loadWorker();
    const solidFill = new Uint8ClampedArray(BYTES).fill(7);

    await onmessage(frame(1, solidFill, 2, 2));
    await onmessage(frame(1, solidFill, 4, 1));

    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 1, base64: expect.any(String) }),
    );
  });

  it('skips a blank first frame without encoding at all', async () => {
    const onmessage = await loadWorker();

    await onmessage(frame(1, BLANK));

    expect(postMessage).toHaveBeenCalledWith({ id: 1 });
    expect(convertToBlob).not.toHaveBeenCalled();
  });

  it('sends non-blank pixels that collide with the transparent 32-bit hash', async () => {
    const onmessage = await loadWorker();
    const collidingPixels = Uint8ClampedArray.from([
      1, 0, 0, 0, 147, 6, 0, 1,
    ]);

    await onmessage(frame(1, collidingPixels, 2, 1));

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, base64: expect.any(String) }),
    );
  });

  it('keeps skipping a never-sent canvas that resizes while blank', async () => {
    const onmessage = await loadWorker();

    await onmessage(frame(1, BLANK, 2, 2));
    await onmessage(frame(1, BLANK, 4, 1));

    expect(postMessage).toHaveBeenNthCalledWith(1, { id: 1 });
    expect(postMessage).toHaveBeenNthCalledWith(2, { id: 1 });
    expect(convertToBlob).not.toHaveBeenCalled();
  });

  it('tracks fingerprints per canvas id', async () => {
    const onmessage = await loadWorker();

    await onmessage(frame(1, CONTENT_A));
    await onmessage(frame(2, CONTENT_A));

    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 2, base64: expect.any(String) }),
    );
  });

  it('paints mask regions black before encoding, leaving other pixels intact', async () => {
    const onmessage = await loadWorker();

    await onmessage(
      frame(1, CONTENT_A, WIDTH, HEIGHT, [
        { x: 0, y: 0, width: 1, height: 2 },
      ]),
    );

    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 1, base64: expect.any(String) }),
    );
    const pixels = FakeOffscreenCanvas.latest!.pixels;
    expect(Array.from(pixels.slice(0, 4))).toEqual([0, 0, 0, 255]);
    expect(Array.from(pixels.slice(8, 12))).toEqual([0, 0, 0, 255]);
    expect(Array.from(pixels.slice(4, 8))).toEqual(
      Array.from(CONTENT_A.slice(4, 8)),
    );
    expect(Array.from(pixels.slice(12, 16))).toEqual(
      Array.from(CONTENT_A.slice(12, 16)),
    );
  });

  it('skips re-encoding when only pixels under the mask change', async () => {
    const onmessage = await loadWorker();
    const fullMask = [{ x: 0, y: 0, width: WIDTH, height: HEIGHT }];

    await onmessage(frame(1, CONTENT_A, WIDTH, HEIGHT, fullMask));
    await onmessage(frame(1, CONTENT_B, WIDTH, HEIGHT, fullMask));

    expect(postMessage).toHaveBeenLastCalledWith({ id: 1 });
    expect(convertToBlob).toHaveBeenCalledTimes(1);
  });

  it('leaves pixels untouched without mask regions', async () => {
    const onmessage = await loadWorker();

    await onmessage(frame(1, CONTENT_A));

    expect(Array.from(FakeOffscreenCanvas.latest!.pixels)).toEqual(
      Array.from(CONTENT_A),
    );
  });

  it('sends a keyframe for an unchanged masked canvas after the interval', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const onmessage = await loadWorker();
      const mask = [{ x: 0, y: 0, width: 1, height: 1 }];

      await onmessage(frame(1, CONTENT_A, WIDTH, HEIGHT, mask));
      await onmessage(frame(1, CONTENT_A, WIDTH, HEIGHT, mask));
      expect(postMessage).toHaveBeenLastCalledWith({ id: 1 });
      expect(convertToBlob).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(30_000);
      await onmessage(frame(1, CONTENT_A, WIDTH, HEIGHT, mask));

      expect(postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 1, base64: expect.any(String) }),
      );
      expect(convertToBlob).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not keyframe unchanged frames without mask regions', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const onmessage = await loadWorker();

      await onmessage(frame(1, CONTENT_A));
      vi.advanceTimersByTime(60_000);
      await onmessage(frame(1, CONTENT_A));

      expect(postMessage).toHaveBeenLastCalledWith({ id: 1 });
      expect(convertToBlob).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
