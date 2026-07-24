import {
  snapshot,
  type MaskInputOptions,
  slimDOMDefaults,
  createMirror,
} from '@posthog/rrweb-snapshot';
import {
  initObservers,
  mutationBuffers,
  findAndRemoveIframeBuffer,
} from './observer';
import {
  on,
  callSafely,
  getWindowWidth,
  getWindowHeight,
  getWindowScroll,
  polyfill,
  hasShadowRoot,
  isSerializedIframe,
  isSerializedStylesheet,
  nowTimestamp,
} from '../utils';
import type { recordOptions } from '../types';
import {
  EventType,
  type eventWithoutTime,
  type eventWithTime,
  FullscreenCustomEventTag,
  type fullscreenEventPayload,
  IncrementalSource,
  type listenerHandler,
  type mutationCallbackParam,
  type scrollCallback,
  type canvasMutationParam,
  type adoptedStyleSheetParam,
} from '@posthog/rrweb-types';
import type { CrossOriginIframeMessageEventContent } from '../types';
import { IframeManager } from './iframe-manager';
import { ShadowDomManager } from './shadow-dom-manager';
import { CanvasManager } from './observers/canvas/canvas-manager';
import { StylesheetManager } from './stylesheet-manager';
import ProcessedNodeManager from './processed-node-manager';
import {
  callbackWrapper,
  registerErrorHandler,
  unregisterErrorHandler,
} from './error-handler';
import dom from '@posthog/rrweb-utils';

let wrappedEmit!: (e: eventWithoutTime, isCheckout?: boolean) => void;

let takeFullSnapshot!: (isCheckout?: boolean) => void;
let canvasManager!: CanvasManager;
let recording = false;

// Multiple tools (i.e. MooTools, Prototype.js) override Array.from and drop support for the 2nd parameter
// Try to pull a clean implementation from a newly created iframe
try {
  if (Array.from([1], (x) => x * 2)[0] !== 2) {
    const cleanFrame = document.createElement('iframe');
    document.body.appendChild(cleanFrame);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Array.from is static and doesn't rely on binding
    Array.from = cleanFrame.contentWindow?.Array.from || Array.from;
    document.body.removeChild(cleanFrame);
  }
} catch (err) {
  console.debug('Unable to override Array.from', err);
}

const mirror = createMirror();

