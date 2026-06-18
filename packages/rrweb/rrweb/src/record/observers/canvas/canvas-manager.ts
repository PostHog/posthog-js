import type { ICanvas, Mirror } from '@posthog/rrweb-snapshot';
import type {
  blockClass,
  canvasManagerMutationCallback,
  canvasMutationCallback,
  canvasMutationCommand,
  canvasMutationWithType,
  IWindow,
  listenerHandler,
  CanvasArg,
  DataURLOptions,
} from '@posthog/rrweb-types';
import { isBlocked } from '../../../utils';
import { CanvasContext } from '@posthog/rrweb-types';
import initCanvas2DMutationObserver from './2d';
import initCanvasContextObserver from './canvas';
import initCanvasWebGLMutationObserver from './webgl';
import ImageBitmapDataURLWorker from '../../workers/image-bitmap-data-url-worker?worker&inline';
import type { ImageBitmapDataURLRequestWorker } from '../../workers/image-bitmap-data-url-worker';

export type RafStamps = { latestId: number; invokeId: number | null };

type pendingCanvasMutationsMap = Map<
  HTMLCanvasElement,
  canvasMutationWithType[]
>;

export class CanvasManager {
  private pendingCanvasMutations: pendingCanvasMutationsMap = new Map();
  private rafStamps: RafStamps = { latestId: 0, invokeId: null };
  private mirror: Mirror;

  private mutationCb: canvasMutationCallback;
  private resetObservers?: listenerHandler;
  private frozen = false;
  private locked = false;
  private rafIdTimestamp: number | null = null;
  private rafIdFlush: number | null = null;
  private refCount = 0;
  private torndown = false;

  // Shared by the main document and every iframe/shadow-root observer, so reference-count
  // teardown: a single root cleaning up must not unpatch getContext / stop the FPS loop globally.
  public acquire() {
    this.refCount += 1;
  }

  public reset() {
    if (this.refCount > 0) {
      this.refCount -= 1;
    }
    if (this.refCount > 0) {
      return;
    }
    this.teardown();
  }

  private teardown() {
    if (this.torndown) {
      return;
    }
    this.torndown = true;
    this.pendingCanvasMutations.clear();
    this.resetObservers && this.resetObservers();
    if (this.rafIdTimestamp !== null) {
      cancelAnimationFrame(this.rafIdTimestamp);
      this.rafIdTimestamp = null;
    }
    if (this.rafIdFlush !== null) {
      cancelAnimationFrame(this.rafIdFlush);
      this.rafIdFlush = null;
    }
  }

  public freeze() {
    this.frozen = true;
  }

  public unfreeze() {
    this.frozen = false;
  }

  public lock() {
    this.locked = true;
  }

  public unlock() {
    this.locked = false;
  }

  constructor(options: {
    recordCanvas: boolean;
    mutationCb: canvasMutationCallback;
    win: IWindow;
    blockClass: blockClass;
    blockSelector: string | null;
    mirror: Mirror;
    sampling?: 'all' | number;
    dataURLOptions: DataURLOptions;
    // (0,1] fraction of the canvas display size to capture frames at; the frame is upscaled
    // back to its display size on replay, so playback dimensions/aspect are unchanged, just
    // softer. defaults to 1 (full resolution).
    resolutionScale?: number;
  }) {
    const {
      sampling = 'all',
      win,
      blockClass,
      blockSelector,
      recordCanvas,
      dataURLOptions,
      resolutionScale,
    } = options;
    this.mutationCb = options.mutationCb;
    this.mirror = options.mirror;

    const scale =
      typeof resolutionScale === 'number' &&
      resolutionScale > 0 &&
      resolutionScale <= 1
        ? resolutionScale
        : 1;

    if (recordCanvas && sampling === 'all')
      this.initCanvasMutationObserver(
        win,
        blockClass,
        blockSelector,
        dataURLOptions,
      );
    if (recordCanvas && typeof sampling === 'number')
      this.initCanvasFPSObserver(sampling, win, blockClass, blockSelector, {
        dataURLOptions,
        scale,
      });
  }

  private processMutation: canvasManagerMutationCallback = (
    target,
    mutation,
  ) => {
    const newFrame =
      this.rafStamps.invokeId &&
      this.rafStamps.latestId !== this.rafStamps.invokeId;
    if (newFrame || !this.rafStamps.invokeId)
      this.rafStamps.invokeId = this.rafStamps.latestId;

    if (!this.pendingCanvasMutations.has(target)) {
      this.pendingCanvasMutations.set(target, []);
    }

    this.pendingCanvasMutations.get(target)!.push(mutation);
  };

