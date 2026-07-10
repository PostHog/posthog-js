import type { Mirror } from '@posthog/rrweb-snapshot';
import { genId } from '@posthog/rrweb-snapshot';
import type { CrossOriginIframeMessageEvent } from '../types';
import { callSafely, removeEventListenerSafely } from '../utils';
import CrossOriginIframeMirror from './cross-origin-iframe-mirror';
import { findAndRemoveIframeBuffer } from './observer';
import { EventType, NodeType, IncrementalSource } from '@posthog/rrweb-types';
import type {
  eventWithTime,
  eventWithoutTime,
  serializedNodeWithId,
  mutationCallBack,
} from '@posthog/rrweb-types';
import type { StylesheetManager } from './stylesheet-manager';

export class IframeManager {
  private iframes: WeakMap<HTMLIFrameElement, true> = new WeakMap();
  private crossOriginIframeMap: WeakMap<MessageEventSource, HTMLIFrameElement> =
    new WeakMap();
  public crossOriginIframeMirror = new CrossOriginIframeMirror(genId);
  public crossOriginIframeStyleMirror: CrossOriginIframeMirror;
  public crossOriginIframeRootIdMap: WeakMap<HTMLIFrameElement, number> =
    new WeakMap();
  private mirror: Mirror;
  private mutationCb: mutationCallBack;
  private wrappedEmit: (e: eventWithoutTime, isCheckout?: boolean) => void;
  private loadListener?: (iframeEl: HTMLIFrameElement) => unknown;
  private pageHideListener?: (iframeEl: HTMLIFrameElement) => unknown;
  private stylesheetManager: StylesheetManager;
  private recordCrossOriginIframes: boolean;
  private messageHandler: (message: MessageEvent) => void;
  // Strong Map — keys pin Windows; every entry must be deleted on detach.
  private nestedIframeListeners: Map<Window, (message: MessageEvent) => void> =
    new Map();
  // Originals captured per iframe so cleanup survives iframe.src swaps.
  private attachedWindows: WeakMap<HTMLIFrameElement, Set<Window>> =
    new WeakMap();
  private attachedDocuments: WeakMap<HTMLIFrameElement, Set<Document>> =
    new WeakMap();
  private attachedIframes: Map<
    number,
    { element: HTMLIFrameElement; content: serializedNodeWithId }
  > = new Map();
  // Set per element — one iframe collects multiple disposers across loads.
  private loadListenerDisposers: WeakMap<HTMLIFrameElement, Set<() => void>> =
    new WeakMap();
  // Fallback for iframes removed before first load — mirror entry is gone
  // by then, but we still need the element to dispose its load listener.
  private iframeElementsById: Map<number, HTMLIFrameElement> = new Map();
  // Set per element — same multi-load reasoning as loadListenerDisposers.
  private pageHideHandlers: WeakMap<
    HTMLIFrameElement,
    Set<{ win: Window; handler: () => void }>
  > = new WeakMap();

  constructor(options: {
    mirror: Mirror;
    mutationCb: mutationCallBack;
    stylesheetManager: StylesheetManager;
    recordCrossOriginIframes: boolean;
    wrappedEmit: (e: eventWithoutTime, isCheckout?: boolean) => void;
  }) {
    this.mutationCb = options.mutationCb;
    this.wrappedEmit = options.wrappedEmit;
    this.stylesheetManager = options.stylesheetManager;
    this.recordCrossOriginIframes = options.recordCrossOriginIframes;
    this.crossOriginIframeStyleMirror = new CrossOriginIframeMirror(
      this.stylesheetManager.styleMirror.generateId.bind(
        this.stylesheetManager.styleMirror,
      ),
    );
    this.mirror = options.mirror;
    this.messageHandler = this.handleMessage.bind(this);
    if (this.recordCrossOriginIframes) {
      window.addEventListener('message', this.messageHandler);
    }
  }

  public addIframe(iframeEl: HTMLIFrameElement) {
    this.iframes.set(iframeEl, true);
    if (iframeEl.contentWindow)
      this.crossOriginIframeMap.set(iframeEl.contentWindow, iframeEl);
  }

