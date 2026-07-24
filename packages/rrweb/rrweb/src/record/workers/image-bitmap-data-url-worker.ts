import { encode } from 'base64-arraybuffer';
import type {
  ImageBitmapDataURLWorkerParams,
  ImageBitmapDataURLWorkerResponse,
} from '@posthog/rrweb-types';

const lastFingerprintMap: Map<number, string> = new Map();
const transparentFingerprintMap: Map<number, string> = new Map();
const lastSentAtMap: Map<number, number> = new Map();

const MASKED_KEYFRAME_INTERVAL_MS = 30_000;

// two independent hashes over 32-bit words rather than bytes: RGBA pixel
// buffers are multi-megabyte, always word-aligned, and this runs on every frame
function hashPixels(data: Uint8ClampedArray): string {
  const view = new Uint32Array(
    data.buffer,
    data.byteOffset,
    data.byteLength >>> 2,
  );
  let primaryHash = 0x811c9dc5;
  let secondaryHash = 0x9e3779b9;
  for (let i = 0; i < view.length; i++) {
    primaryHash ^= view[i];
    primaryHash = Math.imul(primaryHash, 0x01000193);
    secondaryHash ^= view[i];
    secondaryHash = Math.imul(secondaryHash, 0x85ebca6b);
  }
  return `${(primaryHash >>> 0).toString(16)}:${(
    secondaryHash >>> 0
  ).toString(16)}`;
}

// fingerprints are dimension-tagged: raw pixels alone can't distinguish a
// same-pixel-count resize (e.g. a solid-fill 100x200 -> 200x100), and the
// replayer must repaint after one
function frameFingerprint(
  width: number,
  height: number,
  data: Uint8ClampedArray,
): string {
  return `${width}x${height}:${hashPixels(data)}`;
}

function transparentFingerprint(width: number, height: number): string {
  // the hash of an all-zero buffer depends only on its length, so memoize by
  // pixel count — this sits on the per-frame path for still-blank canvases
  const pixelCount = width * height;
  let hash = transparentFingerprintMap.get(pixelCount);
  if (hash === undefined) {
    hash = hashPixels(new Uint8ClampedArray(pixelCount * 4));
    transparentFingerprintMap.set(pixelCount, hash);
  }
  return `${width}x${height}:${hash}`;
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
      maskRegions,
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
      const ctx = reusableCtx!;

      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();

      // mask before fingerprinting so dedup sees the same pixels that get encoded
      if (maskRegions) {
        ctx.fillStyle = 'black';
        for (const region of maskRegions) {
          ctx.fillRect(region.x, region.y, region.width, region.height);
        }
      }

      // fingerprint the raw pixels so unchanged frames skip the expensive
      // encode below entirely, instead of encoding first and deduping after.
      // an unseen canvas is compared against the transparent fingerprint, so
      // one that starts out blank is skipped like an unchanged frame
      const fingerprint = frameFingerprint(
        width,
        height,
        ctx.getImageData(0, 0, width, height).data,
      );
      const lastFingerprint =
        lastFingerprintMap.get(id) ?? transparentFingerprint(width, height);

      if (fingerprint === lastFingerprint) {
        // masked canvases can dedup for minutes at a stretch (changes hidden
        // under the mask don't alter the pixels), which leaves the player
        // nothing to repaint from after a scrub — send a keyframe anyway
        const lastSentAt = lastSentAtMap.get(id);
        const keyframeDue =
          maskRegions &&
          maskRegions.length > 0 &&
          lastSentAt !== undefined &&
          Date.now() - lastSentAt >= MASKED_KEYFRAME_INTERVAL_MS;
        if (!keyframeDue) {
          return worker.postMessage({ id }); // unchanged, or still blank
        }
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
      // only record the fingerprint once the frame was actually sent — a
      // transient encode failure must retry on the next frame, not be
      // remembered as "unchanged" and suppressed forever
      lastFingerprintMap.set(id, fingerprint);
      lastSentAtMap.set(id, Date.now());
    } catch {
      // Always respond so the main thread clears snapshotInProgressMap
      worker.postMessage({ id });
    }
  } else {
    e.data.bitmap.close();
    return worker.postMessage({ id: e.data.id });
  }
};
