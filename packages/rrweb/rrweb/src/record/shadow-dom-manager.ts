import type { MutationBufferParam } from '../types';
import type {
  listenerHandler,
  mutationCallBack,
  scrollCallback,
  SamplingStrategy,
} from '@posthog/rrweb-types';
import {
  initMutationObserver,
  initScrollObserver,
  initAdoptedStyleSheetObserver,
  mutationBuffers,
} from './observer';
import { callSafely, inDom } from '../utils';
import type { Mirror } from '@posthog/rrweb-snapshot';
import { isNativeShadowDom } from '@posthog/rrweb-snapshot';
import dom, { patch } from '@posthog/rrweb-utils';

type BypassOptions = Omit<
  MutationBufferParam,
  'doc' | 'mutationCb' | 'mirror' | 'shadowDomManager'
> & {
  sampling: SamplingStrategy;
};

type ObservedShadowRoot = { doc: Document; handlers: listenerHandler[] };

export class ShadowDomManager {
  // Strong refs, so each root's entry must be dropped when its host is removed.
  private shadowDoms = new Map<ShadowRoot, ObservedShadowRoot>();
  private mutationCb: mutationCallBack;
  private scrollCb: scrollCallback;
  private bypassOptions: BypassOptions;
  private mirror: Mirror;
  // attachShadow patches, tagged with the document they patch so a single
  // iframe can be torn down without disconnecting the rest of the page.
  private restoreHandlers: { doc: Document; handler: () => void }[] = [];

  constructor(options: {
    mutationCb: mutationCallBack;
    scrollCb: scrollCallback;
    bypassOptions: BypassOptions;
    mirror: Mirror;
  }) {
    this.mutationCb = options.mutationCb;
    this.scrollCb = options.scrollCb;
    this.bypassOptions = options.bypassOptions;
    this.mirror = options.mirror;

    this.init();
  }

  public init(): void {
    this.reset();
    // Patch 'attachShadow' to observe newly added shadow doms.
    this.patchAttachShadow(Element, document);
  }

  public addShadowRoot(shadowRoot: ShadowRoot, doc: Document): void {
    if (!isNativeShadowDom(shadowRoot)) return;
    if (this.shadowDoms.has(shadowRoot)) return;
    // Derive the owning document from the host so a shadow root nested in an
    // iframe is keyed to that iframe's document, not whatever the caller passed
    // (takeFullSnapshot's onSerialize hands us the top-level document).
    const ownerDoc = dom.host(shadowRoot)?.ownerDocument ?? doc;
    const observed: ObservedShadowRoot = { doc: ownerDoc, handlers: [] };
    this.shadowDoms.set(shadowRoot, observed);
    const { observer, buffer } = initMutationObserver(
      {
        ...this.bypassOptions,
        doc: ownerDoc,
        mutationCb: this.mutationCb,
        mirror: this.mirror,
        shadowDomManager: this,
      },
      shadowRoot,
    );
    observed.handlers.push(() => {
      observer.disconnect();
      buffer.destroy();
      // Release the canvas directly, not via buffer.reset(), per the recursion-guard unit test.
      buffer.releaseCanvasManager();
      const index = mutationBuffers.indexOf(buffer);
      if (index !== -1) {
        mutationBuffers.splice(index, 1);
      }
    });
    observed.handlers.push(
      initScrollObserver({
        ...this.bypassOptions,
        scrollCb: this.scrollCb,
        // https://gist.github.com/praveenpuglia/0832da687ed5a5d7a0907046c9ef1813
        // scroll is not allowed to pass the boundary, so we need to listen the shadow document
        doc: shadowRoot as unknown as Document,
        mirror: this.mirror,
      }),
    );
    // Defer this to avoid adoptedStyleSheet events being created before the full snapshot is created or attachShadow action is recorded.
    setTimeout(() => {
      // The root was released, or the manager reset, in the meantime.
      if (this.shadowDoms.get(shadowRoot) !== observed) return;
      if (
        shadowRoot.adoptedStyleSheets &&
        shadowRoot.adoptedStyleSheets.length > 0
      )
        this.bypassOptions.stylesheetManager.adoptStyleSheets(
          shadowRoot.adoptedStyleSheets,
          this.mirror.getId(dom.host(shadowRoot)),
        );
      observed.handlers.push(
        initAdoptedStyleSheetObserver(
          {
            mirror: this.mirror,
            stylesheetManager: this.bypassOptions.stylesheetManager,
          },
          shadowRoot,
        ),
      );
    }, 0);
  }

