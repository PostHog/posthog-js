import { encode } from 'base64-arraybuffer';
import type {
  ImageBitmapDataURLWorkerParams,
  ImageBitmapDataURLWorkerResponse,
} from '@posthog/rrweb-types';

const lastFingerprintMap: Map<number, string> = new Map();
const transparentFingerprintMap: Map<string, string> = new Map();

function fnv1aHash(data: Uint8ClampedArray): string {
  // hash 32-bit words rather than bytes: RGBA buffers are multi-megabyte,
  // always word-aligned, and this runs on every captured frame
  const view = new Uint32Array(
    data.buffer,
    data.byteOffset,
    data.byteLength >>> 2,
  );
  let hash = 0x811c9dc5;
  for (let i = 0; i < view.length; i++) {
    hash ^= view[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function transparentFingerprint(width: number, height: number): string {
  const key = `${width}-${height}`;
  let fingerprint = transparentFingerprintMap.get(key);
  if (fingerprint === undefined) {
    fingerprint = fnv1aHash(new Uint8ClampedArray(width * height * 4));
    transparentFingerprintMap.set(key, fingerprint);
  }
  return fingerprint;
}

export interface ImageBitmapDataURLRequestWorker {
  postMessage: (
    message: ImageBitmapDataURLWorkerParams,
    transfer?: [ImageBitmap],
  ) => void;
  onmessage: (message: MessageEvent<ImageBitmapDataURLWorkerResponse>) => void;
  // the inline worker is materialized as a `blob:` URL loaded via `importScripts`; a strict
  // CSP (worker-src/script-src blob:), an ad blocker, or a network hiccup can make that load
  // fail, surfacing as an error event rather than a thrown error at construction time.
  onerror?: ((this: AbstractWorker, ev: ErrorEvent) => unknown) | null;
  terminate?: () => void;
}

interface ImageBitmapDataURLResponseWorker {
  onmessage:
    | null
    | ((message: MessageEvent<ImageBitmapDataURLWorkerParams>) => void);
  postMessage(e: ImageBitmapDataURLWorkerResponse): void;
}

// `as any` because: https://github.com/Microsoft/TypeScript/issues/20595
const worker: ImageBitmapDataURLResponseWorker = self;

let reusableCanvas: OffscreenCanvas | null = null;
let reusableCtx: OffscreenCanvasRenderingContext2D | null = null;

// eslint-disable-next-line @typescript-eslint/no-misused-promises
worker.onmessage = async function (e) {
  if ('OffscreenCanvas' in globalThis) {
    const {
      id,
      bitmap,
      width,
      height,
      displayWidth,
      displayHeight,
      dataURLOptions,
    } = e.data;

    try {
      if (
        !reusableCanvas ||
        reusableCanvas.width !== width ||
        reusableCanvas.height !== height
      ) {
        reusableCanvas = new OffscreenCanvas(width, height);
        reusableCtx = reusableCanvas.getContext('2d', {
          willReadFrequently: true,
        })!;
      }

      reusableCtx!.clearRect(0, 0, width, height);
      reusableCtx!.drawImage(bitmap, 0, 0);
      bitmap.close();

      // fingerprint the raw pixels so unchanged frames skip the expensive
      // encode below entirely, instead of encoding first and deduping after
      const pixels = reusableCtx!.getImageData(0, 0, width, height);
      const fingerprint = fnv1aHash(pixels.data);
      const lastFingerprint = lastFingerprintMap.get(id);

      if (fingerprint === lastFingerprint) {
        return worker.postMessage({ id }); // unchanged
      }
      lastFingerprintMap.set(id, fingerprint);

      // a canvas that starts out transparent isn't worth transmitting
      if (
        lastFingerprint === undefined &&
        fingerprint === transparentFingerprint(width, height)
      ) {
        return worker.postMessage({ id });
      }

      const blob = await reusableCanvas.convertToBlob(dataURLOptions); // takes a while
      const arrayBuffer = await blob.arrayBuffer();
      worker.postMessage({
        id,
        type: blob.type,
        base64: encode(arrayBuffer), // cpu intensive
        displayWidth,
        displayHeight,
      });
    } catch {
      // Always respond so the main thread clears snapshotInProgressMap
      worker.postMessage({ id });
    }
  } else {
    e.data.bitmap.close();
    return worker.postMessage({ id: e.data.id });
  }
};