  public registerLoadListenerDisposer(
    iframeEl: HTMLIFrameElement,
    disposer: () => void,
  ) {
    let bucket = this.loadListenerDisposers.get(iframeEl);
    if (!bucket) {
      bucket = new Set();
      this.loadListenerDisposers.set(iframeEl, bucket);
    }
    bucket.add(disposer);
    const id = this.mirror.getId(iframeEl);
    if (id !== -1) this.iframeElementsById.set(id, iframeEl);
  }

  // Used by the record-loop to distinguish reparenting from removal.
  public getIframeElementById(iframeId: number): HTMLIFrameElement | null {
    return (
      this.attachedIframes.get(iframeId)?.element ??
      this.iframeElementsById.get(iframeId) ??
      null
    );
  }

  // Drops the id mapping for a moved iframe; element-keyed state survives.
  public forgetIframeId(iframeId: number) {
    this.attachedIframes.delete(iframeId);
    this.iframeElementsById.delete(iframeId);
  }

  private disposeLoadListeners(iframeEl: HTMLIFrameElement) {
    const bucket = this.loadListenerDisposers.get(iframeEl);
    if (!bucket) return;
    bucket.forEach((d) => callSafely(d));
    this.loadListenerDisposers.delete(iframeEl);
  }

  private removePageHideListener(iframeEl: HTMLIFrameElement) {
    const bucket = this.pageHideHandlers.get(iframeEl);
    if (!bucket) return;
    bucket.forEach(({ win, handler }) => {
      removeEventListenerSafely(win, 'pagehide', handler);
    });
    this.pageHideHandlers.delete(iframeEl);
  }

  public addLoadListener(cb: (iframeEl: HTMLIFrameElement) => unknown) {
    this.loadListener = cb;
  }

  public addPageHideListener(cb: (iframeEl: HTMLIFrameElement) => unknown) {
    this.pageHideListener = cb;
  }

  public removeLoadListener() {
    this.loadListener = undefined;
  }

  private trackIframeContent(
    iframeEl: HTMLIFrameElement,
    content: serializedNodeWithId,
  ): number {
    const iframeId = this.mirror.getId(iframeEl);
    this.attachedIframes.set(iframeId, { element: iframeEl, content });
    return iframeId;
  }

  public attachIframe(
    iframeEl: HTMLIFrameElement,
    childSn: serializedNodeWithId,
  ) {
    const iframeId = this.trackIframeContent(iframeEl, childSn);
    // Accumulate every contentDocument across loads (blank → src → blank).
    if (iframeEl.contentDocument) {
      let docs = this.attachedDocuments.get(iframeEl);
      if (!docs) {
        docs = new Set();
        this.attachedDocuments.set(iframeEl, docs);
      }
      docs.add(iframeEl.contentDocument);
    }
    this.mutationCb({
      adds: [
        {
          parentId: iframeId,
          nextId: null,
          node: childSn,
        },
      ],
      removes: [],
      texts: [],
      attributes: [],
      isAttachIframe: true,
    });

    // Receive messages (events) coming from cross-origin iframes that are nested in this same-origin iframe.
    const win = iframeEl.contentWindow;
    if (
      this.recordCrossOriginIframes &&
      win &&
      !this.nestedIframeListeners.has(win)
    ) {
      const nestedHandler = this.handleMessage.bind(this);
      callSafely(() => {
        win.addEventListener('message', nestedHandler);
        this.nestedIframeListeners.set(win, nestedHandler);
        // Track per-iframe so detach finds it even after a contentWindow swap.
        let wins = this.attachedWindows.get(iframeEl);
        if (!wins) {
          wins = new Set();
          this.attachedWindows.set(iframeEl, wins);
        }
        wins.add(win);
      });
    }

    callSafely(() => {
      const pageHideWindow = iframeEl.contentWindow;
      if (!pageHideWindow) return;
      let bucket = this.pageHideHandlers.get(iframeEl);
      // Reparented / re-attached iframes call attachIframe again on the same
      // Window; skip if we already registered a handler for it.
      if (bucket) {
        for (const entry of bucket) {
          if (entry.win === pageHideWindow) return;
        }
      }
      const handler = () => {
        this.pageHideListener?.(iframeEl);
        if (iframeEl.contentDocument) {
          this.mirror.removeNodeFromMap(iframeEl.contentDocument);
        }
        if (iframeEl.contentWindow) {
          this.crossOriginIframeMap.delete(iframeEl.contentWindow);
        }
      };
      pageHideWindow.addEventListener('pagehide', handler);
      if (!bucket) {
        bucket = new Set();
        this.pageHideHandlers.set(iframeEl, bucket);
      }
      bucket.add({ win: pageHideWindow, handler });
    });

    this.loadListener?.(iframeEl);

    if (
      iframeEl.contentDocument &&
      iframeEl.contentDocument.adoptedStyleSheets &&
      iframeEl.contentDocument.adoptedStyleSheets.length > 0
    )
      this.stylesheetManager.adoptStyleSheets(
        iframeEl.contentDocument.adoptedStyleSheets,
        this.mirror.getId(iframeEl.contentDocument),
      );
  }
  private handleMessage(message: MessageEvent | CrossOriginIframeMessageEvent) {
    const crossOriginMessageEvent = message as CrossOriginIframeMessageEvent;
    if (
      crossOriginMessageEvent.data.type !== 'rrweb' ||
      // To filter out the rrweb messages which are forwarded by some sites.
      crossOriginMessageEvent.origin !== crossOriginMessageEvent.data.origin
    )
      return;

    const iframeSourceWindow = message.source;
    if (!iframeSourceWindow) return;

    const iframeEl = this.crossOriginIframeMap.get(message.source);
    if (!iframeEl) return;

    const transformedEvent = this.transformCrossOriginEvent(
      iframeEl,
      crossOriginMessageEvent.data.event,
    );

    if (transformedEvent)
      this.wrappedEmit(
        transformedEvent,
        crossOriginMessageEvent.data.isCheckout,
      );
  }

