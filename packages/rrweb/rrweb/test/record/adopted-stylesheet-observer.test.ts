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
    document.body.innerHTML = '';
    if (originalDescriptor) {
      Object.defineProperty(
        Document.prototype,
        'adoptedStyleSheets',
        originalDescriptor,
      );
    } else {
      delete (Document.prototype as any).adoptedStyleSheets;
    }
  });

  function observe(
    host: Document | ShadowRoot = document,
    onAdopt = adoptStyleSheets,
  ) {
    const mirror = { getId: () => HOST_ID } as unknown as Mirror;
    const stylesheetManager = {
      adoptStyleSheets: onAdopt,
    } as unknown as StylesheetManager;
    cleanup = initAdoptedStyleSheetObserver(
      { mirror, stylesheetManager },
      host,
    );
    return cleanup;
  }

  function createHost(kind: 'document' | 'shadow root') {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const win = iframe.contentWindow!;
    const prototype =
      kind === 'document' ? win.Document.prototype : win.ShadowRoot.prototype;
    Object.defineProperty(
      prototype,
      'adoptedStyleSheets',
      Object.getOwnPropertyDescriptor(
        Document.prototype,
        'adoptedStyleSheets',
      )!,
    );
    return kind === 'document'
      ? win.document
      : win.document.createElement('div').attachShadow({ mode: 'open' });
  }

  it.each(['document', 'shadow root'] as const)(
    'leaves a non-configurable own property on a %s untouched',
    (kind) => {
      const host = createHost(kind);
      const setter = vi.fn();
      const descriptor = { configurable: false, get: () => [], set: setter };
      Object.defineProperty(host, 'adoptedStyleSheets', descriptor);
      const before = Object.getOwnPropertyDescriptor(
        host,
        'adoptedStyleSheets',
      );

      expect(() => observe(host)).not.toThrow();
      const sheets = [{} as CSSStyleSheet];
      host.adoptedStyleSheets = sheets;
      expect(setter).toHaveBeenCalledWith(sheets);
      expect(adoptStyleSheets).not.toHaveBeenCalled();
      expect(() => cleanup?.()).not.toThrow();
      expect(
        Object.getOwnPropertyDescriptor(host, 'adoptedStyleSheets'),
      ).toEqual(before);
    },
  );

  it('skips a host that cannot be extended', () => {
    const host = Object.preventExtensions(createHost('document'));
    expect(() => observe(host)).not.toThrow();
    expect(() => cleanup?.()).not.toThrow();
    expect(
      Object.getOwnPropertyDescriptor(host, 'adoptedStyleSheets'),
    ).toBeUndefined();
  });

  it('preserves a configurable own accessor while observing and on cleanup', () => {
    const host = createHost('shadow root');
    const sheets = [{} as CSSStyleSheet];
    const setter = vi.fn();
    Object.defineProperty(host, 'adoptedStyleSheets', {
      configurable: true,
      get: () => sheets,
      set: setter,
    });
    const before = Object.getOwnPropertyDescriptor(host, 'adoptedStyleSheets');

    observe(host);
    expect(host.adoptedStyleSheets).toBe(sheets);
    host.adoptedStyleSheets = sheets;
    expect(setter).toHaveBeenCalledWith(sheets);
    expect(adoptStyleSheets).toHaveBeenCalledWith(sheets, HOST_ID);
    expect(nativeSet).not.toHaveBeenCalled();
    cleanup?.();
    expect(Object.getOwnPropertyDescriptor(host, 'adoptedStyleSheets')).toEqual(
      before,
    );
  });

  it('does not replace an own data property', () => {
    const host = createHost('document');
    const sheets = [{} as CSSStyleSheet];
    Object.defineProperty(host, 'adoptedStyleSheets', {
      configurable: true,
      value: sheets,
    });
    const before = Object.getOwnPropertyDescriptor(host, 'adoptedStyleSheets');
    observe(host);
    cleanup?.();
    expect(Object.getOwnPropertyDescriptor(host, 'adoptedStyleSheets')).toEqual(
      before,
    );
  });

  it('keeps its hook removable across restarts with a non-configurable prototype property', () => {
    const host = createHost('document') as Document;
    Object.defineProperty(
      host.defaultView!.Document.prototype,
      'adoptedStyleSheets',
      {
        configurable: false,
      },
    );
    for (let i = 0; i < 2; i++) {
      observe(host);
      host.adoptedStyleSheets = [];
      cleanup?.();
      expect(
        Object.getOwnPropertyDescriptor(host, 'adoptedStyleSheets'),
      ).toBeUndefined();
    }
    expect(adoptStyleSheets).toHaveBeenCalledTimes(2);
  });

  it('does not overwrite a later hook during cleanup', () => {
    const host = createHost('document');
    observe(host);
    Object.defineProperty(host, 'adoptedStyleSheets', {
      configurable: true,
      get: () => [],
    });
    const replacement = Object.getOwnPropertyDescriptor(
      host,
      'adoptedStyleSheets',
    );
    cleanup?.();
    expect(Object.getOwnPropertyDescriptor(host, 'adoptedStyleSheets')).toEqual(
      replacement,
    );
  });

  it.each(['document', 'shadow root'] as const)(
    'stops observing a retained wrapper on a %s across restarts',
    (kind) => {
      const host = createHost(kind);
      observe(host);
      const hook = Object.getOwnPropertyDescriptor(host, 'adoptedStyleSheets')!;
      Object.defineProperty(host, 'adoptedStyleSheets', {
        configurable: true,
        get: hook.get,
        set(sheets: CSSStyleSheet[]) {
          hook.set!.call(this, sheets);
        },
      });
      const wrapper = Object.getOwnPropertyDescriptor(
        host,
        'adoptedStyleSheets',
      );
      const sheets = [{} as CSSStyleSheet];
      host.adoptedStyleSheets = sheets;
      expect(adoptStyleSheets).toHaveBeenCalledTimes(1);
      cleanup?.();
      host.adoptedStyleSheets = sheets;
      expect(nativeSet).toHaveBeenCalledTimes(2);
      expect(adoptStyleSheets).toHaveBeenCalledTimes(1);
      expect(
        Object.getOwnPropertyDescriptor(host, 'adoptedStyleSheets'),
      ).toEqual(wrapper);

      const restartedAdopt = vi.fn();
      observe(host, restartedAdopt);
      host.adoptedStyleSheets = sheets;
      expect(restartedAdopt).toHaveBeenCalledWith(sheets, HOST_ID);
      expect(adoptStyleSheets).toHaveBeenCalledTimes(1);
      cleanup?.();
      host.adoptedStyleSheets = sheets;
      expect(nativeSet).toHaveBeenCalledTimes(4);
      expect(restartedAdopt).toHaveBeenCalledTimes(1);
      expect(
        Object.getOwnPropertyDescriptor(host, 'adoptedStyleSheets'),
      ).toEqual(wrapper);
    },
  );

  it.each(['document', 'shadow root'] as const)(
    'stops observing a locked hook on a %s',
    (kind) => {
      const host = createHost(kind);
      observe(host);
      Object.defineProperty(host, 'adoptedStyleSheets', {
        configurable: false,
      });
      expect(() => cleanup?.()).not.toThrow();
      host.adoptedStyleSheets = [];
      expect(nativeSet).toHaveBeenCalledTimes(1);
      expect(adoptStyleSheets).not.toHaveBeenCalled();
    },
  );

  describe.each(['document', 'shadow root'] as const)(
    '%s with overlapping observers',
    (kind) => {
      it.each([
        { ownAccessor: false, firstToStop: 0 },
        { ownAccessor: false, firstToStop: 1 },
        { ownAccessor: true, firstToStop: 0 },
        { ownAccessor: true, firstToStop: 1 },
      ])(
        'restores the original descriptor with $ownAccessor own accessor and observer $firstToStop stopping first',
        ({ ownAccessor, firstToStop }) => {
          const host = createHost(kind);
          if (ownAccessor) {
            Object.defineProperty(host, 'adoptedStyleSheets', {
              configurable: true,
              get: () => [],
              set: nativeSet,
            });
          }
          const before = Object.getOwnPropertyDescriptor(
            host,
            'adoptedStyleSheets',
          );
          const adoptions = [vi.fn(), vi.fn()];
          const stops = adoptions.map((onAdopt) => observe(host, onAdopt));
          const sheets = [{} as CSSStyleSheet];
          host.adoptedStyleSheets = sheets;
          adoptions.forEach((onAdopt) =>
            expect(onAdopt).toHaveBeenCalledTimes(1),
          );

          stops[firstToStop]();
          host.adoptedStyleSheets = sheets;
          expect(adoptions[firstToStop]).toHaveBeenCalledTimes(1);
          expect(adoptions[1 - firstToStop]).toHaveBeenCalledTimes(2);
          stops[1 - firstToStop]();
          expect(
            Object.getOwnPropertyDescriptor(host, 'adoptedStyleSheets'),
          ).toEqual(before);
          host.adoptedStyleSheets = sheets;
          expect(nativeSet).toHaveBeenCalledTimes(3);
          expect(adoptions[firstToStop]).toHaveBeenCalledTimes(1);
          expect(adoptions[1 - firstToStop]).toHaveBeenCalledTimes(2);
          stops.forEach((stop) => stop());
          expect(
            Object.getOwnPropertyDescriptor(host, 'adoptedStyleSheets'),
          ).toEqual(before);
        },
      );

      it('skips multiple disposed hooks when the last observer stops', () => {
        const host = createHost(kind);
        const stops = [observe(host), observe(host), observe(host)];
        stops[0]();
        stops[1]();
        stops[2]();
        expect(
          Object.getOwnPropertyDescriptor(host, 'adoptedStyleSheets'),
        ).toBeUndefined();
      });
    },
  );

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

  it('contains a NotAllowedError thrown from another realm (same-origin iframe)', () => {
    // Simulates the iframe realm's DOMException, which is not `instanceof`
    // the recorder realm's DOMException but still carries the standardized
    // `NotAllowedError` name.
    const crossRealmError = {
      name: 'NotAllowedError',
      message: 'Sharing constructed stylesheets in multiple documents is not allowed',
    }
    expect(crossRealmError instanceof DOMException).toBe(false);
    nativeSet.mockImplementation(() => {
      throw crossRealmError;
    });
    observe();

    expect(() => {
      document.adoptedStyleSheets = [{} as CSSStyleSheet];
    }).not.toThrow();

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
