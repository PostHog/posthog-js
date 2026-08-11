import {
  snapshot,
  snapshotWithBudget,
  genId,
  type BudgetedSnapshotController,
  type MaskInputOptions,
  type serializedElementNodeWithId,
  slimDOMDefaults,
  createMirror,
  takeDeferredStylesheetLinks,
} from '@posthog/rrweb-snapshot';
import type { serializedNodeWithId } from '@posthog/rrweb-types';
import {
  initObservers,
  mutationBuffers,
  anyMutationBufferHasPendingAdd,
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
  NodeType,
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
  reportError,
  unregisterErrorHandler,
} from './error-handler';
import dom from '@posthog/rrweb-utils';

// Reassigned by every record() call, so they always point at the NEWEST
// session. They exist only to route the public API (record.addCustomEvent,
// record.takeFullSnapshot); internal code must use the session-local
// bindings instead, or a stale continuation resumed after a rotation would
// call into the new session's world.
let wrappedEmit!: (
  e: eventWithoutTime,
  isCheckout?: boolean,
  preserveTimestamp?: boolean,
) => void;

let takeFullSnapshot!: (isCheckout?: boolean) => boolean;
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

const BUDGETED_SNAPSHOT_DIAGNOSTIC_TAG = 'budgeted-full-snapshot';

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

// SDK control events that may bypass the held window while a time-sliced
// full snapshot is in flight. The held window exists so nothing referencing
// the mirror gets ahead of the FullSnapshot; these posthog-js tags describe
// session/recorder state, never document state (their payloads carry no
// mirror node ids), so their position relative to the snapshot is meaningless
// to the replayer. And they lose their value when they arrive late: the SDK
// rotates sessions and closes buffers on them in real time. Everything else
// waits, because a consumer tag can carry anything, including node
// references.
const ORDER_INDEPENDENT_CONTROL_EVENT_TAGS = new Set<string>([
  '$session_id_change',
  '$session_ending',
  '$session_starting',
  '$recording_started',
  '$remote_config_received',
  '$session_options',
  '$posthog_config',
  'sessionIdle',
  'sessionNoLongerIdle',
  'browser offline',
  'browser online',
  'window visible',
  'window hidden',
  'recording paused',
  'recording resumed',
]);

// posthog-js records console output through this rrweb plugin. Its payload is
// level/trace/message strings (never mirror ids), and the replay console
// orders entries by timestamp, not wire position, so a console.error observed
// mid-walk can go out immediately instead of up to 30s late.
const CONSOLE_PLUGIN_NAME = 'rrweb/console@1';

const bypassesHeldEventWindow = (e: eventWithTime): boolean => {
  if (e.type === EventType.Custom) {
    const tag = (e.data as { tag?: unknown } | undefined)?.tag;
    return (
      typeof tag === 'string' && ORDER_INDEPENDENT_CONTROL_EVENT_TAGS.has(tag)
    );
  }
  if (e.type === EventType.Plugin) {
    return (
      (e.data as { plugin?: unknown } | undefined)?.plugin ===
      CONSOLE_PLUGIN_NAME
    );
  }
  return false;
};

// Whether a held event carries a Mutation payload (attach-iframe or forwarded
// child-frame content; real mutations sit in locked buffers, never here).
// These describe subtrees rooted in the aborted walk's output and cannot be
// re-anchored, so they are the one class of held event an abort must drop.
const isMutationHeldEvent = (event: eventWithoutTime): boolean => {
  const e = event as {
    type: EventType;
    data?: { source?: IncrementalSource };
  };
  return (
    e.type === EventType.IncrementalSnapshot &&
    e.data?.source === IncrementalSource.Mutation
  );
};

// Custom and Plugin payloads are the only held payloads the caller still owns
// after emit; the recorder builds every other event's payload itself and never
// touches it again. Snapshotting them at hold time keeps budgeted mode at
// parity with the synchronous path, where the payload is serialized before
// the caller can mutate it, and makes the held-byte cap measure the object
// that will actually be emitted.
const snapshotCallerOwnedEvent = (r: eventWithoutTime): eventWithoutTime => {
  try {
    if (typeof structuredClone === 'function') {
      return structuredClone(r);
    }
    return JSON.parse(JSON.stringify(r)) as eventWithoutTime;
  } catch {
    // an uncloneable payload keeps sync parity best-effort: holding the
    // reference beats losing the event
    return r;
  }
};

interface HeldEvent {
  event: eventWithoutTime;
  isCheckout: boolean | undefined;
  // How many nodes the walk had serialized when this event was observed —
  // the happens-before marker the flush uses to decide whether the snapshot
  // already contains a CSSOM delta's effect.
  seq: number;
}

interface BudgetedSnapshotTransaction {
  bufferToken: number;
  generation: number;
  startedAt: number;
  isCheckout: boolean;
  isRetry: boolean;
  didEmitFullSnapshot: boolean;
  completed: boolean;
  controller: BudgetedSnapshotController | null;
  error: unknown | null;
  abortRequested: boolean;
  abortReason: string | null;
  heldEventBytes: number;
  eventQueue: HeldEvent[];
  // Deepest the held queue got during the walk; the success diagnostic
  // reports it so operators can see how close a healthy walk runs to the cap.
  heldEventHighWater: number;
  // How many held events a failed predecessor carried into this walk.
  carriedHeldEventCount: number;
  serializedCount: number;
  // Per stylesheet carrier (<style>/<link>): when its CSS was read (walk
  // sequence) and whether the output carries live CSSOM or raw author text.
  styleTargets: Map<number, { seq: number; inlined: boolean }>;
  // Degradation accounting, reported as a custom event at flush so operators
  // can see a canary giving up instead of inferring it from missing data.
  overflow: { count: number; bytes: number } | null;
  droppedAfterAbort: number;
  // True while the pagehide/hidden path drains the walk synchronously: the
  // backlog cap must not veto a page-death flush — finishing IS the recovery.
  draining: boolean;
}

const MAX_HELD_EVENT_COUNT = 4_096;
const MAX_HELD_EVENT_BYTES = 16 * 1024 * 1024;
// Mutations don't pass through the held queue — locked buffers retain them as
// records and node references. A page churning hard enough to bank this many
// during one walk is better served by the synchronous fallback than by an
// unboundedly growing buffer and one giant commit batch.
const MAX_LOCKED_BUFFER_RECORDS = 50_000;
// Hard bound on a single walk. Continuous mutation stretches a cooperative
// walk (every fresh child list can contain new work), so past this the walk
// is abandoned in favor of the synchronous fallback.
const MAX_WALK_WALL_CLOCK_MS = 30_000;
const WATCHDOG_MESSAGE = 'exceeded its wall-clock limit';

// Bounds the estimator's own main-thread cost: every visit accrues at least
// 8 bytes, so the byte ceiling bounds visits too, but only when the caller's
// remaining budget is small. A structure that is still uncounted after this
// many visits is treated as over any ceiling rather than walked to the end.
const MAX_ESTIMATOR_VISITS = 131_072;

// Exported for unit tests only. Runs synchronously inside wrappedEmit, so it
// must never throw (payloads can carry proxies and throwing getters) and
// never under-count a container type to ~0 (Map/Set/Blob and cross-realm
// buffers don't answer instanceof/Object.keys).
export function estimateRetainedSize(value: unknown, ceiling: number): number {
  const seen = new WeakSet<object>();
  const stack: unknown[] = [value];
  let bytes = 0;
  let visits = 0;
  while (stack.length && bytes <= ceiling) {
    if (++visits > MAX_ESTIMATOR_VISITS) {
      return ceiling + 1;
    }
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
      try {
        const tag = Object.prototype.toString.call(current);
        if (ArrayBuffer.isView(current)) {
          bytes += current.byteLength;
        } else if (tag === '[object ArrayBuffer]') {
          // by tag, not instanceof: a buffer from an iframe realm is
          // otherwise counted as an empty object
          bytes += (current as ArrayBuffer).byteLength;
        } else if (tag === '[object Blob]' || tag === '[object File]') {
          bytes += (current as Blob).size;
        } else if (tag === '[object Map]') {
          bytes += (current as Map<unknown, unknown>).size * 16;
          for (const [k, v] of current as Map<unknown, unknown>) {
            stack.push(k, v);
          }
        } else if (tag === '[object Set]') {
          bytes += (current as Set<unknown>).size * 8;
          for (const item of current as Set<unknown>) {
            stack.push(item);
          }
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
            try {
              // enumerable getters are consumer code; one throwing property
              // must not take down the emit that is measuring it
              stack.push(record[key]);
            } catch {
              bytes += 8;
            }
          }
        }
      } catch {
        // a hostile proxy (throwing ownKeys/getPrototypeOf): charge a token
        // amount and move on rather than surfacing through wrappedEmit
        bytes += 64;
      }
    } else {
      bytes += 8;
    }
  }
  return bytes;
}