  private transformCrossOriginEvent(
    iframeEl: HTMLIFrameElement,
    e: eventWithTime,
  ): eventWithTime | false {
    switch (e.type) {
      case EventType.FullSnapshot: {
        this.crossOriginIframeMirror.reset(iframeEl);
        this.crossOriginIframeStyleMirror.reset(iframeEl);
        /**
         * Replaces the original id of the iframe with a new set of unique ids
         */
        this.replaceIdOnNode(e.data.node, iframeEl);
        const rootId = e.data.node.id;
        this.crossOriginIframeRootIdMap.set(iframeEl, rootId);
        this.patchRootIdOnNode(e.data.node, rootId);
        this.trackIframeContent(iframeEl, e.data.node);
        return {
          timestamp: e.timestamp,
          type: EventType.IncrementalSnapshot,
          data: {
            source: IncrementalSource.Mutation,
            adds: [
              {
                parentId: this.mirror.getId(iframeEl),
                nextId: null,
                node: e.data.node,
              },
            ],
            removes: [],
            texts: [],
            attributes: [],
            isAttachIframe: true,
          },
        };
      }
      case EventType.Meta:
      case EventType.Load:
      case EventType.DomContentLoaded: {
        return false;
      }
      case EventType.Plugin: {
        return e;
      }
      case EventType.Custom: {
        this.replaceIds(
          e.data.payload as {
            id?: unknown;
            parentId?: unknown;
            previousId?: unknown;
            nextId?: unknown;
          },
          iframeEl,
          ['id', 'parentId', 'previousId', 'nextId'],
        );
        return e;
      }
      case EventType.IncrementalSnapshot: {
        switch (e.data.source) {
          case IncrementalSource.Mutation: {
            e.data.adds.forEach((n) => {
              this.replaceIds(n, iframeEl, [
                'parentId',
                'nextId',
                'previousId',
              ]);
              this.replaceIdOnNode(n.node, iframeEl);
              const rootId = this.crossOriginIframeRootIdMap.get(iframeEl);
              rootId && this.patchRootIdOnNode(n.node, rootId);
            });
            e.data.removes.forEach((n) => {
              this.replaceIds(n, iframeEl, ['parentId', 'id']);
            });
            e.data.attributes.forEach((n) => {
              this.replaceIds(n, iframeEl, ['id']);
            });
            e.data.texts.forEach((n) => {
              this.replaceIds(n, iframeEl, ['id']);
            });
            return e;
          }
          case IncrementalSource.Drag:
          case IncrementalSource.TouchMove:
          case IncrementalSource.MouseMove: {
            e.data.positions.forEach((p) => {
              this.replaceIds(p, iframeEl, ['id']);
            });
            return e;
          }
          case IncrementalSource.ViewportResize: {
            // can safely ignore these events
            return false;
          }
          case IncrementalSource.MediaInteraction:
          case IncrementalSource.MouseInteraction:
          case IncrementalSource.Scroll:
          case IncrementalSource.CanvasMutation:
          case IncrementalSource.Input: {
            this.replaceIds(e.data, iframeEl, ['id']);
            return e;
          }
          case IncrementalSource.StyleSheetRule:
          case IncrementalSource.StyleDeclaration: {
            this.replaceIds(e.data, iframeEl, ['id']);
            this.replaceStyleIds(e.data, iframeEl, ['styleId']);
            return e;
          }
          case IncrementalSource.Font: {
            // fine as-is no modification needed
            return e;
          }
          case IncrementalSource.Selection: {
            e.data.ranges.forEach((range) => {
              this.replaceIds(range, iframeEl, ['start', 'end']);
            });
            return e;
          }
          case IncrementalSource.AdoptedStyleSheet: {
            this.replaceIds(e.data, iframeEl, ['id']);
            this.replaceStyleIds(e.data, iframeEl, ['styleIds']);
            e.data.styles?.forEach((style) => {
              this.replaceStyleIds(style, iframeEl, ['styleId']);
            });
            return e;
          }
        }
      }
    }
    return false;
  }