  private initCanvasFPSObserver(
    fps: number,
    win: IWindow,
    blockClass: blockClass,
    blockSelector: string | null,
    options: {
      dataURLOptions: DataURLOptions;
      scale: number;
    },
  ) {
    if (!('OffscreenCanvas' in win)) {
      return;
    }

    const canvasContextReset = initCanvasContextObserver(
      win,
      blockClass,
      blockSelector,
      true,
    );
    const snapshotInProgressMap: Map<number, boolean> = new Map();
    const worker =
      new ImageBitmapDataURLWorker() as ImageBitmapDataURLRequestWorker;
    worker.onmessage = (e) => {
      const { id } = e.data;
      snapshotInProgressMap.set(id, false);

      if (!('base64' in e.data)) return;

      const { base64, type, displayWidth, displayHeight } = e.data;
      // the encoded image may be downscaled; draw it stretched back to the canvas's display
      // size — carried through the worker with the frame, so playback keeps the original
      // dimensions and aspect ratio, just softer.
      const dw = displayWidth;
      const dh = displayHeight;
      this.mutationCb({
        id,
        type: CanvasContext['2D'],
        commands: [
          {
            property: 'clearRect', // wipe canvas
            args: [0, 0, dw, dh],
          },
          {
            property: 'drawImage', // draws (semi-transparent) image, stretched to display size
            args: [
              {
                rr_type: 'ImageBitmap',
                args: [
                  {
                    rr_type: 'Blob',
                    data: [{ rr_type: 'ArrayBuffer', base64 }],
                    type,
                  },
                ],
              } as CanvasArg,
              0,
              0,
              dw,
              dh,
            ],
          },
        ],
        displayWidth: dw,
        displayHeight: dh,
      });
    };

    const scale = options.scale;
    let lastSnapshotTime = 0;
    let rafId: number;

    const getCanvas = (): HTMLCanvasElement[] => {
      const matchedCanvas: HTMLCanvasElement[] = [];
      const searchCanvas = (haystack: ParentNode) => {
        try {
          haystack.querySelectorAll('canvas').forEach((canvas) => {
            if (!isBlocked(canvas, blockClass, blockSelector, true)) {
              matchedCanvas.push(canvas);
            }
          });
          haystack.querySelectorAll('*').forEach((elem) => {
            if (elem.shadowRoot) {
              searchCanvas(elem.shadowRoot);
            }
          });
        } catch {
          // Don't let traversal errors cancel the rAF loop.
        }
      };
      searchCanvas(win.document);
      return matchedCanvas;
    };

    const takeCanvasSnapshots = (timestamp: DOMHighResTimeStamp) => {
      if (lastSnapshotTime && timestamp - lastSnapshotTime < 1000 / fps) {
        rafId = requestAnimationFrame(takeCanvasSnapshots);
        return;
      }
      lastSnapshotTime = timestamp;

      getCanvas()
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        .forEach(async (canvas: HTMLCanvasElement) => {
          const id = this.mirror.getId(canvas);
          if (snapshotInProgressMap.get(id)) return;

          // The browser throws if the canvas is 0 in size
          // Uncaught (in promise) DOMException: Failed to execute 'createImageBitmap' on 'Window': The source image width is 0.
          // Assuming the same happens with height
          if (canvas.width === 0 || canvas.height === 0) return;

          snapshotInProgressMap.set(id, true);
          try {
            if (['webgl', 'webgl2'].includes((canvas as ICanvas).__context)) {
              // if the canvas hasn't been modified recently,
              // its contents won't be in memory and `createImageBitmap`
              // will return a transparent imageBitmap

              const context = canvas.getContext(
                (canvas as ICanvas).__context,
              ) as WebGLRenderingContext | WebGL2RenderingContext | null;
              // Snapshotting a lost context produces a transparent bitmap
              // that poisons the worker's fingerprint dedup map; skip it.
              if (context?.isContextLost?.()) {
                snapshotInProgressMap.set(id, false);
                return;
              }
              if (
                context?.getContextAttributes()?.preserveDrawingBuffer === false
              ) {
                // Hack to load canvas back into memory so `createImageBitmap` can grab it's contents.
                // Context: https://twitter.com/Juice10/status/1499775271758704643
                // Preferably we set `preserveDrawingBuffer` to true, but that's not always possible,
                // especially when canvas is loaded before rrweb.
                // This hack can wipe the background color of the canvas in the (unlikely) event that
                // the canvas background was changed but clear was not called directly afterwards.
                // Example of this hack having negative side effect: https://visgl.github.io/react-map-gl/examples/layers
                context.clear(context.COLOR_BUFFER_BIT);
              }
            }
            // createImageBitmap throws if resizing to 0
            // Fallback to intrinsic size if canvas has not yet rendered
            const displayWidth = canvas.clientWidth || canvas.width;
            const displayHeight = canvas.clientHeight || canvas.height;
            // capture at a (optionally downscaled) resolution; replay upscales it back to the
            // display size, so playback dimensions/aspect are unchanged, just softer.
            const captureWidth = Math.max(1, Math.round(displayWidth * scale));
            const captureHeight = Math.max(1, Math.round(displayHeight * scale));
            const bitmap = await createImageBitmap(
              canvas,
              // only ask for a quality resampling filter when we're actually downscaling;
              // at full resolution this keeps capture identical to before.
              scale < 1
                ? {
                    resizeWidth: captureWidth,
                    resizeHeight: captureHeight,
                    resizeQuality: 'medium',
                  }
                : { resizeWidth: captureWidth, resizeHeight: captureHeight },
            );
            // pass the display size through with the frame so the worker's reply can draw it
            // back to the right dimensions — no per-id state retained on the main thread.
            worker.postMessage(
              {
                id,
                bitmap,
                width: captureWidth,
                height: captureHeight,
                displayWidth,
                displayHeight,
                dataURLOptions: options.dataURLOptions,
              },
              [bitmap],
            );
          } catch {
            snapshotInProgressMap.set(id, false);
          }
        });
      rafId = requestAnimationFrame(takeCanvasSnapshots);
    };

    rafId = requestAnimationFrame(takeCanvasSnapshots);

    this.resetObservers = () => {
      canvasContextReset();
      cancelAnimationFrame(rafId);
    };
  }

