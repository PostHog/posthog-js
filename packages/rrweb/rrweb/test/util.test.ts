/**
 * @vitest-environment jsdom
 */
import {
  getRootShadowHost,
  StyleSheetMirror,
  inDom,
  shadowHostInDom,
  getShadowHost,
  on,
  hookSetter,
} from '../src/utils';

describe('Utilities for other modules', () => {
  describe('StyleSheetMirror', () => {
    it('should create a StyleSheetMirror', () => {
      const mirror = new StyleSheetMirror();
      expect(mirror).toBeDefined();
      expect(mirror.add).toBeDefined();
      expect(mirror.has).toBeDefined();
      expect(mirror.reset).toBeDefined();
      expect(mirror.getId).toBeDefined();
    });

    it('can add CSSStyleSheet into the mirror without ID parameter', () => {
      const mirror = new StyleSheetMirror();
      const styleSheet = new CSSStyleSheet();
      expect(mirror.has(styleSheet)).toBeFalsy();
      expect(mirror.add(styleSheet)).toEqual(1);
      expect(mirror.has(styleSheet)).toBeTruthy();
      // This stylesheet has been added before so just return its assigned id.
      expect(mirror.add(styleSheet)).toEqual(1);

      for (let i = 0; i < 10; i++) {
        const styleSheet = new CSSStyleSheet();
        expect(mirror.has(styleSheet)).toBeFalsy();
        expect(mirror.add(styleSheet)).toEqual(i + 2);
        expect(mirror.has(styleSheet)).toBeTruthy();
      }
    });

    it('can add CSSStyleSheet into the mirror with ID parameter', () => {
      const mirror = new StyleSheetMirror();
      for (let i = 0; i < 10; i++) {
        const styleSheet = new CSSStyleSheet();
        expect(mirror.has(styleSheet)).toBeFalsy();
        expect(mirror.add(styleSheet, i)).toEqual(i);
        expect(mirror.has(styleSheet)).toBeTruthy();
      }
    });

    it('can get the id from the mirror', () => {
      const mirror = new StyleSheetMirror();
      for (let i = 0; i < 10; i++) {
        const styleSheet = new CSSStyleSheet();
        mirror.add(styleSheet);
        expect(mirror.getId(styleSheet)).toBe(i + 1);
      }
      expect(mirror.getId(new CSSStyleSheet())).toBe(-1);
    });

    it('can get CSSStyleSheet objects with id', () => {
      const mirror = new StyleSheetMirror();
      for (let i = 0; i < 10; i++) {
        const styleSheet = new CSSStyleSheet();
        mirror.add(styleSheet);
        expect(mirror.getStyle(i + 1)).toBe(styleSheet);
      }
    });

    it('can reset the mirror', () => {
      const mirror = new StyleSheetMirror();
      const styleList: CSSStyleSheet[] = [];
      for (let i = 0; i < 10; i++) {
        const styleSheet = new CSSStyleSheet();
        mirror.add(styleSheet);
        expect(mirror.getId(styleSheet)).toBe(i + 1);
        styleList.push(styleSheet);
      }
      expect(mirror.reset()).toBeUndefined();
      for (let s of styleList) expect(mirror.has(s)).toBeFalsy();
      for (let i = 0; i < 10; i++) expect(mirror.getStyle(i + 1)).toBeNull();
      expect(mirror.add(new CSSStyleSheet())).toBe(1);
    });
  });

  describe('on()', () => {
    it('should not throw when cleanup target cannot remove listeners', () => {
      const target = {
        addEventListener: vi.fn(),
      } as unknown as Document;

      const cleanup = on('click', vi.fn(), target);

      expect(() => cleanup()).not.toThrow();
      expect(target.addEventListener).toHaveBeenCalledWith(
        'click',
        expect.any(Function),
        { capture: true, passive: true },
      );
    });
  });

  describe('hookSetter()', () => {
    it('should contain a failing deferred hooked setter and preserve the native throw', () => {
      vi.useFakeTimers();
      try {
        // emulates a native accessor rejecting a foreign `this`
        const proto = {} as Record<string, unknown>;
        Object.defineProperty(proto, 'value', {
          configurable: true,
          get() {
            return '';
          },
          set() {
            throw new TypeError('Illegal invocation');
          },
        });

        const hookedSet = vi.fn(() => {
          throw new TypeError('Illegal invocation');
        });

        const reset = hookSetter(
          proto,
          'value',
          { set: hookedSet },
          false,
          window,
        );

        const foreign = Object.create(proto) as { value: string };

        // the native setter's throw reaches the caller, as it would
        // without the hook installed
        expect(() => {
          foreign.value = 'test';
        }).toThrow(TypeError);

        // the deferred hooked setter still ran and its throw is contained
        expect(() => vi.runAllTimers()).not.toThrow();
        expect(hookedSet).toHaveBeenCalledTimes(1);

        reset();
      } finally {
        vi.useRealTimers();
      }
    });

    it('should still invoke the setters for a valid `this`', () => {
      vi.useFakeTimers();
      try {
        const nativeSet = vi.fn();
        const proto = {} as Record<string, unknown>;
        Object.defineProperty(proto, 'value', {
          configurable: true,
          get() {
            return '';
          },
          set: nativeSet,
        });

        const hookedSet = vi.fn();
        const reset = hookSetter(
          proto,
          'value',
          { set: hookedSet },
          false,
          window,
        );

        const obj = Object.create(proto) as { value: string };
        obj.value = 'test';

        expect(nativeSet).toHaveBeenCalledWith('test');
        vi.runAllTimers();
        expect(hookedSet).toHaveBeenCalledWith('test');

        reset();
      } finally {
        vi.useRealTimers();
      }
    });

    it('should skip the synchronous native setter when `this` is not a genuine instance', () => {
      vi.useFakeTimers();
      try {
        // a genuine native setter throws 'Illegal invocation' when invoked
        // with a `this` that lacks the internal slot (a proxy, custom element,
        // or cross-realm object)
        const nativeSet = vi.fn(() => {
          throw new TypeError('Illegal invocation');
        });
        const proto = {} as Record<string, unknown>;
        Object.defineProperty(proto, 'value', {
          configurable: true,
          get() {
            return '';
          },
          set: nativeSet,
        });

        const hookedSet = vi.fn();
        const reset = hookSetter(
          proto,
          'value',
          { set: hookedSet },
          false,
          window,
        );

        // `foreign` does not derive from `proto`, so it fails the instanceof
        // guard — the synchronous native setter must be skipped, not throw
        const foreign = {} as { value: string };
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;

        expect(() => setter.call(foreign, 'test')).not.toThrow();
        expect(nativeSet).not.toHaveBeenCalled();

        // the deferred hooked setter still runs (it does not touch native slots)
        expect(() => vi.runAllTimers()).not.toThrow();
        expect(hookedSet).toHaveBeenCalledWith('test');

        reset();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('inDom()', () => {
    it('should get correct result given nested shadow doms', () => {
      const shadowHost = document.createElement('div');
      const shadowRoot = shadowHost.attachShadow({ mode: 'open' });
      const shadowHost2 = document.createElement('div');
      const shadowRoot2 = shadowHost2.attachShadow({ mode: 'open' });
      const div = document.createElement('div');
      shadowRoot.appendChild(shadowHost2);
      shadowRoot2.appendChild(div);
      // Not in Dom yet.
      expect(getShadowHost(div)).toBe(shadowHost2);
      expect(getRootShadowHost(div)).toBe(shadowHost);
      expect(shadowHostInDom(div)).toBeFalsy();
      expect(inDom(div)).toBeFalsy();

      // Added to the Dom.
      document.body.appendChild(shadowHost);
      expect(getShadowHost(div)).toBe(shadowHost2);
      expect(getRootShadowHost(div)).toBe(shadowHost);
      expect(shadowHostInDom(div)).toBeTruthy();
      expect(inDom(div)).toBeTruthy();
    });

    it('should get correct result given a normal node', () => {
      const div = document.createElement('div');
      // Not in Dom yet.
      expect(getShadowHost(div)).toBeNull();
      expect(getRootShadowHost(div)).toBe(div);
      expect(shadowHostInDom(div)).toBeFalsy();
      expect(inDom(div)).toBeFalsy();

      // Added to the Dom.
      document.body.appendChild(div);
      expect(getShadowHost(div)).toBeNull();
      expect(getRootShadowHost(div)).toBe(div);
      expect(shadowHostInDom(div)).toBeTruthy();
      expect(inDom(div)).toBeTruthy();
    });

    /**
     * Given the textNode of a detached HTMLAnchorElement, getRootNode() will return the anchor element itself and its host property is a string.
     * This corner case may cause an error in getRootShadowHost().
     */
    it('should get correct result given the textNode of a detached HTMLAnchorElement', () => {
      const a = document.createElement('a');
      a.href = 'example.com';
      a.textContent = 'something';
      // Not in Dom yet.
      expect(getShadowHost(a.childNodes[0])).toBeNull();
      expect(getRootShadowHost(a.childNodes[0])).toBe(a.childNodes[0]);
      expect(shadowHostInDom(a.childNodes[0])).toBeFalsy();
      expect(inDom(a.childNodes[0])).toBeFalsy();

      // Added to the Dom.
      document.body.appendChild(a);
      expect(getShadowHost(a.childNodes[0])).toBeNull();
      expect(getRootShadowHost(a.childNodes[0])).toBe(a.childNodes[0]);
      expect(shadowHostInDom(a.childNodes[0])).toBeTruthy();
      expect(inDom(a.childNodes[0])).toBeTruthy();
    });
  });
});
