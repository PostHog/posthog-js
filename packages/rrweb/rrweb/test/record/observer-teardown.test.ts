/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Mirror } from '@posthog/rrweb-snapshot';

import { initObservers, mutationBuffers } from '../../src/record/observer';
import type { observerParam } from '../../src/types';

const createOptions = (): observerParam =>
  ({
    mutationCb: vi.fn(),
    mousemoveCb: vi.fn(),
    mouseInteractionCb: vi.fn(),
    scrollCb: vi.fn(),
    viewportResizeCb: vi.fn(),
    inputCb: vi.fn(),
    mediaInteractionCb: vi.fn(),
    selectionCb: vi.fn(),
    styleSheetRuleCb: vi.fn(),
    styleDeclarationCb: vi.fn(),
    canvasMutationCb: vi.fn(),
    customElementCb: vi.fn(),
    fontCb: vi.fn(),
    blockClass: 'rr-block',
    blockSelector: null,
    ignoreClass: 'rr-ignore',
    ignoreSelector: null,
    maskTextClass: 'rr-mask',
    maskTextSelector: null,
    maskInputOptions: {},
    maskAllElementAttributes: false,
    keepIframeSrcFn: () => false,
    inlineStylesheet: true,
    sampling: {},
    recordDOM: true,
    recordCanvas: false,
    canvasMaskingConfigured: undefined,
    inlineImages: false,
    userTriggeredOnInput: false,
    collectFonts: false,
    slimDOMOptions: {},
    dataURLOptions: {},
    doc: document,
    mirror: new Mirror(),
    iframeManager: { addIframe: vi.fn() },
    stylesheetManager: {
      adoptStyleSheets: vi.fn(),
      trackLinkElement: vi.fn(),
    },
    shadowDomManager: {
      addShadowRoot: vi.fn(),
      observeAttachShadow: vi.fn(),
      resetForDoc: vi.fn(),
    },
    canvasManager: {
      acquire: vi.fn(),
      reset: vi.fn(),
      lock: vi.fn(),
      unlock: vi.fn(),
    },
    processedNodeManager: {
      inOtherBuffer: vi.fn().mockReturnValue(false),
    },
    ignoreCSSAttributes: new Set<string>(),
    plugins: [],
  } as unknown as observerParam);

describe('initObservers teardown', () => {
  afterEach(() => {
    mutationBuffers.length = 0;
  });

  const withPlugin = (options: observerParam) => {
    const pluginCleanup = vi.fn();
    options.plugins = [
      { observer: () => pluginCleanup, callback: vi.fn(), options: {} },
    ];
    return pluginCleanup;
  };

  it('releases the buffer and the handlers on a clean teardown', () => {
    const options = createOptions();
    const pluginCleanup = withPlugin(options);

    const cleanup = initObservers(options);
    const buffer = mutationBuffers[mutationBuffers.length - 1];

    expect(() => cleanup()).not.toThrow();
    expect(mutationBuffers).not.toContain(buffer);
    expect(pluginCleanup).toHaveBeenCalledTimes(1);
  });

  it('still releases the handlers when the shadow teardown throws', () => {
    const options = createOptions();
    const pluginCleanup = withPlugin(options);
    options.shadowDomManager.resetForDoc = () => {
      throw new Error('shadow teardown failed');
    };

    const cleanup = initObservers(options);

    // the failure still surfaces, but not at the cost of the listeners
    expect(() => cleanup()).toThrow('shadow teardown failed');
    expect(pluginCleanup).toHaveBeenCalledTimes(1);
  });

  it('unpins the buffer and releases the handlers when destroy throws', () => {
    const options = createOptions();
    const pluginCleanup = withPlugin(options);

    const cleanup = initObservers(options);
    const buffer = mutationBuffers[mutationBuffers.length - 1];
    expect(buffer).toBeDefined();
    buffer.destroy = () => {
      throw new Error('destroy failed');
    };

    expect(() => cleanup()).toThrow('destroy failed');
    expect(mutationBuffers).not.toContain(buffer);
    expect(pluginCleanup).toHaveBeenCalledTimes(1);
  });
});
