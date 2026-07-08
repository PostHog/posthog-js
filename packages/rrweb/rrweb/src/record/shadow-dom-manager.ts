import type { MutationBufferParam } from '../types';
import type {
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
import { inDom } from '../utils';
import type { Mirror } from '@posthog/rrweb-snapshot';
import { isNativeShadowDom } from '@posthog/rrweb-snapshot';
import dom, { patch } from '@posthog/rrweb-utils';

type BypassOptions = Omit<
  MutationBufferParam,
  'doc' | 'mutationCb' | 'mirror' | 'shadowDomManager'
> & {
  sampling: SamplingStrategy;
};

export class ShadowDomManager {
  private shadowDoms = new WeakSet<ShadowRoot>();
  private mutationCb: mutationCallBack;
  private scrollCb: scrollCallback;
  private bypassOptions: BypassOptions;
  private mirror: Mirror;
  // Handlers are tagged with the document that owns their shadow root so a
  // single iframe can be torn down without disconnecting the rest of the page.
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

  public init() {
    this.reset();
    // Patch 'attachShadow' to observe newly added shadow doms.
    this.patchAttachShadow(Element, document);
  }

  public addShadowRoot(shadowRoot: ShadowRoot, doc: Document) {
    if (!isNativeShadowDom(shadowRoot)) return;
    if (this.shadowDoms.has(shadowRoot)) return;
    this.shadowDoms.add(shadowRoot);
    // Derive the owning document from the host so a shadow root nested in an
    // iframe is keyed to that iframe's document, not whatever the caller passed
    // (takeFullSnapshot's onSerialize hands us the top-level document).
    const ownerDoc = dom.host(shadowRoot)?.ownerDocument ?? doc;
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
    this.restoreHandlers.push({
      doc: ownerDoc,
      handler: () => {
        observer.disconnect();
        buffer.destroy();
        // Release the canvas directly, not via buffer.reset(), per the recursion-guard unit test.
        buffer.releaseCanvasManager();
        const index = mutationBuffers.indexOf(buffer);
        if (index !== -1) {
          mutationBuffers.splice(index, 1);
        }
      },
    });
    this.restoreHandlers.push({
      doc: ownerDoc,
      handler: initScrollObserver({
        ...this.bypassOptions,
        scrollCb: this.scrollCb,
        // https://gist.github.com/praveenpuglia/0832da687ed5a5d7a0907046c9ef1813
        // scroll is not allowed to pass the boundary, so we need to listen the shadow document
        doc: shadowRoot as unknown as Document,
        mirror: this.mirror,
      }),
    });
    // Defer this to avoid adoptedStyleSheet events being created before the full snapshot is created or attachShadow action is recorded.
    setTimeout(() => {
      if (
        shadowRoot.adoptedStyleSheets &&
        shadowRoot.adoptedStyleSheets.length > 0
      )
        this.bypassOptions.stylesheetManager.adoptStyleSheets(
          shadowRoot.adoptedStyleSheets,
          this.mirror.getId(dom.host(shadowRoot)),
        );
      this.restoreHandlers.push({
        doc: ownerDoc,
        handler: initAdoptedStyleSheetObserver(
          {
            mirror: this.mirror,
            stylesheetManager: this.bypassOptions.stylesheetManager,
          },
          shadowRoot,
        ),
      });
    }, 0);
  }

  /**
   * Monkey patch 'attachShadow' of an IFrameElement to observe newly added shadow doms.
   */
  public observeAttachShadow(iframeElement: HTMLIFrameElement) {
    if (!iframeElement.contentWindow || !iframeElement.contentDocument) return;

    this.patchAttachShadow(
      (
        iframeElement.contentWindow as Window & {
          Element: { prototype: Element };
        }
      ).Element,
      iframeElement.contentDocument,
    );
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
    // eslint-disable-next-line @typescript-eslint/no-this-alias
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

  public reset() {
    this.restoreHandlers.forEach(({ handler }) => {
      try {
        handler();
      } catch (e) {
        //
      }
    });
    this.restoreHandlers = [];
    this.shadowDoms = new WeakSet();
  }

  // Tear down only the shadow observers owned by `doc` (e.g. one iframe being removed), leaving the rest of the page's shadow observation intact.
  public resetForDoc(doc: Document) {
    const remaining: { doc: Document; handler: () => void }[] = [];
    for (const entry of this.restoreHandlers) {
      if (entry.doc === doc) {
        try {
          entry.handler();
        } catch (e) {
          //
        }
      } else {
        remaining.push(entry);
      }
    }
    this.restoreHandlers = remaining;
  }
}