/**
 * Detects and removes references to the given reserved ids from an event held
 * during a time-sliced full snapshot. Used twice by the flush: any event still
 * referencing an id in the set is *deferred* until the buffer commit has
 * claimed the ids it references; after the commit the same scrub runs against
 * the ids that remained unclaimed (their nodes also left the DOM mid-walk, so
 * they exist for no one) and drops those references for good. Returns the
 * event unchanged, a copy with offending pointer positions or selection
 * ranges filtered out, or null.
 *
 * Inspected shapes: a single `id`, pointer `positions`, selection `ranges`,
 * mutation `adds`, and the recorder's own fullscreen custom event, whose
 * `payload.id` is a mirror id (matched by tag, because a consumer custom
 * event via record.addCustomEvent owns its payload shape and a numeric `id`
 * there is application data that may collide with a reservation by accident).
 * Mutation `removes`, `texts` and `attributes` are deliberately NOT
 * inspected. The only mutation payloads that reach the held queue are
 * attach-iframe payloads, which carry adds only (real mutations sit in
 * locked buffers), and child-frame events forwarded by the parent under
 * `recordCrossOriginIframes`, whose ids live in the crossOriginIframeMirror
 * remap space and can never collide with this document's reserved ids (each
 * genId value is handed out exactly once). Only `adds` can name a node of
 * THIS document (the host iframe element as parentId), so only `adds` needs
 * the check.
 *
 * Exported for unit tests only.
 */
export function scrubUnclaimedIds(
  event: eventWithoutTime,
  unclaimedIds: Set<number>,
): eventWithoutTime | null {
  if (unclaimedIds.size === 0) return event;
  const e = event as { type: EventType; data?: Record<string, unknown> };
  if (e.type === EventType.Custom && e.data) {
    // only the fullscreen tag carries a mirror id; see the docstring above
    if ((e.data as { tag?: unknown }).tag === FullscreenCustomEventTag) {
      const payload = e.data.payload as { id?: unknown } | undefined;
      if (
        payload &&
        typeof payload.id === 'number' &&
        unclaimedIds.has(payload.id)
      ) {
        return null;
      }
    }
    return event;
  }
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
  if (Array.isArray(data.ranges) && data.ranges.length > 0) {
    // filtered per range, like positions above: one dead range must not
    // cost a multi-range selection its still-valid ranges
    const ranges = (
      data.ranges as Array<{ start: number; end: number }>
    ).filter((r) => !unclaimedIds.has(r.start) && !unclaimedIds.has(r.end));
    if (ranges.length === 0) return null;
    if (ranges.length !== data.ranges.length) {
      return {
        ...(e as object),
        data: { ...data, ranges },
      } as eventWithoutTime;
    }
  }
  if (Array.isArray(data.adds)) {
    const referencesUnclaimed = (
      data.adds as Array<{ parentId: number; node: { id: number } }>
    ).some((a) => unclaimedIds.has(a.parentId) || unclaimedIds.has(a.node.id));
    if (referencesUnclaimed) return null;
  }
  return event;
}

/**
 * Stylesheet stringification is the dominant, and least bounded, cost of a full
 * snapshot on CSS-heavy pages: `stringifyStylesheet` reads `cssText` for every
 * CSSRule of every sheet, all inside one uninterruptible task.
 *
 * The cap is in rules rather than elapsed time on purpose. A time cap can only stop
 * the *next* sheet, so a single enormous sheet slips straight through it, and it
 * makes the split depend on how contended the machine happens to be - the same page
 * would defer different sheets from load to load. ~10k rules costs a couple of
 * hundred ms in Chrome and sits well above what an ordinary page carries (Bootstrap
 * is around 2-3k rules), so this is inert for most sites.
 */
export const DEFAULT_INLINE_STYLESHEET_BUDGET_RULES = 10_000;

type IdleTask = { cancel: () => void };
type IdleDeadline = { didTimeout: boolean; timeRemaining: () => number };

