// Portions of this file are derived from getsentry/sentry-javascript
// Copyright (c) 2012 Functional Software, Inc. dba Sentry
// Licensed under the MIT License: https://github.com/getsentry/sentry-javascript/blob/develop/LICENSE

type PrototypeOwner = Node | ShadowRoot | MutationObserver | Element;
type TypeofPrototypeOwner =
  | typeof Node
  | typeof ShadowRoot
  | typeof MutationObserver
  | typeof Element;

type BasePrototypeCache = {
  Node: typeof Node.prototype;
  ShadowRoot: typeof ShadowRoot.prototype;
  MutationObserver: typeof MutationObserver.prototype;
  Element: typeof Element.prototype;
};

const testableAccessors = {
  Node: ['childNodes', 'parentNode', 'parentElement', 'textContent'] as const,
  ShadowRoot: ['host', 'styleSheets'] as const,
  Element: ['shadowRoot'] as const,
  MutationObserver: [] as const,
} as const;

const testableMethods = {
  Node: ['contains', 'getRootNode'] as const,
  ShadowRoot: ['getSelection'],
  Element: ['querySelector', 'querySelectorAll'],
  MutationObserver: ['constructor'],
} as const;

const untaintedBasePrototype: Partial<BasePrototypeCache> = {};

type WindowWithZone = typeof globalThis & {
  Zone?: {
    __symbol__?: (key: string) => string;
  };
};

type WindowWithUnpatchedSymbols = typeof globalThis &
  Record<string, TypeofPrototypeOwner>;

/*
Angular zone patches many things and can pass the untainted checks below, causing performance issues
Angular zone, puts the unpatched originals on the window, and the names for hose on the zone object.
So, we get the unpatched versions from the window object if they exist.
You can rename Zone, but this is a good enough proxy to avoid going to an iframe to get the untainted versions.
see: https://github.com/angular/angular/issues/26948
*/
function angularZoneUnpatchedAlternative(key: keyof BasePrototypeCache) {
  const angularUnpatchedVersionSymbol = (
    globalThis as WindowWithZone
  )?.Zone?.__symbol__?.(key);
  if (
    angularUnpatchedVersionSymbol &&
    (globalThis as WindowWithUnpatchedSymbols)[angularUnpatchedVersionSymbol]
  ) {
    return (globalThis as WindowWithUnpatchedSymbols)[
      angularUnpatchedVersionSymbol
    ];
  } else {
    return undefined;
  }
}

export function getUntaintedPrototype<T extends keyof BasePrototypeCache>(
  key: T,
): BasePrototypeCache[T] {
  if (untaintedBasePrototype[key])
    return untaintedBasePrototype[key] as BasePrototypeCache[T];

  const candidate =
    angularZoneUnpatchedAlternative(key) ||
    (globalThis[key] as TypeofPrototypeOwner);
  const defaultPrototype = candidate.prototype as BasePrototypeCache[T];

  // use list of testable accessors to check if the prototype is tainted
  const accessorNames =
    key in testableAccessors ? testableAccessors[key] : undefined;
  const isUntaintedAccessors = Boolean(
    accessorNames &&
      // @ts-expect-error 2345
      accessorNames.every((accessor: keyof typeof defaultPrototype) =>
        Boolean(
          Object.getOwnPropertyDescriptor(defaultPrototype, accessor)
            ?.get?.toString()
            .includes('[native code]'),
        ),
      ),
  );

  const methodNames = key in testableMethods ? testableMethods[key] : undefined;
  const isUntaintedMethods = Boolean(
    methodNames &&
      methodNames.every(
        // @ts-expect-error 2345
        (method: keyof typeof defaultPrototype) =>
          typeof defaultPrototype[method] === 'function' &&
          defaultPrototype[method]?.toString().includes('[native code]'),
      ),
  );

  if (isUntaintedAccessors && isUntaintedMethods) {
    untaintedBasePrototype[key] = candidate.prototype as BasePrototypeCache[T];
    return candidate.prototype as BasePrototypeCache[T];
  }

  const iframeEl = document.createElement('iframe');
  try {
    document.body.appendChild(iframeEl);
    const win = iframeEl.contentWindow;
    if (!win) return candidate.prototype as BasePrototypeCache[T];

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
    const untaintedObject = (win as any)[key]
      .prototype as BasePrototypeCache[T];

    if (!untaintedObject) return defaultPrototype;

    return (untaintedBasePrototype[key] = untaintedObject);
  } catch {
    return defaultPrototype;
  } finally {
    if (iframeEl.parentNode) {
      document.body.removeChild(iframeEl);
    }
  }
}

