/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { Mirror } from '@posthog/rrweb-snapshot';

// jsdom's ShadowRoot doesn't pass isNativeShadowDom's toString check,
// so we mock it to always return true
vi.mock('@posthog/rrweb-snapshot', async () => {
  const actual = await vi.importActual('@posthog/rrweb-snapshot');
  return {
    ...actual,
    isNativeShadowDom: () => true,
  };
});

import { ShadowDomManager } from '../../src/record/shadow-dom-manager';
import { mutationBuffers } from '../../src/record/observer';
import MutationBuffer from '../../src/record/mutation';

describe('ShadowDomManager', () => {
  const managers: ShadowDomManager[] = [];
  const elements: HTMLElement[] = [];

  afterEach(() => {
    try {
      for (const manager of managers.splice(0).reverse()) {
        manager.reset();
      }
    } finally {
      for (const element of elements.splice(0)) {
        element.remove();
      }
      vi.restoreAllMocks();
    }
  });

  function createManager() {
    const mirror = new Mirror();
    const manager = new ShadowDomManager({
      mutationCb: vi.fn(),
      scrollCb: vi.fn(),
      bypassOptions: {
        blockClass: 'rr-block',
        blockSelector: null,
        maskTextClass: 'rr-mask',
        maskTextSelector: null,
        inlineStylesheet: true,
        maskInputOptions: {},
        maskTextFn: undefined,
        maskInputFn: undefined,
        dataURLOptions: {},
        inlineImages: false,
        recordCanvas: false,
        keepIframeSrcFn: () => false,
        slimDOMOptions: {},
        iframeManager: { addIframe: vi.fn() } as any,
        stylesheetManager: {
          adoptStyleSheets: vi.fn(),
        } as any,
        canvasManager: {
          acquire: vi.fn(),
          reset: vi.fn(),
          lock: vi.fn(),
          unlock: vi.fn(),
        } as any,
        processedNodeManager: {
          inOtherBuffer: vi.fn().mockReturnValue(false),
        } as any,
        ignoreCSSAttributes: new Set<string>(),
        customElementCb: vi.fn(),
        sampling: {},
      },
      mirror,
    });
    managers.push(manager);
    return manager;
  }

  it('ignores SecurityError when a frame navigates cross-origin', () => {
    const manager = createManager();
    const iframe = {
      contentWindow: {
        get Element() {
          throw new DOMException('Cross-origin frame', 'SecurityError');
        },
      },
      contentDocument: document,
    } as unknown as HTMLIFrameElement;

    expect(() => manager.observeAttachShadow(iframe)).not.toThrow();
  });

  it('does not swallow unrelated errors while observing a frame', () => {
    const manager = createManager();
    const iframe = {
      contentWindow: {
        get Element() {
          throw new TypeError('Broken Element getter');
        },
      },
      contentDocument: document,
    } as unknown as HTMLIFrameElement;

    expect(() => manager.observeAttachShadow(iframe)).toThrow(
      'Broken Element getter',
    );
  });

  it('still patches same-origin iframe shadow roots', () => {
    const manager = createManager();
    const iframe = document.createElement('iframe');
    elements.push(iframe);
    document.body.appendChild(iframe);
    const iframeDoc = iframe.contentDocument as Document;
    const iframeElement = iframe.contentWindow?.Element;

    expect(iframeElement).toBeDefined();
    const before = iframeElement?.prototype.attachShadow;
    manager.observeAttachShadow(iframe);
    expect(iframeElement?.prototype.attachShadow).not.toBe(before);

    manager.reset();
    expect(iframeElement?.prototype.attachShadow).toBe(before);
  });

  it('reset() should not call MutationBuffer.reset() from restoreHandler to avoid infinite recursion', () => {
    const manager = createManager();

    const host = document.createElement('div');
    elements.push(host);
    document.body.appendChild(host);
    host.attachShadow({ mode: 'open' });

    // restoreHandlers must release via releaseCanvasManager(), never buffer.reset() —
    // guards against reintroducing the shadowDomManager.reset() recursion that coupling once caused.
    const resetSpy = vi.spyOn(MutationBuffer.prototype, 'reset');

    manager.reset();

    expect(resetSpy).not.toHaveBeenCalled();
  });

  it('reset() removes shadow root buffers from mutationBuffers', () => {
    const manager = createManager();

    const host = document.createElement('div');
    elements.push(host);
    document.body.appendChild(host);

    const buffersBeforeAdd = mutationBuffers.length;
    host.attachShadow({ mode: 'open' });
    expect(mutationBuffers.length).toBe(buffersBeforeAdd + 1);

    manager.reset();

    expect(mutationBuffers.length).toBe(buffersBeforeAdd);
  });

  it('reset() clears restore handlers so a second reset is a no-op', () => {
    const manager = createManager();

    const host = document.createElement('div');
    elements.push(host);
    document.body.appendChild(host);
    host.attachShadow({ mode: 'open' });

    manager.reset();

    expect(() => manager.reset()).not.toThrow();
  });

  it('resetForDoc() only tears down handlers owned by the given document', () => {
    const manager = createManager();

    const host = document.createElement('div');
    elements.push(host);
    document.body.appendChild(host);

    const buffersBeforeAdd = mutationBuffers.length;
    host.attachShadow({ mode: 'open' });
    expect(mutationBuffers.length).toBe(buffersBeforeAdd + 1);

    // Tearing down a different document must leave this doc's shadow buffers alone.
    const otherDoc = document.implementation.createHTMLDocument('other');
    manager.resetForDoc(otherDoc);
    expect(mutationBuffers.length).toBe(buffersBeforeAdd + 1);

    // Tearing down the owning document removes them.
    manager.resetForDoc(document);
    expect(mutationBuffers.length).toBe(buffersBeforeAdd);
  });

  it('keys a shadow root by its host owner document, not the passed document', () => {
    const manager = createManager();

    const iframe = document.createElement('iframe');
    elements.push(iframe);
    document.body.appendChild(iframe);
    const iframeDoc = iframe.contentDocument as Document;
    const host = iframeDoc.createElement('div');
    iframeDoc.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });

    const buffersBeforeAdd = mutationBuffers.length;
    // takeFullSnapshot's onSerialize passes the top-level document for every root,
    // even ones nested inside an iframe.
    manager.addShadowRoot(root, document);
    expect(mutationBuffers.length).toBe(buffersBeforeAdd + 1);

    // Tearing down the top-level document must not match the iframe-owned root.
    manager.resetForDoc(document);
    expect(mutationBuffers.length).toBe(buffersBeforeAdd + 1);

    // Tearing down the iframe's own document does.
    manager.resetForDoc(iframeDoc);
    expect(mutationBuffers.length).toBe(buffersBeforeAdd);
  });
});