  private replace<T extends Record<string, unknown>>(
    iframeMirror: CrossOriginIframeMirror,
    obj: T,
    iframeEl: HTMLIFrameElement,
    keys: Array<keyof T>,
  ): T {
    for (const key of keys) {
      if (!Array.isArray(obj[key]) && typeof obj[key] !== 'number') continue;
      if (Array.isArray(obj[key])) {
        obj[key] = iframeMirror.getIds(
          iframeEl,
          obj[key] as number[],
        ) as T[keyof T];
      } else {
        (obj[key] as number) = iframeMirror.getId(iframeEl, obj[key] as number);
      }
    }

    return obj;
  }

  private replaceIds<T extends Record<string, unknown>>(
    obj: T,
    iframeEl: HTMLIFrameElement,
    keys: Array<keyof T>,
  ): T {
    return this.replace(this.crossOriginIframeMirror, obj, iframeEl, keys);
  }

  private replaceStyleIds<T extends Record<string, unknown>>(
    obj: T,
    iframeEl: HTMLIFrameElement,
    keys: Array<keyof T>,
  ): T {
    return this.replace(this.crossOriginIframeStyleMirror, obj, iframeEl, keys);
  }

  private replaceIdOnNode(
    node: serializedNodeWithId,
    iframeEl: HTMLIFrameElement,
  ) {
    this.replaceIds(node, iframeEl, ['id', 'rootId']);
    if ('childNodes' in node) {
      node.childNodes.forEach((child) => {
        this.replaceIdOnNode(child, iframeEl);
      });
    }
  }

  private patchRootIdOnNode(node: serializedNodeWithId, rootId: number) {
    if (node.type !== NodeType.Document && !node.rootId) node.rootId = rootId;
    if ('childNodes' in node) {
      node.childNodes.forEach((child) => {
        this.patchRootIdOnNode(child, rootId);
      });
    }
  }

