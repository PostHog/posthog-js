/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initAdoptedStyleSheetObserver } from '../../src/record/observer';
import type { Mirror } from '@posthog/rrweb-snapshot';
import type { StylesheetManager } from '../../src/record/stylesheet-manager';

describe('initAdoptedStyleSheetObserver()', () => {
  const HOST_ID = 1;
  let originalDescriptor: PropertyDescriptor | undefined;
  let nativeSet: ReturnType<typeof vi.fn>;
  let adoptStyleSheets: ReturnType<typeof vi.fn>;
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    // Capture and replace the native `adoptedStyleSheets` descriptor with a
    // controllable stand-in so we can simulate the browser's behaviour
    // (jsdom does not implement constructed-stylesheet adoption).
    originalDescriptor = Object.getOwnPropertyDescriptor(
      Document.prototype,
      'adoptedStyleSheets',
    );
    nativeSet = vi.fn();
    Object.defineProperty(Document.prototype, 'adoptedStyleSheets', {
      configurable: true,
      enumerable: true,
      get() {
        return [];
      },
      set(sheets: CSSStyleSheet[]) {
        nativeSet(sheets);
      },
    });

    adoptStyleSheets = vi.fn();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    if (originalDescriptor) {
      Object.defineProperty(
        Document.prototype,
        'adoptedStyleSheets',
        originalDescriptor,
      );
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (Document.prototype as any).adoptedStyleSheets;
    }
  });

  function observe() {
    const mirror = { getId: () => HOST_ID } as unknown as Mirror;
    const stylesheetManager = {
      adoptStyleSheets,
    } as unknown as StylesheetManager;
    cleanup = initAdoptedStyleSheetObserver(
      { mirror, stylesheetManager },
      document,
    );
  }

  it('records adopted stylesheets on a successful assignment', () => {
    observe();
    const sheets = [{} as CSSStyleSheet];

    document.adoptedStyleSheets = sheets;

    expect(nativeSet).toHaveBeenCalledWith(sheets);
    expect(adoptStyleSheets).toHaveBeenCalledWith(sheets, HOST_ID);
  });

  it('contains NotAllowedError from sharing a constructed stylesheet across documents', () => {
    nativeSet.mockImplementation(() => {
      throw new DOMException(
        'Sharing constructed stylesheets in multiple documents is not allowed',
        'NotAllowedError',
      );
    });
    observe();

    // the host page's own invalid assignment must not surface as a recorder error
    expect(() => {
      document.adoptedStyleSheets = [{} as CSSStyleSheet];
    }).not.toThrow();

    // recording degrades gracefully - we never try to record the rejected sheets
    expect(adoptStyleSheets).not.toHaveBeenCalled();
  });

  it('re-throws unrelated native-setter errors so host-page behaviour is preserved', () => {
    nativeSet.mockImplementation(() => {
      throw new TypeError('Failed to set adoptedStyleSheets');
    });
    observe();

    expect(() => {
      document.adoptedStyleSheets = [{} as CSSStyleSheet];
    }).toThrow(TypeError);

    expect(adoptStyleSheets).not.toHaveBeenCalled();
  });
});