  // Release every observed shadow root in a subtree that has left the DOM.
  public removeShadowRootsIn(n: Node): void {
    if (this.shadowDoms.size === 0) return;
    const shadowRoot = dom.shadowRoot(n);
    if (shadowRoot) {
      if (this.shadowDoms.has(shadowRoot)) {
        this.removeShadowRoot(shadowRoot);
      }
      this.removeShadowRootsIn(shadowRoot);
    }
    dom.childNodes(n).forEach((child) => this.removeShadowRootsIn(child));
  }

  private removeShadowRoot(shadowRoot: ShadowRoot): void {
    const observed = this.shadowDoms.get(shadowRoot);
    this.shadowDoms.delete(shadowRoot);
    observed?.handlers.forEach(runHandler);
  }

  /**
   * Monkey patch 'attachShadow' of an IFrameElement to observe newly added shadow doms.
   */
  public observeAttachShadow(iframeElement: HTMLIFrameElement): void {
    callSafely(() => {
      const iframeWindow = iframeElement.contentWindow as
        (Window & { Element: { prototype: Element } }) | null;
      const iframeDocument = iframeElement.contentDocument;
      if (!iframeWindow || !iframeDocument) return;

      this.patchAttachShadow(iframeWindow.Element, iframeDocument);
    });
  }

  /**
   * Patch 'attachShadow' to observe newly added shadow doms.
   */
  private patchAttachShadow(
    element: {
      prototype: Element;
    },
    doc: Document,
  ) {
    const manager = this;
    this.restoreHandlers.push({
      doc,
      handler: patch(
        element.prototype,
        'attachShadow',
        function (original: (init: ShadowRootInit) => ShadowRoot) {
          return function (this: Element, option: ShadowRootInit) {
            const sRoot = original.call(this, option);
            // For the shadow dom elements in the document, monitor their dom mutations.
            // For shadow dom elements that aren't in the document yet,
            // we start monitoring them once their shadow dom host is appended to the document.
            const shadowRootEl = dom.shadowRoot(this);
            if (shadowRootEl && inDom(this))
              manager.addShadowRoot(shadowRootEl, doc);
            return sRoot;
          };
        },
      ),
    });
  }

  public reset(): void {
    this.restoreHandlers.forEach(({ handler }) => runHandler(handler));
    this.restoreHandlers = [];
    const shadowDoms = this.shadowDoms;
    this.shadowDoms = new Map();
    shadowDoms.forEach(({ handlers }) => handlers.forEach(runHandler));
  }

  // Tear down only the shadow observers owned by `doc` (e.g. one iframe being removed), leaving the rest of the page's shadow observation intact.
  public resetForDoc(doc: Document): void {
    const remaining: { doc: Document; handler: () => void }[] = [];
    for (const entry of this.restoreHandlers) {
      if (entry.doc === doc) {
        runHandler(entry.handler);
      } else {
        remaining.push(entry);
      }
    }
    this.restoreHandlers = remaining;
    this.shadowDoms.forEach((observed, shadowRoot) => {
      if (observed.doc === doc) {
        this.removeShadowRoot(shadowRoot);
      }
    });
  }
}

function runHandler(handler: listenerHandler) {
  try {
    handler();
  } catch (e) {
    //
  }
}