  private initCanvasMutationObserver(
    win: IWindow,
    blockClass: blockClass,
    blockSelector: string | null,
    dataURLOptions: DataURLOptions,
  ): void {
    this.startRAFTimestamping();
    this.startPendingCanvasMutationFlusher();

    const canvasContextReset = initCanvasContextObserver(
      win,
      blockClass,
      blockSelector,
      false,
    );
    const canvas2DReset = initCanvas2DMutationObserver(
      this.processMutation.bind(this),
      win,
      blockClass,
      blockSelector,
      dataURLOptions,
    );

    const canvasWebGL1and2Reset = initCanvasWebGLMutationObserver(
      this.processMutation.bind(this),
      win,
      blockClass,
      blockSelector,
      dataURLOptions,
    );

    this.resetObservers = () => {
      canvasContextReset();
      canvas2DReset();
      canvasWebGL1and2Reset();
    };
  }

  private startPendingCanvasMutationFlusher() {
    this.rafIdFlush = requestAnimationFrame(() =>
      this.flushPendingCanvasMutations(),
    );
  }

  private startRAFTimestamping() {
    const setLatestRAFTimestamp = (timestamp: DOMHighResTimeStamp) => {
      this.rafStamps.latestId = timestamp;
      this.rafIdTimestamp = requestAnimationFrame(setLatestRAFTimestamp);
    };
    this.rafIdTimestamp = requestAnimationFrame(setLatestRAFTimestamp);
  }

  flushPendingCanvasMutations() {
    this.pendingCanvasMutations.forEach(
      (_values: canvasMutationCommand[], canvas: HTMLCanvasElement) => {
        const id = this.mirror.getId(canvas);
        this.flushPendingCanvasMutationFor(canvas, id);
      },
    );
    this.rafIdFlush = requestAnimationFrame(() =>
      this.flushPendingCanvasMutations(),
    );
  }

  flushPendingCanvasMutationFor(canvas: HTMLCanvasElement, id: number) {
    if (this.frozen || this.locked) {
      return;
    }

    const valuesWithType = this.pendingCanvasMutations.get(canvas);
    if (!valuesWithType || id === -1) return;

    const values = valuesWithType.map((value) => {
      const { type, ...rest } = value;
      return rest;
    });
    const { type } = valuesWithType[0];

    this.mutationCb({ id, type, commands: values });

    this.pendingCanvasMutations.delete(canvas);
  }
}