const untaintedAccessorCache: Record<
  string,
  (this: PrototypeOwner, ...args: unknown[]) => unknown
> = {};

export function getUntaintedAccessor<
  K extends keyof BasePrototypeCache,
  T extends keyof BasePrototypeCache[K],
>(
  key: K,
  instance: BasePrototypeCache[K],
  accessor: T,
): BasePrototypeCache[K][T] {
  const cacheKey = `${key}.${String(accessor)}`;
  if (untaintedAccessorCache[cacheKey])
    return untaintedAccessorCache[cacheKey].call(
      instance,
    ) as BasePrototypeCache[K][T];

  const untaintedPrototype = getUntaintedPrototype(key);
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const untaintedAccessor = Object.getOwnPropertyDescriptor(
    untaintedPrototype,
    accessor,
  )?.get;

  if (!untaintedAccessor) return instance[accessor];

  untaintedAccessorCache[cacheKey] = untaintedAccessor;

  return untaintedAccessor.call(instance) as BasePrototypeCache[K][T];
}

type BaseMethod<K extends keyof BasePrototypeCache> = (
  this: BasePrototypeCache[K],
  ...args: unknown[]
) => unknown;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const untaintedMethodCache: Record<string, BaseMethod<any>> = {};
export function getUntaintedMethod<
  K extends keyof BasePrototypeCache,
  T extends keyof BasePrototypeCache[K],
>(
  key: K,
  instance: BasePrototypeCache[K],
  method: T,
): BasePrototypeCache[K][T] {
  const cacheKey = `${key}.${String(method)}`;
  if (untaintedMethodCache[cacheKey])
    return untaintedMethodCache[cacheKey].bind(
      instance,
    ) as BasePrototypeCache[K][T];

  const untaintedPrototype = getUntaintedPrototype(key);
  const untaintedMethod = untaintedPrototype[method];

  if (typeof untaintedMethod !== 'function') return instance[method];

  untaintedMethodCache[cacheKey] = untaintedMethod as BaseMethod<K>;

  return untaintedMethod.bind(instance) as BasePrototypeCache[K][T];
}

export function childNodes(n: Node): NodeListOf<Node> {
  return getUntaintedAccessor('Node', n, 'childNodes');
}

export function parentNode(n: Node): ParentNode | null {
  return getUntaintedAccessor('Node', n, 'parentNode');
}

export function parentElement(n: Node): HTMLElement | null {
  return getUntaintedAccessor('Node', n, 'parentElement');
}

export function textContent(n: Node): string | null {
  return getUntaintedAccessor('Node', n, 'textContent');
}

export function contains(n: Node, other: Node): boolean {
  return getUntaintedMethod('Node', n, 'contains')(other);
}

export function getRootNode(n: Node): Node {
  return getUntaintedMethod('Node', n, 'getRootNode')();
}

export function host(n: ShadowRoot): Element | null {
  if (!n || !('host' in n)) return null;
  return getUntaintedAccessor('ShadowRoot', n, 'host');
}

export function styleSheets(n: ShadowRoot): StyleSheetList {
  return n.styleSheets;
}

export function shadowRoot(n: Node): ShadowRoot | null {
  if (!n || !('shadowRoot' in n)) return null;
  return getUntaintedAccessor('Element', n as Element, 'shadowRoot');
}

export function querySelector(n: Element, selectors: string): Element | null {
  return getUntaintedMethod('Element', n, 'querySelector')(selectors);
}

