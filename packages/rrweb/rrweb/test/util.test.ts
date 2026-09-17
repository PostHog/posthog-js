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
  callAllSafely,
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
        // emulates a genuine element whose setter throws (e.g. a file input
        // rejecting a programmatic value): the getter succeeds, so the probe
        // passes and the native setter's throw is preserved
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

    it('should skip the synchronous native setter for a non-native `this` reached through assignment', () => {
      vi.useFakeTimers();
      try {
        // emulate the native internal-slot brand check: both accessors reject a
        // `this` that was not genuinely constructed, exactly as a DOM accessor
        // throws 'Illegal invocation' for a proxy/cross-realm/`setPrototypeOf`
        // object. `isPrototypeOf`/`instanceof` cannot tell those apart from a
        // real element (they sit on the prototype chain); the getter probe can.
        const genuine = new WeakSet<object>();
        const nativeSet = vi.fn(function (this: object) {
          if (!genuine.has(this)) throw new TypeError('Illegal invocation');
        });
        const proto = {} as Record<string, unknown>;
        Object.defineProperty(proto, 'value', {
          configurable: true,
          get(this: object) {
            if (!genuine.has(this)) throw new TypeError('Illegal invocation');
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

        const realInput = Object.create(proto) as { value: string };
        genuine.add(realInput);

        // a transparent proxy forwards the prototype chain, so `.value =`
        // reaches the hooked setter with `this` = the proxy, which has no
        // internal slot — the synchronous native setter must be skipped
        const proxy = new Proxy(realInput, {}) as { value: string };
        expect(() => {
          proxy.value = 'via-proxy';
        }).not.toThrow();

        // a `setPrototypeOf` fake (a known instanceof-spoof pattern) is on the
        // prototype chain too, and must likewise be skipped rather than throw
        const fake = {} as { value: string };
        Object.setPrototypeOf(fake, proto);
        expect(() => {
          fake.value = 'via-fake';
        }).not.toThrow();

        expect(nativeSet).not.toHaveBeenCalled();

        vi.runAllTimers();
        expect(hookedSet).toHaveBeenCalledWith('via-proxy');
        expect(hookedSet).toHaveBeenCalledWith('via-fake');

        realInput.value = 'genuine';
        expect(nativeSet).toHaveBeenCalledTimes(1);
        expect(nativeSet).toHaveBeenCalledWith('genuine');

        reset();
      } finally {
        vi.useRealTimers();
      }
    });

    describe('deferring on an unpatched timer', () => {
      const zoneGlobals = window as unknown as Record<string, unknown>;
      const symbolFor = (key: string) => `__zone_symbol__${key}`;
      let originalSetTimeout: typeof setTimeout;
      let nativeSetTimeout: typeof setTimeout;

      beforeEach(() => {
        originalSetTimeout = window.setTimeout;
        nativeSetTimeout = originalSetTimeout.bind(window) as typeof setTimeout;
      });

      // the globals are restored here rather than in each test, so that a test
      // failing before its own cleanup cannot leak a patched timer or a `Zone`
      // into the ones after it
      afterEach(() => {
        window.setTimeout = originalSetTimeout;
        delete zoneGlobals.Zone;
        delete zoneGlobals.__zone_symbol__setTimeout;
        document.body.innerHTML = '';
      });

      const flushTimers = () =>
        new Promise((resolve) => nativeSetTimeout(resolve, 0));

      const deferringTimer = () =>
        vi.fn((callback: () => void) => nativeSetTimeout(callback, 0));

      // the hook is installed on a throwaway prototype, so there is nothing
      // shared to restore afterwards
      const hookValueSetter = (
        hookedSet: () => void,
        win: Window & typeof globalThis,
        nativeSet: () => void = vi.fn(),
      ) => {
        const proto = {} as Record<string, unknown>;
        Object.defineProperty(proto, 'value', {
          configurable: true,
          get() {
            return '';
          },
          set: nativeSet,
        });
        hookSetter(proto, 'value', { set: hookedSet }, false, win);
        return Object.create(proto) as { value: string };
      };

      it('should defer on the timer zone.js left unpatched', async () => {
        const patchedSetTimeout = deferringTimer();
        const unpatchedSetTimeout = deferringTimer();
        zoneGlobals.Zone = { __symbol__: symbolFor };
        zoneGlobals.__zone_symbol__setTimeout = unpatchedSetTimeout;
        window.setTimeout = patchedSetTimeout as unknown as typeof setTimeout;

        const hookedSet = vi.fn();
        const nativeSet = vi.fn();
        const element = hookValueSetter(hookedSet, window, nativeSet);
        element.value = 'test';

        // a timer scheduled through the patched global keeps the Angular zone
        // busy, so NgZone runs another change detection when it completes; a
        // component that writes the property on every change detection then
        // feeds itself forever
        expect(patchedSetTimeout).not.toHaveBeenCalled();
        expect(unpatchedSetTimeout).toHaveBeenCalledTimes(1);
        // the page-visible write stays synchronous
        expect(nativeSet).toHaveBeenCalledWith('test');

        await flushTimers();
        expect(hookedSet).toHaveBeenCalledWith('test');
      });

      it('should defer on the timer of the window the hook was installed for', async () => {
        const iframe = document.createElement('iframe');
        document.body.appendChild(iframe);
        const frameWindow = iframe.contentWindow as
          | (Window & typeof globalThis)
          | null;
        if (!frameWindow) throw new Error('the iframe has no window');

        // zone.js patches every window it reaches, so the hook has to pick the
        // unpatched timer of the window it was installed for
        const patchedSetTimeout = deferringTimer();
        const topUnpatchedSetTimeout = vi.fn();
        const frameUnpatchedSetTimeout = deferringTimer();
        zoneGlobals.Zone = { __symbol__: symbolFor };
        zoneGlobals.__zone_symbol__setTimeout = topUnpatchedSetTimeout;
        window.setTimeout = patchedSetTimeout as unknown as typeof setTimeout;

        const frameGlobals = frameWindow as unknown as Record<string, unknown>;
        frameGlobals.Zone = { __symbol__: symbolFor };
        frameGlobals.__zone_symbol__setTimeout = frameUnpatchedSetTimeout;
        frameWindow.setTimeout =
          patchedSetTimeout as unknown as typeof setTimeout;

        const hookedSet = vi.fn();
        const element = hookValueSetter(hookedSet, frameWindow);
        element.value = 'test';

        expect(patchedSetTimeout).not.toHaveBeenCalled();
        expect(topUnpatchedSetTimeout).not.toHaveBeenCalled();
        expect(frameUnpatchedSetTimeout).toHaveBeenCalledTimes(1);

        await flushTimers();
        expect(hookedSet).toHaveBeenCalledWith('test');
      });

      it('should fall back to the window timer when no unpatched one is exposed', async () => {
        const windowSetTimeout = deferringTimer();
        zoneGlobals.Zone = { __symbol__: symbolFor };
        window.setTimeout = windowSetTimeout as unknown as typeof setTimeout;

        const hookedSet = vi.fn();
        const element = hookValueSetter(hookedSet, window);
        element.value = 'test';

        expect(windowSetTimeout).toHaveBeenCalledTimes(1);

        await flushTimers();
        expect(hookedSet).toHaveBeenCalledWith('test');
      });

      it('should fall back to the window timer when the lookup throws', async () => {
        const windowSetTimeout = deferringTimer();
        // `Zone` is an ordinary global, so a page is free to put anything there
        zoneGlobals.Zone = {
          __symbol__: () => {
            throw new Error('not the zone.js you were looking for');
          },
        };
        window.setTimeout = windowSetTimeout as unknown as typeof setTimeout;

        const hookedSet = vi.fn();
        const element = hookValueSetter(hookedSet, window);
        element.value = 'test';

        // a throw here would escape the loop that installs the six input hooks,
        // leaving the earlier ones in place with no resetter to remove them
        expect(windowSetTimeout).toHaveBeenCalledTimes(1);

        await flushTimers();
        expect(hookedSet).toHaveBeenCalledWith('test');
      });

      it('should use the window timer when nothing patched it', async () => {
        const windowSetTimeout = deferringTimer();
        window.setTimeout = windowSetTimeout as unknown as typeof setTimeout;

        expect('Zone' in window).toBe(false);

        const hookedSet = vi.fn();
        const element = hookValueSetter(hookedSet, window);
        element.value = 'test';

        expect(windowSetTimeout).toHaveBeenCalledTimes(1);

        await flushTimers();
        expect(hookedSet).toHaveBeenCalledWith('test');
      });
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

  describe('callAllSafely', () => {
    it('runs every handler when one throws', () => {
      const calls: string[] = [];

      callAllSafely([
        () => calls.push('first'),
        () => {
          throw new Error('bad cleanup');
        },
        () => calls.push('last'),
      ]);

      expect(calls).toEqual(['first', 'last']);
    });

    it('skips a handler that is not callable', () => {
      const calls: string[] = [];

      expect(() =>
        callAllSafely([
          undefined as unknown as () => void,
          () => calls.push('last'),
        ]),
      ).not.toThrow();
      expect(calls).toEqual(['last']);
    });
  });
});
