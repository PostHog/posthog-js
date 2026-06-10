import { encode } from 'base64-arraybuffer';
import type {
  DataURLOptions,
  ImageBitmapDataURLWorkerParams,
  ImageBitmapDataURLWorkerResponse,
} from '@posthog/rrweb-types';

const lastFingerprintMap: Map<number, string> = new Map();
const transparentBlobMap: Map<string, string> = new Map();

function fnv1aHash(buffer: ArrayBuffer): string {
  const view = new Uint8Array(buffer);
  let hash = 0x811c9dc5;
  for (let i = 0; i < view.length; i++) {
    hash ^= view[i];
    hash = (hash * 0x01000193) | 0;
  }
  return (hash >>> 0).toString(16);
}

export interface ImageBitmapDataURLRequestWorker {
  postMessage: (
    message: ImageBitmapDataURLWorkerParams,
    transfer?: [ImageBitmap],
  ) => void;
  onmessage: (message: MessageEvent<ImageBitmapDataURLWorkerResponse>) => void;
}

interface ImageBitmapDataURLResponseWorker {
  onmessage:
    | null
    | ((message: MessageEvent<ImageBitmapDataURLWorkerParams>) => void);
  postMessage(e: ImageBitmapDataURLWorkerResponse): void;
}

async function getTransparentBlobFor(
  width: number,
  height: number,
  dataURLOptions: DataURLOptions,
): Promise<string> {
  const id = `${width}-${height}`;
  if ('OffscreenCanvas' in globalThis) {
    if (transparentBlobMap.has(id)) return transparentBlobMap.get(id)!;
    const offscreen = new OffscreenCanvas(width, height);
    offscreen.getContext('2d'); // creates rendering context for `converToBlob`
    const blob = await offscreen.convertToBlob(dataURLOptions); // takes a while
    const arrayBuffer = await blob.arrayBuffer();
    const base64 = encode(arrayBuffer); // cpu intensive
    transparentBlobMap.set(id, base64);
    return base64;
  } else {
    return '';
  }
}

// `as any` because: https://github.com/Microsoft/TypeScript/issues/20595
const worker: ImageBitmapDataURLResponseWorker = self;

let reusableCanvas: OffscreenCanvas | null = null;
let reusableCtx: OffscreenCanvasRenderingContext2D | null = null;

// eslint-disable-next-line @typescript-eslint/no-misused-promises
worker.onmessage = async function (e) {
  if ('OffscreenCanvas' in globalThis) {
    const { id, bitmap, width, height, dataURLOptions } = e.data;

    try {
      const transparentBase64 = getTransparentBlobFor(
        width,
        height,
        dataURLOptions,
      );

      if (
        !reusableCanvas ||
        reusableCanvas.width !== width ||
        reusableCanvas.height !== height
      ) {
        reusableCanvas = new OffscreenCanvas(width, height);
        reusableCtx = reusableCanvas.getContext('2d')!;
      }

      reusableCtx!.clearRect(0, 0, width, height);
      reusableCtx!.drawImage(bitmap, 0, 0);
      bitmap.close();
      const blob = await reusableCanvas.convertToBlob(dataURLOptions); // takes a while
      const type = blob.type;
      const arrayBuffer = await blob.arrayBuffer();
      const fingerprint = fnv1aHash(arrayBuffer);

      // on first try we should check if canvas is transparent,
      // no need to save it's contents in that case
      if (!lastFingerprintMap.has(id)) {
        const base64 = encode(arrayBuffer);
        if ((await transparentBase64) === base64) {
          lastFingerprintMap.set(id, fingerprint);
          return worker.postMessage({ id });
        }
        lastFingerprintMap.set(id, fingerprint);
        worker.postMessage({ id, type, base64, width, height });
        return;
      }

      if (lastFingerprintMap.get(id) === fingerprint)
        return worker.postMessage({ id }); // unchanged
      const base64 = encode(arrayBuffer);
      worker.postMessage({ id, type, base64, width, height });
      lastFingerprintMap.set(id, fingerprint);
    } catch {
      // Always respond so the main thread clears snapshotInProgressMap
      worker.postMessage({ id });
    }
  } else {
    e.data.bitmap.close();
    return worker.postMessage({ id: e.data.id });
  }
};
