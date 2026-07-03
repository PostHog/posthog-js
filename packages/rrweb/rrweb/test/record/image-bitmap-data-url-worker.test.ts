import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageBitmapDataURLWorkerParams } from '@posthog/rrweb-types';

type MessageHandler = (e: {
  data: ImageBitmapDataURLWorkerParams;
}) => Promise<void>;

const convertToBlob = vi.fn();
const postMessage = vi.fn();

type FakeBitmap = { pixels: Uint8ClampedArray; close: () => void };

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

  convertToBlob(options?: { type?: string }) {
    convertToBlob(options);
    const encoded = this.pixels.slice();
    return Promise.resolve({
      type: options?.type ?? 'image/webp',
      arrayBuffer: () => Promise.resolve(encoded.buffer),
    });
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
): { data: ImageBitmapDataURLWorkerParams } {
  const bitmap: FakeBitmap = { pixels, close: () => {} };
  return {
    data: {
      id,
      bitmap,
      width: WIDTH,
      height: HEIGHT,
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
  });

  it.each([
    ['different content', CONTENT_A, CONTENT_B],
    ['content going blank', CONTENT_A, BLANK],
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

  it('skips a blank first frame without encoding at all', async () => {
    const onmessage = await loadWorker();

    await onmessage(frame(1, BLANK));

    expect(postMessage).toHaveBeenCalledWith({ id: 1 });
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