export function querySelectorAll(
  n: Element,
  selectors: string,
): NodeListOf<Element> {
  return getUntaintedMethod('Element', n, 'querySelectorAll')(selectors);
}

export function mutationObserverCtor(): (typeof MutationObserver)['prototype']['constructor'] {
  return getUntaintedPrototype('MutationObserver').constructor;
}

// Each call to `patch` installs a "layer" in the wrapper chain. A wrapper calls
// down through its layer's mutable `next` reference rather than closing over the
// original directly, so that any layer can later be spliced out of the chain —
// even when newer wrappers sit on top of it.
//
// Without this, restoring a patch only worked when it was still on top of the
// chain (`source[name] === wrapped`). rrweb patches shared globals such as
// `Element.prototype.attachShadow` (shadow-dom-manager) and the observers, and
// multiple recorder instances or repeated start/stop cycles wrap the same global
// more than once. Restores then routinely ran out of order and silently no-op'd.
// Each leaked wrapper stayed in the call path, and repeated cycles grew the chain
// without bound until a real call walked a chain deep enough to overflow the call
// stack ("RangeError: Maximum call stack size exceeded").
interface PatchLayer {
  next: (...args: unknown[]) => unknown;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isFunction(value: any): value is (...args: any[]) => any {
  return typeof value === 'function';
}

// copy from https://github.com/getsentry/sentry-javascript/blob/b2109071975af8bf0316d3b5b38f519bdaf5dc15/packages/utils/src/object.ts
export function patch(
  source: { [key: string]: any },
  name: string,
  replacement: (...args: unknown[]) => unknown,
): () => void {
  try {
    if (!(name in source)) {
      return () => {
        //
      };
    }

    const original = source[name] as (...args: unknown[]) => unknown;

    const layer: PatchLayer = {
      next: original,
    };

    // The wrapper receives this stable delegate instead of `original`, so the
    // function it actually calls can be re-pointed when a lower layer is removed.
    const callNext = function (this: unknown, ...args: unknown[]) {
      return layer.next.apply(this, args);
    };

    const wrapped = replacement(callNext);

    // Make sure it's a function first, as we need to attach an empty prototype for `defineProperties` to work
    // otherwise it'll throw "TypeError: Object.defineProperties called on non-object"
    if (typeof wrapped === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      wrapped.prototype = wrapped.prototype || {};
      Object.defineProperties(wrapped, {
        __rrweb_original__: {
          enumerable: false,
          value: original,
        },
        __rrweb_layer__: {
          enumerable: false,
          value: layer,
        },
      });
    }

    source[name] = wrapped;

    return () => {
      // If we're still on top, hand back whatever we currently delegate to
      // (lower layers may already have been removed, so this is not necessarily
      // the `original` we captured at install time).
      if (source[name] === wrapped) {
        source[name] = layer.next;
        return;
      }

      // Otherwise newer wrappers sit on top of us. Find the rrweb layer directly
      // above us and re-point it past us, removing our wrapper from the call path
      // without disturbing the newer wrappers.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let current: any = source[name];
      while (isFunction(current) && (current as any).__rrweb_layer__) {
        const currentLayer = (current as any).__rrweb_layer__ as PatchLayer;
        if (currentLayer.next === wrapped) {
          currentLayer.next = layer.next;
          return;
        }
        current = currentLayer.next;
      }

      // If we get here we're buried under a non-rrweb wrapper that closed over
      // us directly, or we've already been removed / replaced wholesale. There's
      // nothing safe to do, so leave the chain untouched.
    };
  } catch {
    return () => {
      //
    };
    // This can throw when multiple instrumentation layers try to wrap the same global object,
    // such as XMLHttpRequest, and redefine the same non-configurable wrapper marker.
  }
}

export default {
  childNodes,
  parentNode,
  parentElement,
  textContent,
  contains,
  getRootNode,
  host,
  styleSheets,
  shadowRoot,
  querySelector,
  querySelectorAll,
  mutationObserver: mutationObserverCtor,
  patch,
};