function whenIdle(cb: (deadline?: IdleDeadline) => void): IdleTask {
  const win = window as Window &
    typeof globalThis & {
      requestIdleCallback?: (
        cb: (deadline: IdleDeadline) => void,
        opts?: { timeout: number },
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
  if (typeof win.requestIdleCallback === 'function') {
    // the timeout keeps a permanently busy main thread from starving the CSS
    const handle = win.requestIdleCallback(cb, { timeout: 2000 });
    return { cancel: () => win.cancelIdleCallback?.(handle) };
  }
  // no idle scheduling (e.g. Safari <= 17): space the chunks out instead, so
  // they don't run back-to-back inside the page-load busy window
  const handle = setTimeout(cb, 250);
  return { cancel: () => clearTimeout(handle) };
}

/**
 * Inline the `<link rel=stylesheet>` elements the snapshot skipped once it ran out
 * of stylesheet budget, emitting each as an attribute mutation. At least one sheet
 * per idle callback so a busy main thread still makes progress, more while the
 * deadline says we're genuinely idle. Splitting the work this way keeps every task
 * short - the total CPU is unchanged, but the page stays responsive between chunks.
 */
function inlineDeferredStylesheets(
  links: Array<HTMLLinkElement | null>,
  stylesheetManager: StylesheetManager,
  onDone: () => void,
): () => void {
  let cancelled = false;
  let pending: IdleTask | null = null;
  let index = 0;

  const step = (deadline?: IdleDeadline) => {
    pending = null;
    if (cancelled) {
      return;
    }
    do {
      const link = links[index];
      // release the element so completed entries aren't pinned by this closure
      links[index] = null;
      index += 1;
      if (link) {
        callSafely(() =>
          stylesheetManager.inlineDeferredLinkElement(link, mirror.getId(link)),
        );
      }
    } while (
      index < links.length &&
      deadline &&
      !deadline.didTimeout &&
      deadline.timeRemaining() > 5
    );
    if (index < links.length) {
      pending = whenIdle(step);
    } else {
      onDone();
    }
  };

  pending = whenIdle(step);

  return () => {
    cancelled = true;
    pending?.cancel();
    pending = null;
  };
}

function record<T = eventWithTime>(
  options: recordOptions<T> = {},
): listenerHandler | undefined {
  // per-recorder, unlike its module-level siblings, so a stale recorder's stop
  // handler can't cancel a newer recorder's pending deferred inlining
  let cancelDeferredStylesheetInlining: (() => void) | undefined;
  const {
    emit,
    checkoutEveryNms,
    checkoutEveryNth,
    fullSnapshotYieldBudgetMs: rawFullSnapshotYieldBudgetMs = 0,
    blockClass = 'rr-block',
    blockSelector = null,
    ignoreClass = 'rr-ignore',
    ignoreSelector = null,
    maskTextClass = 'rr-mask',
    maskTextSelector = null,
    inlineStylesheet = true,
    inlineStylesheetBudgetRules = DEFAULT_INLINE_STYLESHEET_BUDGET_RULES,
    maskAllInputs,
    maskInputOptions: _maskInputOptions,
    slimDOMOptions: _slimDOMOptions,
    maskInputFn,
    maskTextFn,
    maskAllElementAttributes = false,
    maskAttributeFn,
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

  // Only a finite positive number is a real budget; anything else means off.
  // `true` would coerce to a 1ms budget (a minutes-long walk on large pages)
  // and Infinity to a walk that never yields at all.
  const fullSnapshotYieldBudgetMs =
    typeof rawFullSnapshotYieldBudgetMs === 'number' &&
    isFinite(rawFullSnapshotYieldBudgetMs) &&
    rawFullSnapshotYieldBudgetMs > 0
      ? rawFullSnapshotYieldBudgetMs
      : 0;
  if (fullSnapshotYieldBudgetMs !== (rawFullSnapshotYieldBudgetMs ?? 0)) {
    console.warn(
      'fullSnapshotYieldBudgetMs must be a finite number of milliseconds > 0; falling back to synchronous full snapshots',
    );
  }

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

  let lastFullSnapshotWallTime = 0;
  let incrementalSnapshotCount = 0;
  // Budgeted (time-sliced) full snapshot state. The FullSnapshot has to reach
  // the wire before anything that references the mirror it builds, so every
  // other event observed while one is in flight is held here — timestamped at
  // observation time — and delivered in order once the snapshot lands. See
  // sessionEmit for why holding rather than dropping is the only safe option,
  // and ORDER_INDEPENDENT_CONTROL_EVENT_TAGS for the SDK control events that
  // are exempt from the hold.
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
  // Session-local on purpose: everything this record() call wires up emits
  // through this exact function, so a continuation that outlives the session
  // (e.g. a sliced walk completing after a rotation) can never resolve to a
  // newer session's consumer through the module-level binding.
  const sessionEmit = (
    r: eventWithoutTime,
    isCheckout?: boolean,
    preserveTimestamp = false,
  ) => {
    const e = r as eventWithTime;
    // Preserve the historical parent-clock contract for ordinary events,
    // including transformed cross-origin iframe events whose child clock may
    // be skewed. Only recorder-owned budgeted snapshot events and events being
    // released from the held queue opt into keeping an explicit timestamp.
    if (preserveTimestamp) {
      e.timestamp ??= nowTimestamp();
    } else {
      e.timestamp = nowTimestamp();
    }
    if (
      budgetedSnapshotInFlight &&
      !budgetedSnapshotFlushing &&
      e.type !== EventType.Meta &&
      e.type !== EventType.FullSnapshot &&
      !bypassesHeldEventWindow(e)
    ) {
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
      if (!transaction) {
        return;
      }
      if (transaction.abortRequested) {
        transaction.droppedAfterAbort++;
        return;
      }
      // snapshot caller-owned payloads at hold time (see the helper); the
      // clone is what gets measured, scrubbed and eventually emitted
      const held =
        e.type === EventType.Custom || e.type === EventType.Plugin
          ? snapshotCallerOwnedEvent(r)
          : r;
      const retainedBytes = estimateRetainedSize(
        held,
        MAX_HELD_EVENT_BYTES - transaction.heldEventBytes,
      );
      if (
        transaction.eventQueue.length >= MAX_HELD_EVENT_COUNT ||
        transaction.heldEventBytes + retainedBytes > MAX_HELD_EVENT_BYTES
      ) {
        transaction.abortRequested = true;
        transaction.abortReason = 'held-queue-overflow';
        transaction.error = new Error(
          'Budgeted full snapshot held-event queue exceeded its safety limit',
        );
        transaction.overflow = {
          count: transaction.eventQueue.length,
          bytes: transaction.heldEventBytes,
        };
        transaction.eventQueue.length = 0;
        transaction.heldEventBytes = 0;
        return;
      }
      transaction.eventQueue.push({
        event: held,
        isCheckout,
        seq: transaction.serializedCount,
      });
      transaction.heldEventBytes += retainedBytes;
      if (transaction.eventQueue.length > transaction.heldEventHighWater) {
        transaction.heldEventHighWater = transaction.eventQueue.length;
      }
      return;
    }
    if (
      mutationBuffers[0]?.isFrozen() &&
      e.type !== EventType.FullSnapshot &&
      !(
        e.type === EventType.IncrementalSnapshot &&
        nonUserInitiatedSources.has(e.data.source)
      ) &&
      // recorder-internal diagnostics are not user activity; unfreezing on
      // them would defeat the freeze they may be reporting about
      !(
        e.type === EventType.Custom &&
        (e.data as { tag?: string }).tag === BUDGETED_SNAPSHOT_DIAGNOSTIC_TAG
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
      // The budgeted path backdates the event to walk start, but the checkout
      // clock must run from when the snapshot actually reached the wire — a
      // backdated marker makes every walk longer than checkoutEveryNms
      // immediately re-trip the checkout, a self-sustaining snapshot loop.
      lastFullSnapshotWallTime = preserveTimestamp
        ? nowTimestamp()
        : e.timestamp;
      incrementalSnapshotCount = 0;
    } else if (e.type === EventType.IncrementalSnapshot) {
      // attach iframe should be considered as full snapshot
      if (
        e.data.source === IncrementalSource.Mutation &&
        e.data.isAttachIframe
      ) {
        return;
      }

      // Held-window replays and commit deltas delivered by the flush describe
      // the walk window the snapshot just closed; counting them toward
      // checkoutEveryNth would let a burst re-trip a checkout from inside the
      // flush and fire a coalesced follow-up with zero enforced gap.
      if (!budgetedSnapshotFlushing) {
        incrementalSnapshotCount++;
      }
      const exceedCount =
        checkoutEveryNth && incrementalSnapshotCount >= checkoutEveryNth;
      // Zero means no FullSnapshot has ever reached the consumer (it is only
      // set when one lands). Requesting a checkout for every event in that
      // state is a Meta-plus-walk storm that just re-runs whatever failure
      // kept the first snapshot from landing.
      const exceedTime =
        checkoutEveryNms &&
        lastFullSnapshotWallTime !== 0 &&
        e.timestamp - lastFullSnapshotWallTime > checkoutEveryNms;
      if (exceedCount || exceedTime) {
        sessionTakeFullSnapshot(true);
      }
    }
  };
  wrappedEmit = sessionEmit;

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

    sessionEmit({
      type: EventType.IncrementalSnapshot,
      data: {
        source: IncrementalSource.Mutation,
        ...m,
      },
    });
  };
  const wrappedScrollEmit: scrollCallback = (p) =>
    sessionEmit({
      type: EventType.IncrementalSnapshot,
      data: {
        source: IncrementalSource.Scroll,
        ...p,
      },
    });
  const wrappedCanvasMutationEmit = (p: canvasMutationParam) =>
    sessionEmit({
      type: EventType.IncrementalSnapshot,
      data: {
        source: IncrementalSource.CanvasMutation,
        ...p,
      },
    });

  const wrappedAdoptedStyleSheetEmit = (a: adoptedStyleSheetParam) =>
    sessionEmit({
      type: EventType.IncrementalSnapshot,
      data: {
        source: IncrementalSource.AdoptedStyleSheet,
        ...a,
      },
    });

  // Reported from inside serializeTextNode for every <style> holding author
  // text — the walk and the commit both serialize through it. seq Infinity
  // marks a commit-time serialization, which happens after every held delta
  // was observed.
  const onStylesheetTextSerialized = (textNode: Text, inlined: boolean) => {
    const transaction = activeBudgetedSnapshot;
    if (!transaction) {
      return;
    }
    const styleEl = dom.parentNode(textNode);
    if (!styleEl) {
      return;
    }
    const id = mirror.getId(styleEl);
    if (id === -1) {
      return;
    }
    transaction.styleTargets.set(id, {
      // +1: this callback fires from inside the TEXT child's serialization,
      // before onSerialize increments the count for it — a delta observed in
      // the yield between the <style> element and its text child must compare
      // as before-the-read, or an inlined rule is applied twice.
      seq: budgetedSnapshotFlushing
        ? Infinity
        : transaction.serializedCount + 1,
      inlined,
    });
  };

  const stylesheetManager = new StylesheetManager({
    mutationCb: wrappedMutationEmit,
    adoptedStyleSheetCb: wrappedAdoptedStyleSheetEmit,
    maskAllElementAttributes,
    maskAttributeFn,
  });

  const iframeManager = new IframeManager({
    mirror,
    mutationCb: wrappedMutationEmit,
    stylesheetManager: stylesheetManager,
    recordCrossOriginIframes,
    wrappedEmit: sessionEmit,
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

  const canvasManager = new CanvasManager({
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
      maskAllElementAttributes,
      maskAttributeFn,
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
      onStylesheetTextSerialized,
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
    inlineStylesheetBudgetRules,
    maskTextFn,
    maskInputFn,
    maskAllElementAttributes,
    maskAttributeFn,
    slimDOM: slimDOMOptions,
    dataURLOptions,
    recordCanvas,
    canvasMaskingConfigured,
    inlineImages,
    onSerialize: (n: Node) => {
      const transaction = activeBudgetedSnapshot;
      if (transaction && !budgetedSnapshotFlushing) {
        transaction.serializedCount++;
        // Track what the snapshot captured for each stylesheet carrier, so
        // the flush can tell which held CSSOM deltas the FullSnapshot already
        // contains. `_cssText` presence covers <link> and empty <style>; a
        // <style> holding author text is corrected right after by
        // onStylesheetTextSerialized (its CSS lives in the text child,
        // serialized next).
        const meta = mirror.getMeta(n);
        if (meta && meta.type === NodeType.Element) {
          const tagName = (meta as { tagName?: string }).tagName;
          if (tagName === 'link' || tagName === 'style') {
            transaction.styleTargets.set(meta.id, {
              seq: transaction.serializedCount,
              inlined:
                (meta as { attributes?: Record<string, unknown> }).attributes
                  ?._cssText !== undefined,
            });
          }
        }
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
    onStylesheetTextSerialized,
    keepIframeSrcFn,
  });

  const emitMetaEvent = (isCheckout: boolean, timestamp?: number) => {
    sessionEmit(
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
      timestamp !== undefined,
    );
  };

  // Degraded budgeted-snapshot outcomes must be visible in production — a
  // console.warn is invisible to the operator deciding whether a canary is
  // healthy. Custom events ride the normal wire and are queryable/ingestable.
  const emitBudgetedSnapshotDiagnostic = (
    status: string,
    detail: Record<string, unknown> = {},
  ) => {
    try {
      sessionEmit({
        type: EventType.Custom,
        data: {
          tag: BUDGETED_SNAPSHOT_DIAGNOSTIC_TAG,
          payload: { status, budgetMs: fullSnapshotYieldBudgetMs, ...detail },
        },
      } as eventWithoutTime);
    } catch {
      // diagnostics must never break the recording
    }
  };

  const finishFullSnapshot = () => {
    if (recordCrossOriginIframes) {
      // guarded: a failed reattach must not cost the adopted stylesheets
      // below their delivery, or the document replays unstyled
      try {
        iframeManager.reattachIframes();
      } catch (error) {
        reportError(error);
        console.warn('Iframe reattach failed', error);
      }
    }

    // Some old browsers don't support adoptedStyleSheets.
    if (document.adoptedStyleSheets && document.adoptedStyleSheets.length > 0)
      stylesheetManager.adoptStyleSheets(
        document.adoptedStyleSheets,
        mirror.getId(document),
      );
  };

  const takeFullSnapshotSynchronous = (isCheckout: boolean): boolean => {
    const generation = recordingGeneration;
    // Lock viability is checked before Meta goes out: a reentrant call that
    // cannot own the buffers (e.g. a checkout requested from inside a buffer
    // commit) must not put an orphan Meta on the wire with no FullSnapshot
    // behind it.
    const bufferToken = createMutationBufferLockToken();
    if (!lockMutationBuffers(bufferToken)) {
      console.warn('A different full snapshot owns the mutation buffers');
      return false;
    }

    try {
      emitMetaEvent(isCheckout);
      // The consumer's Meta handling can synchronously stop() this recording
      // or start a new one; the mirror and the buffers belong to that session
      // now. The discard is token-checked, a no-op when the new owner already
      // released this token.
      if (generation !== recordingGeneration) {
        discardMutationBuffers(bufferToken);
        return false;
      }

      // Any deferred inlining from the previous snapshot targets mirror ids
      // this snapshot is about to replace, so drop it rather than emitting
      // stale mutations.
      cancelDeferredStylesheetInlining?.();
      cancelDeferredStylesheetInlining = undefined;

      stylesheetManager.reset();
      shadowDomManager.init();

      let node: ReturnType<typeof snapshot> = null;
      let deferredStylesheetLinks: HTMLLinkElement[] = [];
      try {
        node = snapshot(document, buildFullSnapshotOptions());
      } finally {
        // drain even when the snapshot throws, so a failed snapshot doesn't
        // leave links queued for the next one
        deferredStylesheetLinks = takeDeferredStylesheetLinks();
      }
      if (!node) {
        discardMutationBuffers(bufferToken);
        console.warn('Failed to snapshot the document');
        return false;
      }

      sessionEmit(
        {
          type: EventType.FullSnapshot,
          data: {
            node,
            initialOffset: getWindowScroll(window),
          },
        },
        isCheckout,
      );
      // Same reentrancy hazard as the Meta emit above: a rotation from the
      // consumer's FullSnapshot handling owns the mirror now, so the commit,
      // the canvas reset and finishFullSnapshot must not run. The discard is
      // token-checked, a no-op when the new owner released it already.
      if (generation !== recordingGeneration) {
        discardMutationBuffers(bufferToken);
        return false;
      }
      const commitOutcome = commitMutationBuffers(bufferToken);
      if (generation !== recordingGeneration) {
        return false;
      }
      // deferred records are freezePage semantics (unfreeze() delivers
      // them); only genuine loss is worth a diagnostic on this path
      if (commitOutcome.droppedRecordCount > 0) {
        emitBudgetedSnapshotDiagnostic('mutation-commit-incomplete', {
          droppedMutationRecords: commitOutcome.droppedRecordCount,
          deferredMutationRecords: commitOutcome.deferredRecordCount,
        });
        if (generation !== recordingGeneration) {
          return false;
        }
      }
      canvasManager.onFullSnapshot();
      finishFullSnapshot();
      if (deferredStylesheetLinks.length) {
        cancelDeferredStylesheetInlining = inlineDeferredStylesheets(
          deferredStylesheetLinks,
          stylesheetManager,
          () => {
            // queue drained: drop the handle so the closure and its links can
            // be collected
            cancelDeferredStylesheetInlining = undefined;
          },
        );
      }
      return true;
    } catch (error) {
      // Release the locks, then let the error propagate exactly as the
      // pre-budget path did: the SDK catches and retries. Swallowing it here
      // turned one transient throw into silent permanent teardown. The mirror
      // is deliberately NOT reset — partially claimed ids are reused by the
      // next serialization (the checkout invariant), and a reset would re-key
      // every node and orphan iframeManager's attached trees.
      discardMutationBuffers(bufferToken);
      throw error;
    }
  };

  // Whether the snapshot already contains a held CSSOM delta's effect. The
  // walk records, per stylesheet carrier, when its CSS was read and whether
  // the output carries live CSSOM or raw author text; a delta observed before
  // that read is inside an inlined snapshot (delivering it would double-apply
  // and shift every later rule index) but missing from a raw one (dropping it
  // would lose the rule and misalign every later index — the two failure
  // modes of gating on "the snapshot will contain it" without checking).
  const heldCssomDeltaCoveredBySnapshot = (
    transaction: BudgetedSnapshotTransaction,
    held: HeldEvent,
  ): boolean => {
    const e = held.event as {
      type: EventType;
      data?: { source?: number; id?: unknown };
    };
    if (e.type !== EventType.IncrementalSnapshot || !e.data) return false;
    if (
      e.data.source !== IncrementalSource.StyleSheetRule &&
      e.data.source !== IncrementalSource.StyleDeclaration
    ) {
      return false;
    }
    // styleId-keyed deltas (constructed/adopted sheets) aren't node-targeted;
    // their sheets ride separate AdoptedStyleSheet events, never the snapshot
    if (typeof e.data.id !== 'number') return false;
    const entry = transaction.styleTargets.get(e.data.id);
    if (entry) {
      return held.seq < entry.seq && entry.inlined;
    }
    // No walk entry: the target was created mid-walk and delivered by the
    // commit's add, which serializes after every held delta was observed.
    // <link>/empty <style> carry the live CSSOM as _cssText; a <style> with
    // author text wrote an entry via onStylesheetTextSerialized above.
    const node = mirror.getNode(e.data.id);
    const meta = node && mirror.getMeta(node);
    if (meta && meta.type === NodeType.Element) {
      return (
        (meta as { attributes?: Record<string, unknown> }).attributes
          ?._cssText !== undefined
      );
    }
    return false;
  };

  // True once this walk's recording has been replaced (by its own stop(), or
  // by a newer record() call). Re-checked after EVERY callout that can run
  // consumer code (emit, error handler, buffer commit): the consumer can
  // rotate the recorder synchronously from inside any of them, and from that
  // point the shared mirror, its id reservation and the buffers belong to the
  // new session, possibly mid-walk.
  const walkSuperseded = (transaction: BudgetedSnapshotTransaction) =>
    transaction.generation !== recordingGeneration;

  // Stand down without touching anything shared: no mirror, no reservation,
  // no canvas manager, no emit. The new owner already reset the mirror; the
  // buffer discard is token-checked, a no-op when it released this token too.
  const abandonSupersededWalk = (transaction: BudgetedSnapshotTransaction) => {
    budgetedSnapshotInFlight = false;
    budgetedSnapshotFlushing = false;
    budgetedSnapshotQueued = null;
    transaction.eventQueue.length = 0;
    discardMutationBuffers(transaction.bufferToken);
    if (activeBudgetedSnapshot === transaction) {
      activeBudgetedSnapshot = null;
    }
  };

  // Everything that has to happen once the walk produced a tree (or failed):
  // emit, flush the held window, release the transaction. One idempotent
  // function rather than promise-chain stages, because it has two callers
  // with different timing: the walk's own promise chain, and the pagehide /
  // hidden-tab path that drains the walk synchronously — a parked yield never
  // fires on a dying page, and the promise chain would run too late for the
  // SDK's unload flush to see the events.
  const completeBudgetedWalk = (
    transaction: BudgetedSnapshotTransaction,
    node: serializedNodeWithId | null,
  ) => {
    if (transaction.completed) {
      return;
    }
    transaction.completed = true;
    if (walkSuperseded(transaction)) {
      abandonSupersededWalk(transaction);
      return;
    }

    if (node && !transaction.error) {
      const fullSnapshotEvent = {
        type: EventType.FullSnapshot,
        // The tree the walk produced describes the document as it was at walk
        // start — that's the time it belongs at, and it keeps the FullSnapshot
        // ahead of everything observed during the walk on the wire.
        timestamp: transaction.startedAt,
        data: {
          node,
          initialOffset: getWindowScroll(window),
        },
      };
      try {
        sessionEmit(
          fullSnapshotEvent as unknown as eventWithoutTime,
          transaction.isCheckout,
          true,
        );
        transaction.didEmitFullSnapshot = true;
      } catch (error) {
        // a throwing consumer callback must fall through to the failure
        // path's cleanup, not escape with the transaction latched in-flight
        transaction.error = error;
        reportError(error);
        console.warn('Budgeted full snapshot emit failed', error);
      }
      // The consumer just ran (its emit, or its error handler): a stop() /
      // record() from inside it means the reservation this completion is
      // about to pause and end is the NEW session's, live and mid-walk.
      if (walkSuperseded(transaction)) {
        abandonSupersededWalk(transaction);
        return;
      }
    } else {
      // an overflow/watchdog abort already recorded its own error
      transaction.error ??= new Error('Failed to snapshot the document');
    }

    if (!transaction.didEmitFullSnapshot) {
      // Sheets this walk's stylesheet budget skipped die with it — the
      // retry/fallback below re-serializes them and re-defers what its own
      // budget skips. No rotation can have happened since the entry check
      // on this branch, so the queue is exclusively this walk's.
      takeDeferredStylesheetLinks();
      const reason = transaction.abortReason ?? 'walk-error';
      // a checkout that coalesced while this walk ran must not be silently
      // downgraded by the recovery snapshot
      const isCheckout =
        transaction.isCheckout || (budgetedSnapshotQueued?.isCheckout ?? false);
      // No budgeted retry while the page is dying (`draining`): a retry walk
      // started from a pagehide handler would park on yields that never
      // fire; the synchronous fallback below is the only recovery that can
      // still finish inside this task.
      const willRetry =
        !transaction.isRetry &&
        reason !== 'walk-error' &&
        !transaction.draining;
      // Held non-mutation events stay deliverable across the one budgeted
      // retry: the mirror is not reset, so the ids they reference are
      // re-claimed by the retry's serialization (the checkout invariant) and
      // the retry's flush delivers them after its FullSnapshot. Only what
      // genuinely cannot survive is dropped (mutation payloads and
      // references to reservations no serialization ever claimed), and every
      // drop is counted into the diagnostics below.
      const abandonedHeldEvents = transaction.eventQueue.splice(0);
      const carriedHeldEvents: HeldEvent[] = [];
      let droppedHeldOnAbort = 0;
      if (willRetry && abandonedHeldEvents.length > 0) {
        const unclaimed = new Set(mirror.getUnclaimedReservedIds());
        for (const held of abandonedHeldEvents) {
          if (isMutationHeldEvent(held.event)) {
            droppedHeldOnAbort++;
            continue;
          }
          const scrubbed = scrubUnclaimedIds(held.event, unclaimed);
          if (!scrubbed) {
            droppedHeldOnAbort++;
            continue;
          }
          // seq 0: observed before any node of the retry walk is serialized,
          // so the retry's CSSOM coverage check reads these as pre-read deltas
          carriedHeldEvents.push({
            event: scrubbed,
            isCheckout: held.isCheckout,
            seq: 0,
          });
        }
      } else {
        droppedHeldOnAbort = abandonedHeldEvents.length;
      }
      budgetedSnapshotQueued = null;
      mirror.endIdReservation();
      discardMutationBuffers(transaction.bufferToken);
      budgetedSnapshotInFlight = false;
      activeBudgetedSnapshot = null;
      let droppedHeldEventCount =
        (transaction.overflow?.count ?? 0) +
        transaction.droppedAfterAbort +
        droppedHeldOnAbort;

      // The mirror is deliberately NOT reset on any failure path: ids the
      // aborted walk already claimed are reused by the next serialization
      // (the checkout invariant), and a reset would re-key every node and
      // orphan iframeManager's attached cross-origin trees.
      if (willRetry) {
        // Overflow and watchdog aborts are load-dependent — the page may have
        // been mid-burst (a route change, a data refresh). One fresh walk is
        // cheap; going straight to the synchronous fallback re-runs the very
        // stall this feature exists to avoid.
        emitBudgetedSnapshotDiagnostic('budgeted-retry', {
          reason,
          walkMs: nowTimestamp() - transaction.startedAt,
          droppedHeldEventCount,
          droppedHeldEventBytes: transaction.overflow?.bytes ?? 0,
          carriedHeldEventCount: carriedHeldEvents.length,
        });
        // the diagnostic went through the consumer too; a rotation from it
        // means the retry would walk the new session's mirror
        if (walkSuperseded(transaction)) {
          return;
        }
        try {
          takeFullSnapshotBudgeted(isCheckout, true, carriedHeldEvents);
          // the retry walk (or the in-flight walk it coalesced into) owns
          // recovery from here
          return;
        } catch (retryError) {
          // the retry never took ownership of the carried events
          droppedHeldEventCount += carriedHeldEvents.length;
          // e.g. the consumer's emit throws at the retry's Meta. Swallowing
          // this and returning would leave a live recorder that never emits
          // a FullSnapshot, so a genuine failure falls through to the
          // synchronous fallback below.
          reportError(retryError);
          console.warn('Budgeted full snapshot retry failed', retryError);
          if (walkSuperseded(transaction)) {
            // a rotation mid-throw stands down; the fallback would snapshot
            // the new session's world
            return;
          }
        }
      }

      emitBudgetedSnapshotDiagnostic('sync-fallback', {
        reason,
        isRetry: transaction.isRetry,
        walkMs: nowTimestamp() - transaction.startedAt,
        droppedHeldEventCount,
        droppedHeldEventBytes: transaction.overflow?.bytes ?? 0,
      });
      if (walkSuperseded(transaction)) {
        return;
      }

      // A fallback failure must not tear recording down — incremental
      // events still flow against the last good snapshot, and the next
      // periodic snapshot retries. Teardown here converted one transient
      // consumer throw into a silently dead recording.
      try {
        takeFullSnapshotSynchronous(isCheckout);
      } catch (fallbackError) {
        reportError(fallbackError);
        emitBudgetedSnapshotDiagnostic('sync-fallback-failed');
        console.warn(
          'Synchronous fallback full snapshot failed',
          fallbackError,
        );
      }
      return;
    }

    // Reservation stays claimable through the commit below: a reserved id
    // whose node was never reached belongs to a node created (or moved) during
    // the walk, and the commit's re-serialization claims exactly that id — so
    // events referencing it are deferred past the commit rather than dropped.
    // Only the *handout* of new ids stops here: the commit's add-ordering
    // probes parents via getId and must read -1 for an unserialized parent to
    // defer the add, not receive a fresh reservation.
    mirror.pauseReservationHandout();
    const pendingBeforeCommit = new Set(mirror.getUnclaimedReservedIds());

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
    // Degradation accounting across both commits and the deferred pass,
    // reported once the flush is done: mutations lost to a force-discard,
    // mutations a frozen buffer holds back for unfreeze(), and held events
    // dropped because the id they reference was never claimed.
    let droppedMutationRecords = 0;
    let deferredMutationRecords = 0;
    let droppedHeldEvents = 0;
    let failedHeldEventDeliveries = 0;
    // Every delivery below re-enters the consumer, and the consumer can
    // rotate the recorder from any of them. The early returns land in the
    // finally blocks, which release this transaction's own state either way
    // but only touch the shared mirror and buffers while this walk still
    // owns them.
    try {
      try {
        if (recordCrossOriginIframes) {
          // Held child-frame events reference nodes inside previously
          // attached iframe documents; the replayer drops them as unknown
          // unless the reattach lands first. Guarded: a failed reattach
          // loses those frames' context, not the held window, the commit
          // or the canvas/adopted-sheet steps behind it.
          try {
            iframeManager.reattachIframes();
          } catch (reattachError) {
            reportError(reattachError);
            console.warn('Iframe reattach failed', reattachError);
          }
          if (walkSuperseded(transaction)) {
            return;
          }
        }
        const queuedEvents = transaction.eventQueue.splice(0);
        const deferred: HeldEvent[] = [];
        // A consumer throw on one delivery must not drop the rest of the
        // held window (input/scroll dedup means dropped deltas never
        // re-send). For the same reason the failed event itself is retried
        // once (the observer already advanced its dedup state past it, so a
        // drop here is permanent), and still-failed deliveries are counted
        // into the flush diagnostic.
        const emitHeld = (
          event: eventWithoutTime,
          isCheckout: boolean | undefined,
          preserveTimestamp: boolean,
        ) => {
          try {
            sessionEmit(event, isCheckout, preserveTimestamp);
          } catch (emitError) {
            reportError(emitError);
            if (walkSuperseded(transaction)) {
              failedHeldEventDeliveries++;
              return;
            }
            try {
              sessionEmit(event, isCheckout, preserveTimestamp);
            } catch (retryError) {
              failedHeldEventDeliveries++;
              reportError(retryError);
              console.warn('Held event delivery failed', retryError);
            }
          }
        };
        for (const held of queuedEvents) {
          if (heldCssomDeltaCoveredBySnapshot(transaction, held)) {
            continue;
          }
          if (
            recordCrossOriginIframes &&
            (held.event as { data?: { isAttachIframe?: boolean } }).data
              ?.isAttachIframe &&
            scrubUnclaimedIds(held.event, pendingBeforeCommit) === held.event
          ) {
            // the reattach above already re-delivered this iframe's content
            // from the attach cache; emitting the held original would attach
            // it twice
            continue;
          }
          if (scrubUnclaimedIds(held.event, pendingBeforeCommit) !== held.event) {
            // references a node only the commit's add will introduce
            deferred.push(held);
            continue;
          }
          emitHeld(held.event, held.isCheckout, true);
          if (walkSuperseded(transaction)) {
            // the rest of the held window dies with this session; the
            // commit that would make it resolvable will never run
            return;
          }
        }

        // generate & emit any mutations that happened during snapshotting,
        // as they can now apply against the newly built mirror
        const commitOutcome = commitMutationBuffers(transaction.bufferToken);
        droppedMutationRecords += commitOutcome.droppedRecordCount;
        deferredMutationRecords += commitOutcome.deferredRecordCount;
        if (walkSuperseded(transaction)) {
          return;
        }

        if (deferred.length > 0) {
          // The commit just claimed the reserved ids for every node it
          // re-added; ids still pending belong to nodes that also left the
          // DOM mid-walk (their add cancelled) and exist for no one.
          const stillPending = new Set(mirror.getUnclaimedReservedIds());
          for (const held of deferred) {
            if (heldCssomDeltaCoveredBySnapshot(transaction, held)) {
              continue;
            }
            const scrubbed = scrubUnclaimedIds(held.event, stillPending);
            if (scrubbed) {
              // Re-stamped at flush time, deliberately: this event's target
              // came into existence ON THE WIRE with the commit's add, which
              // carries commit time. Keeping the observation timestamp would
              // put the event before its target on the timeline and make the
              // wire non-monotonic. The alternative (stamping mutations at
              // observation time) has no correct answer either — a locked
              // buffer coalesces a whole window into one batch, which has no
              // single observation time. See the changeset's ordering
              // caveats; this is the documented trade of hold-and-deliver.
              emitHeld(scrubbed, held.isCheckout, false);
              if (walkSuperseded(transaction)) {
                return;
              }
            } else {
              droppedHeldEvents++;
            }
          }
        }
      } finally {
        // A consumer throw mid-flush must not leave the buffers locked: the
        // commit is the transaction's release, not an optional step. (A
        // second call after a successful commit is a token-mismatch no-op.)
        // A superseded walk leaves them alone (the rotation released them).
        if (!walkSuperseded(transaction)) {
          const lateOutcome = commitMutationBuffers(transaction.bufferToken);
          droppedMutationRecords += lateOutcome.droppedRecordCount;
          deferredMutationRecords += lateOutcome.deferredRecordCount;
        }
      }
    } catch (flushError) {
      // a consumer throw mid-flush loses that one delivery, nothing else —
      // the commit already ran (finally above) and recording continues.
      // Escaping here would surface as an unhandled rejection on the walk's
      // promise path, or propagate into an unload handler on the sync path.
      reportError(flushError);
      console.warn('Budgeted full snapshot flush failed', flushError);
    } finally {
      if (walkSuperseded(transaction)) {
        // the live reservation is the new session's, mid-walk; ending it
        // would make its events resolve to -1
        abandonSupersededWalk(transaction);
      } else {
        // In the finally so a genuine same-session throw above cannot skip
        // them: canvas frame dedup must reset for every delivered snapshot,
        // and constructed stylesheets must reach the wire or the replay
        // renders unstyled.
        try {
          canvasManager.onFullSnapshot();
        } catch (canvasError) {
          reportError(canvasError);
        }
        if (!walkSuperseded(transaction)) {
          try {
            if (
              document.adoptedStyleSheets &&
              document.adoptedStyleSheets.length > 0
            )
              stylesheetManager.adoptStyleSheets(
                document.adoptedStyleSheets,
                mirror.getId(document),
              );
          } catch (adoptError) {
            reportError(adoptError);
            console.warn('Adopted stylesheet delivery failed', adoptError);
          }
        }
        if (walkSuperseded(transaction)) {
          // a rotation from inside the adopted-sheet delivery: the live
          // reservation is the new session's, stand down
          abandonSupersededWalk(transaction);
        } else {
          mirror.endIdReservation();
          budgetedSnapshotFlushing = false;
          budgetedSnapshotInFlight = false;
          activeBudgetedSnapshot = null;
        }
      }
    }

    // Sheets the walk's stylesheet budget skipped: inline them one idle
    // callback at a time now that the FullSnapshot and its held window are
    // on the wire. A superseded walk must not drain — a rotated-in budgeted
    // walk may already have queued its own links, and they belong to its
    // completion, not this one.
    let deferredStylesheetCount = 0;
    if (!walkSuperseded(transaction)) {
      const deferredStylesheetLinks = takeDeferredStylesheetLinks();
      deferredStylesheetCount = deferredStylesheetLinks.length;
      if (deferredStylesheetLinks.length) {
        cancelDeferredStylesheetInlining = inlineDeferredStylesheets(
          deferredStylesheetLinks,
          stylesheetManager,
          () => {
            // queue drained: drop the handle so the closure and its links
            // can be collected
            cancelDeferredStylesheetInlining = undefined;
          },
        );
      }
    }

    // The success counterpart of the failure diagnostics: without it the
    // longest recorder-caused task a completed walk produced in production
    // is not computable, only inferable from the absence of failures.
    // Emitted after the flush released all transaction state, so it rides
    // the wire immediately rather than through any held window.
    if (!walkSuperseded(transaction)) {
      const stats = transaction.controller?.getStats();
      emitBudgetedSnapshotDiagnostic('completed', {
        isRetry: transaction.isRetry,
        walkMs: nowTimestamp() - transaction.startedAt,
        sliceCount: stats?.sliceCount ?? 0,
        slowestSliceMs: Math.ceil(stats?.longestSliceMs ?? 0),
        heldEventHighWater: transaction.heldEventHighWater,
        carriedHeldEventCount: transaction.carriedHeldEventCount,
        droppedMutationRecords,
        deferredMutationRecords,
        droppedHeldEventCount: droppedHeldEvents,
        failedHeldEventDeliveries,
        deferredStylesheets: deferredStylesheetCount,
      });
      // the diagnostic went through the consumer; a rotation from it owns
      // the recorder now, including the coalesced follow-up
      if (walkSuperseded(transaction)) {
        return;
      }
    }

    if (
      !walkSuperseded(transaction) &&
      (droppedMutationRecords > 0 ||
        deferredMutationRecords > 0 ||
        droppedHeldEvents > 0 ||
        failedHeldEventDeliveries > 0)
    ) {
      emitBudgetedSnapshotDiagnostic('mutation-commit-incomplete', {
        droppedMutationRecords,
        deferredMutationRecords,
        droppedHeldEventCount: droppedHeldEvents,
        failedHeldEventDeliveries,
      });
      // the diagnostic went through the consumer; a rotation from it owns
      // the recorder now, including the coalesced follow-up
      if (walkSuperseded(transaction)) {
        return;
      }
    }

    // abandonSupersededWalk above cleared the coalesced follow-up too: it
    // would have started a walk in the new session's world.
    const pending = budgetedSnapshotQueued;
    budgetedSnapshotQueued = null;
    if (pending) {
      try {
        takeFullSnapshotBudgeted(pending.isCheckout);
      } catch (followUpError) {
        reportError(followUpError);
        console.warn(
          'Coalesced follow-up full snapshot failed',
          followUpError,
        );
      }
    }
  };

  // Time-sliced variant: same phases as the synchronous path below, but the
  // serialization yields to the event loop on the configured budget so a large
  // document doesn't block the page in one long task. Because the walk spans
  // several tasks, the page keeps running during it, and four things have to
  // hold for the recording to stay correct:
  //  - every mutation buffer stays locked for the whole walk, including buffers
  //    created *during* it (the document's own, plus shadow-root and iframe
  //    buffers spawned by the traversal) — hence lockMutationBuffers rather
  //    than a loop over the ones that happen to exist right now;
  //  - ids are reserved on demand, so an event observed before its node has
  //    been reached still resolves to the id that node is about to get;
  //  - nodes the locked buffers will re-add at commit (added or moved during
  //    the walk) are skipped by the walk itself — the buffer is their single
  //    source of truth, carrying their live position and final state;
  //  - non-mutation events observed in the meantime are held and delivered
  //    after the FullSnapshot, each keeping its observation timestamp, except
  //    an allowlist of order-independent control events that bypass the hold
  //    (see sessionEmit and completeBudgetedWalk). NOTE the ordering caveats:
  //    mutations deliver at commit time after every held event, and a held
  //    event referencing a node only the commit introduces is deferred past
  //    the commit and re-stamped. The wire is timestamp-monotonic but not
  //    observation-ordered across those classes.
  const takeFullSnapshotBudgeted = (
    isCheckout: boolean,
    isRetry = false,
    // Held events an aborted walk preserved for its retry (see the failure
    // branch of completeBudgetedWalk). Seeded into this walk's queue so the
    // normal flush machinery orders, scrubs and delivers them after the
    // FullSnapshot. Only the retry passes these; the in-flight coalesce
    // above can never swallow them because the failure branch clears the
    // in-flight gate before calling back in.
    carriedHeldEvents: HeldEvent[] = [],
  ) => {
    if (budgetedSnapshotInFlight) {
      // coalesce concurrent requests into a single follow-up snapshot
      budgetedSnapshotQueued = {
        isCheckout: (budgetedSnapshotQueued?.isCheckout ?? false) || isCheckout,
      };
      return;
    }
    let carriedHeldEventBytes = 0;
    for (const held of carriedHeldEvents) {
      carriedHeldEventBytes += estimateRetainedSize(
        held.event,
        MAX_HELD_EVENT_BYTES,
      );
    }
    const transaction: BudgetedSnapshotTransaction = {
      bufferToken: createMutationBufferLockToken(),
      generation: recordingGeneration,
      startedAt: nowTimestamp(),
      isCheckout,
      isRetry,
      didEmitFullSnapshot: false,
      completed: false,
      controller: null,
      error: null,
      abortRequested: false,
      abortReason: null,
      heldEventBytes: carriedHeldEventBytes,
      eventQueue: carriedHeldEvents.slice(),
      heldEventHighWater: carriedHeldEvents.length,
      carriedHeldEventCount: carriedHeldEvents.length,
      serializedCount: 0,
      styleTargets: new Map(),
      overflow: null,
      droppedAfterAbort: 0,
      draining: false,
    };
    // Meta is emitted before any transaction state is committed: the
    // consumer's emit is outside our control, and a throw from it must leave
    // the recorder able to snapshot again — not latched in-flight with no
    // promise chain to recover. It carries the walk's start time so it stays
    // ahead of the backdated FullSnapshot on the wire.
    emitMetaEvent(isCheckout, transaction.startedAt);
    // A rotation from the consumer's Meta handling owns the buffers and the
    // mirror now; locking them or starting a reservation here would collide
    // with the new session's own snapshot.
    if (walkSuperseded(transaction)) {
      return;
    }

    // Any deferred inlining from the previous snapshot targets mirror ids
    // this walk is about to replace, so drop it rather than emitting stale
    // mutations.
    cancelDeferredStylesheetInlining?.();
    cancelDeferredStylesheetInlining = undefined;

    // When we take a full snapshot, old tracked StyleSheets need to be removed.
    stylesheetManager.reset();
    shadowDomManager.init();
    // On a checkout, init() just disconnected every shadow root's observers,
    // and the walker only re-arms each root when it reaches its host — on a
    // sliced walk that is a seconds-long blind window for shadow scrolls and
    // mutations. Re-arm known roots now; their buffers are born before the
    // lock below, so they join the held window like any others. (The
    // synchronous path has no window: nothing runs during its snapshot.)
    shadowDomManager.reobserveKnownRoots(document);

    budgetedSnapshotInFlight = true;
    activeBudgetedSnapshot = transaction;
    try {
      // Armed synchronously, before the first yield can happen, so that no
      // buffer can be created unlocked while the walk is in flight.
      if (!lockMutationBuffers(transaction.bufferToken)) {
        throw new Error('A different full snapshot owns the mutation buffers');
      }
      mirror.beginIdReservation(genId);
    } catch (error) {
      budgetedSnapshotInFlight = false;
      activeBudgetedSnapshot = null;
      throw error;
    }
    void snapshotWithBudget(document, {
      ...buildFullSnapshotOptions(),
      yieldBudgetMs: fullSnapshotYieldBudgetMs,
      maxWalkWallClockMs: MAX_WALK_WALL_CLOCK_MS,
      shouldSkipNode: anyMutationBufferHasPendingAdd,
      onController: (controller) => {
        transaction.controller = controller;
      },
      // `mirror` is shared across recording sessions, so a walk whose recording
      // has been torn down has to stop writing to it, not just be ignored.
      // The buffer backlog is checked here too — mutations never pass through
      // the held-event queue, so its caps can't see them.
      shouldAbort: () => {
        if (
          transaction.generation !== recordingGeneration ||
          transaction.abortRequested
        ) {
          return true;
        }
        if (transaction.draining) {
          return false;
        }
        let backlog = 0;
        for (const buffer of mutationBuffers) {
          backlog += buffer.pendingRecordCount();
        }
        // canvas commands accumulate behind the same lock as mutation
        // records and are just as unsplittable at commit time
        backlog += canvasManager.pendingMutationCount();
        if (backlog > MAX_LOCKED_BUFFER_RECORDS) {
          transaction.abortRequested = true;
          transaction.abortReason = 'mutation-backlog';
          transaction.error = new Error(
            'Budgeted full snapshot mutation backlog exceeded its safety limit',
          );
          return true;
        }
        return false;
      },
    }).then(
      (node) => completeBudgetedWalk(transaction, node),
      (error: unknown) => {
        transaction.error = error;
        if (
          error instanceof Error &&
          error.message.includes(WATCHDOG_MESSAGE)
        ) {
          transaction.abortReason = 'watchdog-timeout';
        }
        reportError(error);
        console.warn('Budgeted full snapshot failed', error);
        completeBudgetedWalk(transaction, null);
      },
    );
  };

  const sessionTakeFullSnapshot = (isCheckout = false) => {
    if (!recordDOM) {
      // No FullSnapshot will ever land, so stamp the checkout clock here or
      // exceedTime would either never arm or re-request this no-op snapshot
      // on every subsequent event.
      lastFullSnapshotWallTime = nowTimestamp();
      return true;
    }
    if (fullSnapshotYieldBudgetMs > 0) {
      takeFullSnapshotBudgeted(isCheckout);
      return true;
    }
    return takeFullSnapshotSynchronous(isCheckout);
  };
  takeFullSnapshot = sessionTakeFullSnapshot;

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
            sessionEmit({
              type: EventType.IncrementalSnapshot,
              data: {
                source,
                positions,
              },
            }),
          mouseInteractionCb: (d) =>
            sessionEmit({
              type: EventType.IncrementalSnapshot,
              data: {
                source: IncrementalSource.MouseInteraction,
                ...d,
              },
            }),
          scrollCb: wrappedScrollEmit,
          viewportResizeCb: (d) =>
            sessionEmit({
              type: EventType.IncrementalSnapshot,
              data: {
                source: IncrementalSource.ViewportResize,
                ...d,
              },
            }),
          inputCb: (v) =>
            sessionEmit({
              type: EventType.IncrementalSnapshot,
              data: {
                source: IncrementalSource.Input,
                ...v,
              },
            }),
          mediaInteractionCb: (p) =>
            sessionEmit({
              type: EventType.IncrementalSnapshot,
              data: {
                source: IncrementalSource.MediaInteraction,
                ...p,
              },
            }),
          styleSheetRuleCb: (r) =>
            sessionEmit({
              type: EventType.IncrementalSnapshot,
              data: {
                source: IncrementalSource.StyleSheetRule,
                ...r,
              },
            }),
          styleDeclarationCb: (r) =>
            sessionEmit({
              type: EventType.IncrementalSnapshot,
              data: {
                source: IncrementalSource.StyleDeclaration,
                ...r,
              },
            }),
          canvasMutationCb: wrappedCanvasMutationEmit,
          fontCb: (p) =>
            sessionEmit({
              type: EventType.IncrementalSnapshot,
              data: {
                source: IncrementalSource.Font,
                ...p,
              },
            }),
          selectionCb: (p) => {
            sessionEmit({
              type: EventType.IncrementalSnapshot,
              data: {
                source: IncrementalSource.Selection,
                ...p,
              },
            });
          },
          customElementCb: (c) => {
            sessionEmit({
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
          maskAllElementAttributes,
          maskAttributeFn,
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
          onStylesheetTextSerialized,
          plugins:
            plugins
              ?.filter((p) => p.observer)
              ?.map((p) => ({
                observer: p.observer!,
                options: p.options,
                callback: (payload: object) =>
                  sessionEmit({
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
      sessionEmit({
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
      // An observer callback queued before teardown can still drain through
      // sessionEmit; a stale in-flight gate with no transaction behind it
      // would swallow whatever it delivers, silently.
      budgetedSnapshotInFlight = false;
      budgetedSnapshotFlushing = false;
      cancelDeferredStylesheetInlining?.();
      cancelDeferredStylesheetInlining = undefined;
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

    // A walk in flight when the page unloads must not die parked on a yield
    // that will never fire: finish it synchronously so the FullSnapshot and
    // the held window flush in this task and the SDK's own unload flush can
    // still send them. If the walk already aborted (overflow, backlog,
    // watchdog, a throw inside the drain itself), a Meta is on the wire with
    // nothing behind it and no retry can finish on a dying page; attempt
    // the synchronous fallback snapshot instead (completeBudgetedWalk routes
    // there because `draining` is set); a stall no longer matters on a page
    // that is going away.
    const completeWalkBeforePageHides = () => {
      const transaction = activeBudgetedSnapshot;
      if (!transaction || transaction.completed || !transaction.controller) {
        return;
      }
      transaction.draining = true;
      const node = transaction.controller.flushSync();
      completeBudgetedWalk(transaction, node);
    };

    const init = () => {
      const generation = recordingGeneration;
      // A failed initial snapshot (null node, lock conflict) must not leave a
      // half-started recorder that claims to be running: observers still
      // install, restoring the pre-budget behavior, so a later checkout or
      // the periodic full snapshot can recover. A throw still propagates so
      // record() returns undefined and the SDK's own retry logic trips.
      sessionTakeFullSnapshot();
      if (generation !== recordingGeneration) {
        // a rotation from inside the snapshot's emits owns the recorder now
        return;
      }
      handlers.push(observe(document));
      if (fullSnapshotYieldBudgetMs > 0) {
        // pagehide only, deliberately NOT visibilitychange→hidden: an
        // ordinary tab switch mid-walk must not drain the rest of a large
        // document in one synchronous task (the very stall budgeted mode
        // exists to avoid) when the user may be back in 300ms. A hidden
        // walk keeps slicing (MessageChannel yields are not background
        // throttled) with the wall-clock watchdog as backstop; only a page
        // that is truly going away gets the synchronous drain. pagehide
        // fires on window, not document.
        handlers.push(on('pagehide', completeWalkBeforePageHides, window));
      }
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
          sessionEmit({
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
            sessionEmit({
              type: EventType.Load,
              data: {},
            });
            if (recordAfter === 'load') init();
          },
          window,
        ),
      );
    }
    return stopRecording;
  } catch (error) {
    // A walk started by init() before the failure would otherwise keep
    // running against a recording that never finished setting up.
    recordingGeneration++;
    // The superseded walk stands down without touching the shared mirror,
    // and no rotation follows to reset it: the reservation the walk opened
    // must end here or the mirror reserves ids for the life of the page.
    mirror.endIdReservation();
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
