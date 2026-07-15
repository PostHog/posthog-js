import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageBitmapDataURLWorkerParams } from '@posthog/rrweb-types';

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
  width: number;
  height: number;
  private pixels: Uint8ClampedArray;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }

  getContext() {
    return {
      clearRect: () => this.pixels.fill(0),
      drawImage: (bitmap: FakeBitmap) => this.pixels.set(bitmap.pixels),
      getImageData: () => ({ data: this.pixels }),
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
});