  public removeIframeById(iframeId: number) {
    const entry = this.attachedIframes.get(iframeId);
    // attachedIframes / mirror may both be empty for iframes removed
    // before first load; iframeElementsById covers that case.
    const iframe =
      entry?.element ||
      this.iframeElementsById.get(iframeId) ||
      (this.mirror.getNode(iframeId) as HTMLIFrameElement | null);

    this.iframeElementsById.delete(iframeId);

    if (iframe) {
      const win = iframe.contentWindow;

      // Clear listeners for every Window this iframe ever held — host
      // may have swapped iframe.src before removal.
      const capturedWins = this.attachedWindows.get(iframe);
      if (capturedWins) {
        capturedWins.forEach((capturedWin) => {
          const handler = this.nestedIframeListeners.get(capturedWin);
          if (handler) {
            removeEventListenerSafely(capturedWin, 'message', handler);
            this.nestedIframeListeners.delete(capturedWin);
          }
          this.crossOriginIframeMap.delete(capturedWin);
        });
        this.attachedWindows.delete(iframe);
      }
      // Legacy/test path: nestedIframeListeners populated without
      // attachIframe (preserves SecurityError handling from #163).
      if (win && this.nestedIframeListeners.has(win)) {
        const handler = this.nestedIframeListeners.get(win)!;
        removeEventListenerSafely(win, 'message', handler);
        this.nestedIframeListeners.delete(win);
      }

      if (win) {
        this.crossOriginIframeMap.delete(win);
      }
      this.iframes.delete(iframe);

      this.disposeLoadListeners(iframe);
      this.removePageHideListener(iframe);

      // Walk captured docs so mirror.idNodeMap drops them even after
      // an iframe.src swap, then splice their MutationBuffers.
      const capturedDocs = this.attachedDocuments.get(iframe);
      if (capturedDocs) {
        capturedDocs.forEach((doc) => {
          callSafely(() => this.mirror.removeNodeFromMap(doc));
        });
        callSafely(() => findAndRemoveIframeBuffer(iframe, capturedDocs));
        this.attachedDocuments.delete(iframe);
      }
    }

    if (entry) {
      this.attachedIframes.delete(iframeId);
    }
  }

  // Catches iframes removed inside a removed subtree (only the
  // ancestor's id appears in m.removes).
  public cleanupDetachedIframes() {
    if (this.attachedIframes.size === 0) return;
    const orphaned: number[] = [];
    this.attachedIframes.forEach((_entry, iframeId) => {
      if (!this.mirror.has(iframeId)) {
        orphaned.push(iframeId);
      }
    });
    orphaned.forEach((iframeId) => this.removeIframeById(iframeId));
  }

  public reattachIframes() {
    this.attachedIframes.forEach(({ content }, iframeId) => {
      // Verify the iframe ID is still in the mirror (still being tracked by rrweb)
      // If removed, the mirror would have been cleaned up via removeNodeFromMap()
      if (!this.mirror.has(iframeId)) {
        this.attachedIframes.delete(iframeId);
        return;
      }

      this.mutationCb({
        adds: [
          {
            parentId: iframeId,
            nextId: null,
            node: content,
          },
        ],
        removes: [],
        texts: [],
        attributes: [],
        isAttachIframe: true,
      });
    });
  }

  public destroy() {
    if (this.recordCrossOriginIframes) {
      removeEventListenerSafely(window, 'message', this.messageHandler);
    }

    // Clean up nested iframe listeners
    this.nestedIframeListeners.forEach((handler, contentWindow) => {
      removeEventListenerSafely(contentWindow, 'message', handler);
    });
    this.nestedIframeListeners.clear();

    // WeakMaps aren't iterable, so enumerate tracked iframes via the
    // id-keyed Maps and dispose pending load listeners + pagehide
    // handlers before dropping the WeakMaps. Otherwise stopRecording()
    // would leave DOM listeners + onceIframeLoaded timers live, allowing
    // a late iframe load to call wrappedEmit after recording stopped.
    const tracked = new Set<HTMLIFrameElement>();
    this.iframeElementsById.forEach((el) => tracked.add(el));
    this.attachedIframes.forEach(({ element }) => tracked.add(element));
    tracked.forEach((iframe) => {
      this.disposeLoadListeners(iframe);
      this.removePageHideListener(iframe);
    });

    this.crossOriginIframeMirror.reset();
    this.crossOriginIframeStyleMirror.reset();
    this.attachedIframes.clear();

    this.crossOriginIframeMap = new WeakMap();
    this.iframes = new WeakMap();
    this.crossOriginIframeRootIdMap = new WeakMap();
    this.loadListenerDisposers = new WeakMap();
    this.pageHideHandlers = new WeakMap();
    this.attachedDocuments = new WeakMap();
    this.attachedWindows = new WeakMap();
    this.iframeElementsById = new Map();
  }
}
