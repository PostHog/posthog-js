import {
  snapshot,
  snapshotWithBudget,
  genId,
  type MaskInputOptions,
  type serializedElementNodeWithId,
  slimDOMDefaults,
  createMirror,
} from '@posthog/rrweb-snapshot';
import {
  initObservers,
  mutationBuffers,
  createMutationBufferLockToken,
  lockMutationBuffers,
  commitMutationBuffers,
  discardMutationBuffers,
  discardActiveMutationBufferTransaction,
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
// Module-level on purpose, like the mirror it protects: `record()` can be
// called again without stopping the previous session (the code below resets
// the shared mirror for exactly that case), and a time-sliced snapshot from
// the abandoned session may still be in flight at that point. Any new
// session — via stop() or via a fresh record() — bumps this, and the stale
// walk sees the bump and stands down instead of writing into the new
// session's mirror and event stream.
let recordingGeneration = 0;

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

interface BudgetedSnapshotTransaction {
  bufferToken: number;
  generation: number;
  startedAt: number;
  isCheckout: boolean;
  didEmitFullSnapshot: boolean;
  error: unknown | null;
  abortRequested: boolean;
  heldEventBytes: number;
  eventQueue: Array<[eventWithoutTime, boolean | undefined]>;
}

const MAX_HELD_EVENT_COUNT = 4_096;
const MAX_HELD_EVENT_BYTES = 16 * 1024 * 1024;

function estimateRetainedSize(value: unknown, ceiling: number): number {
  const seen = new WeakSet<object>();
  const stack: unknown[] = [value];
  let bytes = 0;
  while (stack.length && bytes <= ceiling) {
    const current = stack.pop();
    if (
      current === null ||
      current === undefined ||
      typeof current === 'boolean'
    ) {
      bytes += 8;
    } else if (typeof current === 'number' || typeof current === 'bigint') {
      bytes += 8;
    } else if (typeof current === 'string') {
      bytes += current.length * 2;
    } else if (typeof current === 'object') {
      if (seen.has(current)) continue;
      seen.add(current);
      if (ArrayBuffer.isView(current)) {
        bytes += current.byteLength;
      } else if (current instanceof ArrayBuffer) {
        bytes += current.byteLength;
      } else if (Array.isArray(current)) {
        bytes += current.length * 8;
        for (const item of current) {
          stack.push(item);
        }
      } else {
        const record = current as Record<string, unknown>;
        const keys = Object.keys(record);
        bytes += keys.length * 16;
        for (const key of keys) {
          bytes += key.length * 2;
          stack.push(record[key]);
        }
      }
    } else {
      bytes += 8;
    }
  }
  return bytes;
}

/**
 * Removes references to unclaimed reserved ids from an event held during a
 * time-sliced full snapshot (see the flush in takeFullSnapshotBudgeted for why
 * dropping these is lossless). Returns the event, a copy with the offending
 * positions filtered out, or null when nothing referencing a known node is
 * left. Covers every id-bearing incremental payload shape: a single `id`,
 * pointer `positions`, and selection `ranges`.
 */
function scrubUnclaimedIds(
  event: eventWithoutTime,
  unclaimedIds: Set<number>,
): eventWithoutTime | null {
  if (unclaimedIds.size === 0) return event;
  const e = event as { type: EventType; data?: Record<string, unknown> };
  if (e.type !== EventType.IncrementalSnapshot || !e.data) return event;
  const data = e.data;
  if (typeof data.id === 'number' && unclaimedIds.has(data.id)) {
    return null;
  }
  if (Array.isArray(data.positions)) {
    const positions = (data.positions as Array<{ id: number }>).filter(
      (p) => !unclaimedIds.has(p.id),
    );
    if (positions.length === 0) return null;
    if (positions.length !== data.positions.length) {
      return {
        ...(e as object),
        data: { ...data, positions },
      } as eventWithoutTime;
    }
  }
  if (Array.isArray(data.ranges)) {
    const referencesUnclaimed = (
      data.ranges as Array<{ start: number; end: number }>
    ).some((r) => unclaimedIds.has(r.start) || unclaimedIds.has(r.end));
    if (referencesUnclaimed) return null;
  }
  // The only mutation events that can be held are attach-iframe payloads
  // (real mutations sit in locked buffers). One whose iframe was never
  // reached is dropped whole: the iframe's buffered add re-serializes it on
  // unlock, which re-fires onIframeLoad and re-attaches the content against
  // an id the replayer does know.
  if (Array.isArray(data.adds)) {
    const referencesUnclaimed = (
      data.adds as Array<{ parentId: number; node: { id: number } }>
    ).some((a) => unclaimedIds.has(a.parentId) || unclaimedIds.has(a.node.id));
    if (referencesUnclaimed) return null;
  }
  return event;
}

function record<T = eventWithTime>(
  options: recordOptions<T> = {},
): listenerHandler | undefined {
  const {
    emit,
    checkoutEveryNms,
    checkoutEveryNth,
    fullSnapshotYieldBudgetMs = 0,
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

  // A fresh record() supersedes any previous session, even when its stop
  // closure was not called. Invalidate its async walk and release any buffer
  // transaction before resetting the shared mirror.
  recordingGeneration++;
  discardActiveMutationBufferTransaction();
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
  // Budgeted (time-sliced) full snapshot state. The FullSnapshot has to reach
  // the wire before anything that references the mirror it builds, so every
  // other event observed while one is in flight is held here — timestamped at
  // observation time — and delivered in order once the snapshot lands. See
  // wrappedEmit for why holding rather than dropping is the only safe option.
  let budgetedSnapshotInFlight = false;
  let budgetedSnapshotQueued: { isCheckout: boolean } | null = null;
  // True while the post-snapshot flush (held events + buffer unlock) runs:
  // those deliveries bypass the queue gate, while a takeFullSnapshot they may
  // trigger still coalesces instead of starting a walk mid-flush.
  let budgetedSnapshotFlushing = false;
  let activeBudgetedSnapshot: BudgetedSnapshotTransaction | null = null;
  // Set per id — one iframe id can collect several cleanups across loads.
  const iframeObserverCleanups = new Map<number, Set<listenerHandler>>();

  // Forward-declared; assigned inside the try{} block where `handlers` is
  // in scope. Optional-typed so a premature call is a no-op rather than a
  // silently-swallowed cleanup — the try-block runs synchronously after the
  // managers are constructed, but the types make that invariant explicit.
  let runAndDetachIframeCleanup: ((iframeId: number) => void) | undefined;
  let cleanupDetachedIframeObservers: (() => void) | undefined;
  let stopRecording: listenerHandler | undefined;
  let didStopRecording = false;

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
    // Stamped once, when the event is observed. An event held back for a sliced
    // full snapshot therefore keeps the time it actually happened rather than
    // the time it was released, and a caller that already knows the time an
    // event belongs to (the FullSnapshot below) can set it itself.
    e.timestamp ??= nowTimestamp();
    if (
      budgetedSnapshotInFlight &&
      !budgetedSnapshotFlushing &&
      e.type !== EventType.Meta &&
      e.type !== EventType.FullSnapshot
    ) {
      // CSSOM-family deltas (StyleSheetRule/StyleDeclaration) and canvas
      // commands describe a change to state the walk itself is about to
      // capture: if their target hasn't been serialized yet, the FullSnapshot
      // will already contain the post-change state, and delivering the delta
      // afterwards would apply it twice — for index-based CSSOM payloads that
      // also shifts every later rule index. Their post-snapshot deltas stay
      // consistent precisely because the snapshot reflects the live CSSOM at
      // serialization time.
      if (e.type === EventType.IncrementalSnapshot) {
        const data = e.data as { source?: number; id?: number };
        if (
          (data.source === IncrementalSource.StyleSheetRule ||
            data.source === IncrementalSource.StyleDeclaration ||
            data.source === IncrementalSource.CanvasMutation) &&
          typeof data.id === 'number' &&
          mirror.isPendingReservation(data.id)
        ) {
          return;
        }
      }
      // A sliced snapshot spans several tasks, so real events land while the
      // FullSnapshot is still being built. They cannot go out ahead of it — the
      // replayer needs the snapshot before anything that references it — so
      // they wait here and are delivered, in order, once it lands.
      //
      // Dropping them instead would not be equivalent to the synchronous path.
      // That path does not suppress these events, it *defers* them: the event
      // loop is blocked, so the handlers only run once serialization is done,
      // against the finished mirror. Dropping is also actively unsafe — a
      // MutationBuffer clears itself and drains `mapRemoves` into the mirror
      // before invoking its callback, so a dropped mutation event would leave
      // the recorder's mirror permanently ahead of the replay. The other
      // sources are not reliably self-healing either: input and scroll record
      // their dedup state before emitting, so a dropped event is never re-sent,
      // and StyleSheetRule deltas are index-based, so a dropped insertRule
      // misaligns every later rule index.
      const transaction = activeBudgetedSnapshot;
      if (!transaction || transaction.abortRequested) {
        return;
      }
      const retainedBytes = estimateRetainedSize(
        r,
        MAX_HELD_EVENT_BYTES - transaction.heldEventBytes,
      );
      if (
        transaction.eventQueue.length >= MAX_HELD_EVENT_COUNT ||
        transaction.heldEventBytes + retainedBytes > MAX_HELD_EVENT_BYTES
      ) {
        transaction.abortRequested = true;
        transaction.error = new Error(
          'Budgeted full snapshot held-event queue exceeded its safety limit',
        );
        transaction.eventQueue.length = 0;
        transaction.heldEventBytes = 0;
        return;
      }
      transaction.eventQueue.push([r, isCheckout]);
      transaction.heldEventBytes += retainedBytes;
      return;
    }
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

  const canvasMaskingConfigured = canvasMasking?.configured;

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
      canvasMaskingConfigured,
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

  const buildFullSnapshotOptions = () => ({
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
    canvasMaskingConfigured,
    inlineImages,
    onSerialize: (n: Node) => {
      if (budgetedSnapshotInFlight) {
        // A node added mid-walk to a parent the walk hadn't reached yet gets
        // serialized here, live — so its pending add in the locked buffers
        // has been superseded and must be forgotten, or the unlock would
        // emit a duplicate add (and resurrect the node past any later
        // removal). Sync snapshots never hit this: nothing runs while they
        // serialize, so nothing can be pending.
        mutationBuffers.forEach((buf) => buf.forgetAddedNode(n));
      }
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
    onIframeLoad: (
      iframe: HTMLIFrameElement,
      childSn: serializedElementNodeWithId,
    ) => {
      iframeManager.attachIframe(iframe, childSn);
      shadowDomManager.observeAttachShadow(iframe);
    },
    onIframeListenerRegistered: (
      iframe: HTMLIFrameElement,
      disposer: () => void,
    ) => {
      iframeManager.registerLoadListenerDisposer(iframe, disposer);
    },
    onStylesheetLoad: (
      linkEl: HTMLLinkElement,
      childSn: serializedElementNodeWithId,
    ) => {
      stylesheetManager.attachLinkElement(linkEl, childSn);
    },
    keepIframeSrcFn,
  });

  const emitMetaEvent = (isCheckout: boolean, timestamp?: number) => {
    wrappedEmit(
      {
        type: EventType.Meta,
        // The budgeted path passes the walk's start time so Meta and the
        // FullSnapshot it announces carry the same timestamp — stamping Meta
        // on emit could land it 1ms after the time the FullSnapshot is later
        // given, and the wire must stay in timestamp order.
        timestamp,
        data: {
          href: window.location.href,
          width: getWindowWidth(),
          height: getWindowHeight(),
        },
      } as unknown as eventWithoutTime,
      isCheckout,
    );
  };

  const finishFullSnapshot = () => {
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

  const takeFullSnapshotSynchronous = (isCheckout: boolean): boolean => {
    stylesheetManager.reset();
    shadowDomManager.init();

    const bufferToken = createMutationBufferLockToken();
    if (!lockMutationBuffers(bufferToken)) {
      console.warn('A different full snapshot owns the mutation buffers');
      return false;
    }
    emitMetaEvent(isCheckout);

    try {
      const node = snapshot(document, buildFullSnapshotOptions());
      if (!node) {
        discardMutationBuffers(bufferToken);
        mirror.reset();
        console.warn('Failed to snapshot the document');
        return false;
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
      commitMutationBuffers(bufferToken);
      finishFullSnapshot();
      return true;
    } catch (error) {
      discardMutationBuffers(bufferToken);
      mirror.reset();
      console.warn('Synchronous full snapshot failed', error);
      return false;
    }
  };

  // Time-sliced variant: same phases as the synchronous path below, but the
  // serialization yields to the event loop on the configured budget so a large
  // document doesn't block the page in one long task. Because the walk spans
  // several tasks, the page keeps running during it, and three things have to
  // hold for the recording to stay correct:
  //  - every mutation buffer stays locked for the whole walk, including buffers
  //    created *during* it (the document's own, plus shadow-root and iframe
  //    buffers spawned by the traversal) — hence lockMutationBuffers rather
  //    than a loop over the ones that happen to exist right now;
  //  - ids are reserved on demand, so an event observed before its node has
  //    been reached still resolves to the id that node is about to get;
  //  - everything observed in the meantime is held and delivered after the
  //    FullSnapshot, in order (see wrappedEmit).
  const takeFullSnapshotBudgeted = (isCheckout: boolean) => {
    if (budgetedSnapshotInFlight) {
      // coalesce concurrent requests into a single follow-up snapshot
      budgetedSnapshotQueued = {
        isCheckout: (budgetedSnapshotQueued?.isCheckout ?? false) || isCheckout,
      };
      return;
    }
    budgetedSnapshotInFlight = true;
    const transaction: BudgetedSnapshotTransaction = {
      bufferToken: createMutationBufferLockToken(),
      generation: recordingGeneration,
      startedAt: nowTimestamp(),
      isCheckout,
      didEmitFullSnapshot: false,
      error: null,
      abortRequested: false,
      heldEventBytes: 0,
      eventQueue: [],
    };
    activeBudgetedSnapshot = transaction;
    // The tree the walk produces describes the document as it is now, so this is
    // the time the FullSnapshot belongs at — not the time the walk happens to
    // finish. It also keeps the FullSnapshot ahead of everything observed during
    // the walk, so the stream stays in timestamp order.
    emitMetaEvent(isCheckout, transaction.startedAt);

    // When we take a full snapshot, old tracked StyleSheets need to be removed.
    stylesheetManager.reset();
    shadowDomManager.init();

    // Armed synchronously, before the first yield can happen, so that no buffer
    // can be created unlocked while the walk is in flight.
    if (!lockMutationBuffers(transaction.bufferToken)) {
      budgetedSnapshotInFlight = false;
      activeBudgetedSnapshot = null;
      throw new Error('A different full snapshot owns the mutation buffers');
    }
    mirror.beginIdReservation(genId);
    void snapshotWithBudget(document, {
      ...buildFullSnapshotOptions(),
      yieldBudgetMs: fullSnapshotYieldBudgetMs,
      // `mirror` is shared across recording sessions, so a walk whose recording
      // has been torn down has to stop writing to it, not just be ignored.
      shouldAbort: () =>
        transaction.generation !== recordingGeneration ||
        transaction.abortRequested,
    })
      .then((node) => {
        if (transaction.generation !== recordingGeneration) {
          // recording was stopped (or restarted) while we were serializing
          return;
        }
        if (!node) {
          transaction.error = new Error('Failed to snapshot the document');
          return;
        }
        const fullSnapshotEvent = {
          type: EventType.FullSnapshot,
          timestamp: transaction.startedAt,
          data: {
            node,
            initialOffset: getWindowScroll(window),
          },
        };
        wrappedEmit(
          fullSnapshotEvent as unknown as eventWithoutTime,
          isCheckout,
        );
        transaction.didEmitFullSnapshot = true;
      })
      .catch((error: unknown) => {
        transaction.error = error;
        console.warn('Budgeted full snapshot failed', error);
      })
      .finally(() => {
        if (transaction.generation !== recordingGeneration) {
          // This walk's recording is gone — torn down, or replaced by a newer
          // record() call. Leave EVERYTHING alone: the queue and buffers
          // belong to whoever owns the current generation now, and the id
          // reservation may be the new session's, mid-walk. Just stand down.
          budgetedSnapshotInFlight = false;
          budgetedSnapshotQueued = null;
          transaction.eventQueue.length = 0;
          discardMutationBuffers(transaction.bufferToken);
          if (activeBudgetedSnapshot === transaction) {
            activeBudgetedSnapshot = null;
          }
          return;
        }
        if (!transaction.didEmitFullSnapshot || transaction.error) {
          transaction.eventQueue.length = 0;
          budgetedSnapshotQueued = null;
          mirror.endIdReservation();
          discardMutationBuffers(transaction.bufferToken);
          mirror.reset();
          budgetedSnapshotInFlight = false;
          activeBudgetedSnapshot = null;

          if (!takeFullSnapshotSynchronous(transaction.isCheckout)) {
            recordingGeneration++;
            stopRecording?.();
          }
          return;
        }
        // A reserved id whose node was never reached belongs to a node created
        // during the walk inside already-visited territory. Its held events
        // have to be weeded out — the replayer will never learn that id — and
        // dropping them loses nothing: the node's add is sitting in the locked
        // mutation buffer and will re-serialize its *final* state (value,
        // attributes, text) on unlock. This matches the synchronous semantics
        // too: under a blocking snapshot a node cannot be created and
        // interacted with mid-snapshot at all.
        const unclaimedIds = new Set(mirror.getUnclaimedReservedIds());
        // Reservation ends with the walk. It must not still be on during the
        // unlock below: pushAdd relies on `parentId === -1` to know a parent
        // isn't serialized yet and defer the add, and a reserved id would hide
        // that, emitting an add against a parent the replayer never received.
        mirror.endIdReservation();

        // Held events go out first, each keeping the time it was observed —
        // all of which are inside the walk, and so before the mutations that
        // are about to be flushed. Ordering the stream by time rather than
        // bunching everything onto the instant the walk ended matters: index
        // based payloads (StyleSheetRule) are applied by the replayer in the
        // order it receives them, and collapsing a whole window into one
        // millisecond leaves it no room to interleave them correctly.
        //
        // The gate stays armed while this runs (deliveries bypass it via the
        // flushing flag): a held event can carry a timestamp old enough for
        // checkoutEveryNms/Nth to request a checkout mid-flush, and that
        // request must coalesce into the follow-up below — starting a new
        // walk here would interleave its Meta with the flush and its unlock
        // with the new walk's locks.
        budgetedSnapshotFlushing = true;
        try {
          const queuedEvents = transaction.eventQueue.splice(0);
          for (const [event, eventIsCheckout] of queuedEvents) {
            const scrubbed = scrubUnclaimedIds(event, unclaimedIds);
            if (scrubbed) {
              wrappedEmit(scrubbed, eventIsCheckout);
            }
          }

          commitMutationBuffers(transaction.bufferToken); // generate & emit any mutations that happened during snapshotting, as can now apply against the newly built mirror
          finishFullSnapshot();
        } finally {
          budgetedSnapshotFlushing = false;
          budgetedSnapshotInFlight = false;
          activeBudgetedSnapshot = null;
        }

        const pending = budgetedSnapshotQueued;
        budgetedSnapshotQueued = null;
        if (pending) {
          takeFullSnapshotBudgeted(pending.isCheckout);
        }
      });
  };

  takeFullSnapshot = (isCheckout = false) => {
    if (!recordDOM) {
      return;
    }
    if (fullSnapshotYieldBudgetMs > 0) {
      takeFullSnapshotBudgeted(isCheckout);
      return;
    }
    takeFullSnapshotSynchronous(isCheckout);
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
          canvasMaskingConfigured,
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
    stopRecording = () => {
      if (didStopRecording) {
        return;
      }
      didStopRecording = true;
      // Invalidate any time-sliced full snapshot still in flight before we tear
      // the managers down, so its continuation can't emit a FullSnapshot for a
      // recording that no longer exists, unlock buffers, or schedule a
      // follow-up. The walk itself stops on its own once nothing references it.
      recordingGeneration++;
      activeBudgetedSnapshot?.eventQueue.splice(0);
      budgetedSnapshotQueued = null;
      if (activeBudgetedSnapshot) {
        discardMutationBuffers(activeBudgetedSnapshot.bufferToken);
        activeBudgetedSnapshot = null;
      } else {
        discardActiveMutationBufferTransaction();
      }
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
    return stopRecording;
  } catch (error) {
    // A walk started by init() before the failure would otherwise keep
    // running against a recording that never finished setting up.
    recordingGeneration++;
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