// incremental sources which fire without user interaction (e.g. a looping
// background video, a JS animation) and so must not unfreeze a frozen page
// (upstream rrweb #1697). Hoisted so the check does not allocate per event.
const nonUserInitiatedSources = new Set<IncrementalSource>([
  IncrementalSource.Mutation,
  IncrementalSource.MediaInteraction, // often automatic e.g. background video loop
  IncrementalSource.StyleSheetRule,
  IncrementalSource.CanvasMutation,
  IncrementalSource.Font,
  IncrementalSource.Log,
  IncrementalSource.StyleDeclaration,
  IncrementalSource.AdoptedStyleSheet,
]);
function record<T = eventWithTime>(
  options: recordOptions<T> = {},
): listenerHandler | undefined {
  const {
    emit,
    checkoutEveryNms,
    checkoutEveryNth,
    blockClass = 'rr-block',
    blockSelector = null,
    ignoreClass = 'rr-ignore',
    ignoreSelector = null,
    maskTextClass = 'rr-mask',
    maskTextSelector = null,
    inlineStylesheet = true,
    maskAllInputs,
    maskInputOptions: _maskInputOptions,
    slimDOMOptions: _slimDOMOptions,
    maskInputFn,
    maskTextFn,
    hooks,
    packFn,
    sampling = {},
    dataURLOptions: _dataURLOptions = {},
    canvasResolutionScale,
    canvasMasking,
    mousemoveWait,
    recordDOM = true,
    recordCanvas = false,
    recordCrossOriginIframes = false,
    recordAfter = options.recordAfter === 'DOMContentLoaded'
      ? options.recordAfter
      : 'load',
    userTriggeredOnInput = false,
    collectFonts = false,
    inlineImages = false,
    plugins,
    keepIframeSrcFn = () => false,
    ignoreCSSAttributes = new Set([]),
    attributeFilter,
    errorHandler,
  } = options;

  registerErrorHandler(errorHandler);

  const dataURLOptions = {
    type: 'image/webp',
    quality: 0.4,
    maxBase64ImageLength: 1048576,
    ..._dataURLOptions,
  };

  const inEmittingFrame = recordCrossOriginIframes
    ? window.parent === window
    : true;

  let passEmitsToParent = false;
  if (!inEmittingFrame) {
    try {
      // throws if parent is cross-origin
      if (window.parent.document) {
        passEmitsToParent = false; // if parent is same origin we collect iframe events from the parent
      }
    } catch (e) {
      passEmitsToParent = true;
    }
  }

  // runtime checks for user options
  if (inEmittingFrame && !emit) {
    throw new Error('emit function is required');
  }
  if (!inEmittingFrame && !passEmitsToParent) {
    return () => {
      /* no-op since in this case we don't need to record anything from this frame in particular */
    };
  }
  // move departed options to new options
  if (mousemoveWait !== undefined && sampling.mousemove === undefined) {
    sampling.mousemove = mousemoveWait;
  }

  // reset mirror in case `record` this was called earlier
  mirror.reset();

  const maskInputOptions: MaskInputOptions =
    maskAllInputs === true
      ? {
          color: true,
          date: true,
          'datetime-local': true,
          email: true,
          month: true,
          number: true,
          range: true,
          search: true,
          tel: true,
          text: true,
          time: true,
          url: true,
          week: true,
          textarea: true,
          select: true,
          password: true,
        }
      : _maskInputOptions !== undefined
      ? _maskInputOptions
      : { password: true };

  const slimDOMOptions = slimDOMDefaults(
    _slimDOMOptions !== undefined ? _slimDOMOptions : false,
  );

  polyfill();

  let lastFullSnapshotEvent: eventWithTime;
  let incrementalSnapshotCount = 0;
  // Set per id — one iframe id can collect several cleanups across loads.
  const iframeObserverCleanups = new Map<number, Set<listenerHandler>>();

  // Forward-declared; assigned inside the try{} block where `handlers` is
  // in scope. Optional-typed so a premature call is a no-op rather than a
  // silently-swallowed cleanup — the try-block runs synchronously after the
  // managers are constructed, but the types make that invariant explicit.
  let runAndDetachIframeCleanup: ((iframeId: number) => void) | undefined;
  let cleanupDetachedIframeObservers: (() => void) | undefined;

  const eventProcessor = (e: eventWithTime): T => {
    for (const plugin of plugins || []) {
      if (plugin.eventProcessor) {
        e = plugin.eventProcessor(e);
      }
    }
    if (
      packFn &&
      // Disable packing events which will be emitted to parent frames.
      !passEmitsToParent
    ) {
      e = packFn(e) as unknown as eventWithTime;
    }
    return e as unknown as T;
  };
  wrappedEmit = (r: eventWithoutTime, isCheckout?: boolean) => {
    const e = r as eventWithTime;
    e.timestamp = nowTimestamp();
    if (
      mutationBuffers[0]?.isFrozen() &&
      e.type !== EventType.FullSnapshot &&
      !(
        e.type === EventType.IncrementalSnapshot &&
        nonUserInitiatedSources.has(e.data.source)
      )
    ) {
      // we've got a user initiated event so first we need to apply
      // all DOM changes that have been buffering during paused state
      mutationBuffers.forEach((buf) => buf.unfreeze());
    }

    if (inEmittingFrame) {
      emit?.(eventProcessor(e), isCheckout);
    } else if (passEmitsToParent) {
      const message: CrossOriginIframeMessageEventContent<T> = {
        type: 'rrweb',
        event: eventProcessor(e),
        origin: window.location.origin,
        isCheckout,
      };
      window.parent.postMessage(message, '*');
    }

    if (e.type === EventType.FullSnapshot) {
      lastFullSnapshotEvent = e;
      incrementalSnapshotCount = 0;
    } else if (e.type === EventType.IncrementalSnapshot) {
      // attach iframe should be considered as full snapshot
      if (
        e.data.source === IncrementalSource.Mutation &&
        e.data.isAttachIframe
      ) {
        return;
      }

      incrementalSnapshotCount++;
      const exceedCount =
        checkoutEveryNth && incrementalSnapshotCount >= checkoutEveryNth;
      const exceedTime =
        checkoutEveryNms &&
        e.timestamp - lastFullSnapshotEvent.timestamp > checkoutEveryNms;
      if (exceedCount || exceedTime) {
        takeFullSnapshot(true);
      }
    }
  };

  const wrappedMutationEmit = (m: mutationCallbackParam) => {
    // Clean up removed iframes (same-origin too). Detect reparenting by id
    // AND by element identity — MutationBuffer.emit clears mirror entries
    // before re-serializing adds, so a moved iframe may have a fresh id.
    if (m.removes && m.removes.length > 0) {
      const addedIds =
        m.adds.length > 0 ? new Set(m.adds.map((add) => add.node.id)) : null;
      const addedIframeElements = new Set<HTMLIFrameElement>();
      if (m.adds.length > 0) {
        for (const add of m.adds) {
          const node = mirror.getNode(add.node.id);
          if (node && (node as Element).nodeName === 'IFRAME') {
            addedIframeElements.add(node as HTMLIFrameElement);
          }
        }
      }

      m.removes.forEach(({ id }) => {
        if (addedIds && addedIds.has(id)) return;
        const removedIframe = iframeManager.getIframeElementById(id);
        if (removedIframe && addedIframeElements.has(removedIframe)) {
          // Reparent: keep observers/listeners; just drop stale id mapping.
          iframeManager.forgetIframeId(id);
          return;
        }
        runAndDetachIframeCleanup?.(id);
        iframeManager.removeIframeById(id);
      });

      // Catch iframes removed inside a removed subtree (only the ancestor's
      // id appears in m.removes). Disconnect observers before iframeManager
      // releases the buffers, matching the order of the direct-remove path
      // above so a queued mutation can't land on a freed buffer.
      cleanupDetachedIframeObservers?.();
      iframeManager.cleanupDetachedIframes();
    }

    wrappedEmit({
      type: EventType.IncrementalSnapshot,
      data: {
        source: IncrementalSource.Mutation,
        ...m,
      },
    });
  };
  const wrappedScrollEmit: scrollCallback = (p) =>
    wrappedEmit({
      type: EventType.IncrementalSnapshot,
      data: {
        source: IncrementalSource.Scroll,
        ...p,
      },
    });
  const wrappedCanvasMutationEmit = (p: canvasMutationParam) =>
    wrappedEmit({
      type: EventType.IncrementalSnapshot,
      data: {
        source: IncrementalSource.CanvasMutation,
        ...p,
      },
    });

  const wrappedAdoptedStyleSheetEmit = (a: adoptedStyleSheetParam) =>
    wrappedEmit({
      type: EventType.IncrementalSnapshot,
      data: {
        source: IncrementalSource.AdoptedStyleSheet,
        ...a,
      },
    });

  const stylesheetManager = new StylesheetManager({
    mutationCb: wrappedMutationEmit,
    adoptedStyleSheetCb: wrappedAdoptedStyleSheetEmit,
  });

  const iframeManager = new IframeManager({
    mirror,
    mutationCb: wrappedMutationEmit,
    stylesheetManager: stylesheetManager,
    recordCrossOriginIframes,
    wrappedEmit,
  });

  /**
   * Exposes mirror to the plugins
   */
  for (const plugin of plugins || []) {
    if (plugin.getMirror)
      plugin.getMirror({
        nodeMirror: mirror,
        crossOriginIframeMirror: iframeManager.crossOriginIframeMirror,
        crossOriginIframeStyleMirror:
          iframeManager.crossOriginIframeStyleMirror,
      });
  }

  const processedNodeManager = new ProcessedNodeManager();

  canvasManager = new CanvasManager({
    recordCanvas,
    mutationCb: wrappedCanvasMutationEmit,
    win: window,
    blockClass,
    blockSelector,
    mirror,
    sampling: sampling.canvas,
    dataURLOptions,
    resolutionScale: canvasResolutionScale,
    canvasMasking,
  });

  const shadowDomManager = new ShadowDomManager({
    mutationCb: wrappedMutationEmit,
    scrollCb: wrappedScrollEmit,
    bypassOptions: {
      blockClass,
      blockSelector,
      maskTextClass,
      maskTextSelector,
      inlineStylesheet,
      maskInputOptions,
      dataURLOptions,
      maskTextFn,
      maskInputFn,
      recordCanvas,
      inlineImages,
      sampling,
      slimDOMOptions,
      iframeManager,
      stylesheetManager,
      canvasManager,
      keepIframeSrcFn,
      processedNodeManager,
      attributeFilter,
    },
    mirror,
  });

  takeFullSnapshot = (isCheckout = false) => {
    if (!recordDOM) {
      return;
    }
    wrappedEmit(
      {
        type: EventType.Meta,
        data: {
          href: window.location.href,
          width: getWindowWidth(),
          height: getWindowHeight(),
        },
      },
      isCheckout,
    );

    // When we take a full snapshot, old tracked StyleSheets need to be removed.
    stylesheetManager.reset();

    shadowDomManager.init();

    mutationBuffers.forEach((buf) => buf.lock()); // don't allow any mirror modifications during snapshotting
    const node = snapshot(document, {
      mirror,
      blockClass,
      blockSelector,
      maskTextClass,
      maskTextSelector,
      inlineStylesheet,
      maskAllInputs: maskInputOptions,
      maskTextFn,
      maskInputFn,
      slimDOM: slimDOMOptions,
      dataURLOptions,
      recordCanvas,
      inlineImages,
      onSerialize: (n) => {
        if (isSerializedIframe(n, mirror)) {
          iframeManager.addIframe(n as HTMLIFrameElement);
        }
        if (isSerializedStylesheet(n, mirror)) {
          stylesheetManager.trackLinkElement(n as HTMLLinkElement);
        }
        if (hasShadowRoot(n)) {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          shadowDomManager.addShadowRoot(dom.shadowRoot(n as Node)!, document);
        }
      },
      onIframeLoad: (iframe, childSn) => {
        iframeManager.attachIframe(iframe, childSn);
        shadowDomManager.observeAttachShadow(iframe);
      },
      onIframeListenerRegistered: (
        iframe: HTMLIFrameElement,
        disposer: () => void,
      ) => {
        iframeManager.registerLoadListenerDisposer(iframe, disposer);
      },
      onStylesheetLoad: (linkEl, childSn) => {
        stylesheetManager.attachLinkElement(linkEl, childSn);
      },
      keepIframeSrcFn,
    });

    if (!node) {
      return console.warn('Failed to snapshot the document');
    }

    wrappedEmit(
      {
        type: EventType.FullSnapshot,
        data: {
          node,
          initialOffset: getWindowScroll(window),
        },
      },
      isCheckout,
    );
    mutationBuffers.forEach((buf) => buf.unlock()); // generate & emit any mutations that happened during snapshotting, as can now apply against the newly built mirror

    if (recordCrossOriginIframes) {
      iframeManager.reattachIframes();
    }

    // Some old browsers don't support adoptedStyleSheets.
    if (document.adoptedStyleSheets && document.adoptedStyleSheets.length > 0)
      stylesheetManager.adoptStyleSheets(
        document.adoptedStyleSheets,
        mirror.getId(document),
      );
  };

  try {
    const handlers: listenerHandler[] = [];

    // Disposes per-iframe observer cleanups and unlinks them from `handlers`.
    runAndDetachIframeCleanup = (iframeId: number) => {
      const cleanups = iframeObserverCleanups.get(iframeId);
      if (!cleanups) return;
      cleanups.forEach((cleanup) => {
        callSafely(cleanup);
        const idx = handlers.indexOf(cleanup);
        if (idx !== -1) handlers.splice(idx, 1);
      });
      iframeObserverCleanups.delete(iframeId);
    };

    cleanupDetachedIframeObservers = () => {
      for (const [iframeId] of iframeObserverCleanups) {
        const iframe = mirror.getNode(iframeId) as HTMLIFrameElement | null;
        if (!iframe) {
          runAndDetachIframeCleanup?.(iframeId);
          continue;
        }
        try {
          if (!iframe.contentDocument || !iframe.contentDocument.defaultView) {
            runAndDetachIframeCleanup?.(iframeId);
          }
        } catch {
          runAndDetachIframeCleanup?.(iframeId);
        }
      }
    };

    const observe = (doc: Document) => {
      return callbackWrapper(initObservers)(
        {
          mutationCb: wrappedMutationEmit,
          mousemoveCb: (positions, source) =>
            wrappedEmit({
              type: EventType.IncrementalSnapshot,
              data: {
                source,
                positions,
              },
            }),
          mouseInteractionCb: (d) =>
            wrappedEmit({
              type: EventType.IncrementalSnapshot,
              data: {
                source: IncrementalSource.MouseInteraction,
                ...d,
              },
            }),
          scrollCb: wrappedScrollEmit,
          viewportResizeCb: (d) =>
            wrappedEmit({
              type: EventType.IncrementalSnapshot,
              data: {
                source: IncrementalSource.ViewportResize,
                ...d,
              },
            }),
          inputCb: (v) =>
            wrappedEmit({
              type: EventType.IncrementalSnapshot,
              data: {
                source: IncrementalSource.Input,
                ...v,
              },
            }),
          mediaInteractionCb: (p) =>
            wrappedEmit({
              type: EventType.IncrementalSnapshot,
              data: {
                source: IncrementalSource.MediaInteraction,
                ...p,
              },
            }),
          styleSheetRuleCb: (r) =>
            wrappedEmit({
              type: EventType.IncrementalSnapshot,
              data: {
                source: IncrementalSource.StyleSheetRule,
                ...r,
              },
            }),
          styleDeclarationCb: (r) =>
            wrappedEmit({
              type: EventType.IncrementalSnapshot,
              data: {
                source: IncrementalSource.StyleDeclaration,
                ...r,
              },
            }),
          canvasMutationCb: wrappedCanvasMutationEmit,
          fontCb: (p) =>
            wrappedEmit({
              type: EventType.IncrementalSnapshot,
              data: {
                source: IncrementalSource.Font,
                ...p,
              },
            }),
          selectionCb: (p) => {
            wrappedEmit({
              type: EventType.IncrementalSnapshot,
              data: {
                source: IncrementalSource.Selection,
                ...p,
              },
            });
          },
          customElementCb: (c) => {
            wrappedEmit({
              type: EventType.IncrementalSnapshot,
              data: {
                source: IncrementalSource.CustomElement,
                ...c,
              },
            });
          },
          blockClass,
          ignoreClass,
          ignoreSelector,
          maskTextClass,
          maskTextSelector,
          maskInputOptions,
          inlineStylesheet,
          sampling,
          recordDOM,
          recordCanvas,
          inlineImages,
          userTriggeredOnInput,
          collectFonts,
          doc,
          maskInputFn,
          maskTextFn,
          keepIframeSrcFn,
          blockSelector,
          slimDOMOptions,
          dataURLOptions,
          mirror,
          iframeManager,
          stylesheetManager,
          shadowDomManager,
          processedNodeManager,
          canvasManager,
          ignoreCSSAttributes,
          attributeFilter,
          plugins:
            plugins
              ?.filter((p) => p.observer)
              ?.map((p) => ({
                observer: p.observer!,
                options: p.options,
                callback: (payload: object) =>
                  wrappedEmit({
                    type: EventType.Plugin,
                    data: {
                      plugin: p.name,
                      payload,
                    },
                  }),
              })) || [],
        },
        hooks,
      );
    };

    const loadListener = (iframeEl: HTMLIFrameElement) => {
      try {
        const iframeId = mirror.getId(iframeEl);
        const cleanup = observe(iframeEl.contentDocument!);
        handlers.push(cleanup);
        // Accumulate cleanups across iframe navigations.
        if (iframeId !== -1) {
          let bucket = iframeObserverCleanups.get(iframeId);
          if (!bucket) {
            bucket = new Set();
            iframeObserverCleanups.set(iframeId, bucket);
          }
          bucket.add(cleanup);
        }
      } catch (error) {
        // TODO: handle internal error
        console.warn(error);
      }
    };
    iframeManager.addLoadListener(loadListener);

    iframeManager.addPageHideListener((iframeEl) => {
      const iframeId = mirror.getId(iframeEl);
      runAndDetachIframeCleanup?.(iframeId);
      findAndRemoveIframeBuffer(iframeEl);
    });

    // Native fullscreen produces no DOM mutation (the browser styles the element
    // via the UA `:fullscreen` pseudo-class), so we record the transition as a
    // custom event the replayer can act on. We track the last id because on exit
    // `fullscreenElement` is already null.
    let lastFullscreenId = -1;
    const emitFullscreen = (payload: fullscreenEventPayload) =>
      wrappedEmit({
        type: EventType.Custom,
        data: { tag: FullscreenCustomEventTag, payload },
      });
    const emitFullscreenChange = () => {
      const doc = document as Document & {
        webkitFullscreenElement?: Element | null;
        mozFullScreenElement?: Element | null;
        msFullscreenElement?: Element | null;
      };
      const fullscreenEl =
        doc.fullscreenElement ??
        doc.webkitFullscreenElement ??
        doc.mozFullScreenElement ??
        doc.msFullscreenElement ??
        null;
      // -1 covers both "no element is fullscreen" and "fullscreen element is
      // blocked/ignored" (not in the mirror); both clear any prior fullscreen.
      const id = fullscreenEl ? mirror.getId(fullscreenEl) : -1;
      if (id === lastFullscreenId) return; // no change
      // Exit the previous element first. The browser can switch fullscreen
      // directly from one element to another without passing through null, so
      // this also fires on a direct switch — not just on a plain exit.
      if (lastFullscreenId !== -1) {
        emitFullscreen({ id: lastFullscreenId, enter: false });
      }
      lastFullscreenId = id;
      if (id !== -1) {
        emitFullscreen({ id, enter: true });
      }
    };

    const init = () => {
      takeFullSnapshot();
      handlers.push(observe(document));
      handlers.push(on('fullscreenchange', emitFullscreenChange));
      handlers.push(on('webkitfullscreenchange', emitFullscreenChange));
      handlers.push(on('mozfullscreenchange', emitFullscreenChange));
      handlers.push(on('MSFullscreenChange', emitFullscreenChange));
      recording = true;
    };
    if (['interactive', 'complete'].includes(document.readyState)) {
      init();
    } else {
      handlers.push(
        on('DOMContentLoaded', () => {
          wrappedEmit({
            type: EventType.DomContentLoaded,
            data: {},
          });
          if (recordAfter === 'DOMContentLoaded') init();
        }),
      );
      handlers.push(
        on(
          'load',
          () => {
            wrappedEmit({
              type: EventType.Load,
              data: {},
            });
            if (recordAfter === 'load') init();
          },
          window,
        ),
      );
    }
    return () => {
      handlers.forEach((h) => callSafely(h));
      processedNodeManager.destroy();
      iframeManager.removeLoadListener();
      iframeManager.destroy();
      iframeObserverCleanups.clear();
      // Global shadow teardown belongs to the recording lifecycle, not per-buffer reset() which would fire on every iframe teardown.
      shadowDomManager.reset();
      mirror.reset();
      recording = false;
      unregisterErrorHandler();
    };
  } catch (error) {
    // TODO: handle internal error
    console.warn(error);
  }
}

record.addCustomEvent = <T>(tag: string, payload: T) => {
  if (!recording) {
    throw new Error('please add custom event after start recording');
  }
  wrappedEmit({
    type: EventType.Custom,
    data: {
      tag,
      payload,
    },
  });
};

record.freezePage = () => {
  mutationBuffers.forEach((buf) => buf.freeze());
};

record.takeFullSnapshot = (isCheckout?: boolean) => {
  if (!recording) {
    throw new Error('please take full snapshot after start recording');
  }
  takeFullSnapshot(isCheckout);
};

record.mirror = mirror;

export default record;
