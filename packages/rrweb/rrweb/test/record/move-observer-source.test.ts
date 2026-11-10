/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Mirror } from '@posthog/rrweb-snapshot';

import { initObservers, mutationBuffers } from '../../src/record/observer';
import { IncrementalSource } from '@posthog/rrweb-types';
import type { listenerHandler, observerParam } from '../../src/types';

const createOptions = (doc: Document = document): observerParam =>
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
    doc,
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
      removeShadowRootsIn: vi.fn(),
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

describe('move observer event source', () => {
  let stop: listenerHandler | undefined;
  let iframe: HTMLIFrameElement | undefined;

  afterEach(() => {
    stop?.();
    stop = undefined;
    iframe?.remove();
    iframe = undefined;
    mutationBuffers.length = 0;
  });

  const observeSameOriginIframe = () => {
    iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const win = iframe.contentWindow as Window & typeof globalThis;
    const doc = iframe.contentDocument!;
    // The iframe has its own realm, so its events are not instances of this
    // window's event constructors.
    expect(win.MouseEvent).not.toBe(window.MouseEvent);
    const mousemoveCb = vi.fn();
    stop = initObservers({ ...createOptions(doc), mousemoveCb });
    return { win, doc, mousemoveCb };
  };

  it('records mousemove in a same-origin iframe as MouseMove', () => {
    const { win, doc, mousemoveCb } = observeSameOriginIframe();

    doc.dispatchEvent(
      new win.MouseEvent('mousemove', { clientX: 10, clientY: 20 }),
    );

    expect(mousemoveCb).toHaveBeenCalledTimes(1);
    const [positions, source] = mousemoveCb.mock.calls[0];
    expect(source).toBe(IncrementalSource.MouseMove);
    expect(positions).toEqual([
      expect.objectContaining({ x: 10, y: 20 }),
    ]);
  });

  it('records drag in a same-origin iframe as Drag', () => {
    const { win, doc, mousemoveCb } = observeSameOriginIframe();

    doc.dispatchEvent(new win.MouseEvent('drag', { clientX: 1, clientY: 2 }));

    expect(mousemoveCb).toHaveBeenCalledTimes(1);
    expect(mousemoveCb.mock.calls[0][1]).toBe(IncrementalSource.Drag);
  });

  it('records touchmove in a same-origin iframe as TouchMove', () => {
    const { win, doc, mousemoveCb } = observeSameOriginIframe();

    const touchmove = new win.Event('touchmove');
    Object.defineProperty(touchmove, 'changedTouches', {
      value: [{ clientX: 3, clientY: 4 }],
    });
    doc.dispatchEvent(touchmove);

    expect(mousemoveCb).toHaveBeenCalledTimes(1);
    const [positions, source] = mousemoveCb.mock.calls[0];
    expect(source).toBe(IncrementalSource.TouchMove);
    expect(positions).toEqual([expect.objectContaining({ x: 3, y: 4 })]);
  });

  it('still records mousemove in the top document as MouseMove', () => {
    const mousemoveCb = vi.fn();
    stop = initObservers({ ...createOptions(document), mousemoveCb });

    document.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 5, clientY: 6 }),
    );

    expect(mousemoveCb).toHaveBeenCalledTimes(1);
    expect(mousemoveCb.mock.calls[0][1]).toBe(IncrementalSource.MouseMove);
  });
});
