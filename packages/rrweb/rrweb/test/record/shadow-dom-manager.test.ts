/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
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
  function createManager() {
    const mirror = new Mirror();
    return new ShadowDomManager({
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
  }

  it('addExistingShadowRoots() registers open shadow roots attached before recording started', () => {
    const manager = createManager();

    // A host whose shadow root was attached before the manager observes it.
    // We attach *after* reset() to simulate the pre-existing-root case without
    // relying on the attachShadow patch having fired for it.
    const host = document.createElement('div');
    const shadowRoot = host.attachShadow({ mode: 'open' });
    manager.reset(); // drop the buffer registered by the attachShadow patch
    document.body.appendChild(host);

    const buffersBefore = mutationBuffers.length;
    manager.addExistingShadowRoots(document, document);
    expect(mutationBuffers.length).toBe(buffersBefore + 1);

    // Idempotent: WeakSet dedup means a second pass adds nothing.
    manager.addExistingShadowRoots(document, document);
    expect(mutationBuffers.length).toBe(buffersBefore + 1);

    void shadowRoot;
    manager.reset();
    document.body.removeChild(host);
  });

  it('addExistingShadowRoots() recurses into nested shadow roots', () => {
    const manager = createManager();

    const host = document.createElement('div');
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const nestedHost = document.createElement('div');
    shadowRoot.appendChild(nestedHost);
    nestedHost.attachShadow({ mode: 'open' });
    manager.reset();
    document.body.appendChild(host);

    const buffersBefore = mutationBuffers.length;
    manager.addExistingShadowRoots(document, document);
    // Both the outer and the nested shadow root get their own buffer.
    expect(mutationBuffers.length).toBe(buffersBefore + 2);

    manager.reset();
    document.body.removeChild(host);
  });

  it('reset() should not call MutationBuffer.reset() from restoreHandler to avoid infinite recursion', () => {
    const manager = createManager();

    const host = document.createElement('div');
    document.body.appendChild(host);
    host.attachShadow({ mode: 'open' });

    // Spy on MutationBuffer.prototype.reset to verify it's NOT called
    // during ShadowDomManager.reset(). Calling buffer.reset() from the
    // restoreHandler creates infinite mutual recursion because
    // MutationBuffer.reset() calls this.shadowDomManager.reset()
    const resetSpy = vi.spyOn(MutationBuffer.prototype, 'reset');

    manager.reset();

    expect(resetSpy).not.toHaveBeenCalled();

    resetSpy.mockRestore();
    document.body.removeChild(host);
  });

  it('reset() removes shadow root buffers from mutationBuffers', () => {
    const manager = createManager();

    const host = document.createElement('div');
    document.body.appendChild(host);

    const buffersBeforeAdd = mutationBuffers.length;
    host.attachShadow({ mode: 'open' });
    expect(mutationBuffers.length).toBe(buffersBeforeAdd + 1);

    manager.reset();

    expect(mutationBuffers.length).toBe(buffersBeforeAdd);

    document.body.removeChild(host);
  });

  it('reset() clears restore handlers so a second reset is a no-op', () => {
    const manager = createManager();

    const host = document.createElement('div');
    document.body.appendChild(host);
    host.attachShadow({ mode: 'open' });

    manager.reset();

    expect(() => manager.reset()).not.toThrow();

    document.body.removeChild(host);
  });
});
