// @vitest-environment jsdom

let dom: typeof import('@posthog/rrweb-utils');
let utils: typeof import('../../src/utils');

beforeEach(async () => {
  vi.resetModules();
  dom = await import('@posthog/rrweb-utils');
  utils = await import('../../src/utils');
  // JSDOM getters are implemented in JS. Model a native getter for the fast-path
  // unit tests; the built-SDK browser cases exercise real native/tainted getters.
  const getter = Object.getOwnPropertyDescriptor(
    dom.getUntaintedPrototype('Node'),
    'isConnected',
  )?.get;
  if (getter) {
    vi.spyOn(getter, 'toString').mockReturnValue(
      'function get isConnected() { [native code] }',
    );
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function legacyInDom(node: Node) {
  const doc = node.ownerDocument;
  return !!doc && (dom.contains(doc, node) || utils.shadowHostInDom(node));
}

describe('DOM connectivity', () => {
  it('avoids repeated containment and shadow-host walks', () => {
    const host = document.createElement('div');
    const light = document.createTextNode('light');
    const shadow = host.attachShadow({ mode: 'open' });
    const innerHost = document.createElement('div');
    const innerShadow = innerHost.attachShadow({ mode: 'closed' });
    const text = document.createTextNode('shadow');
    innerShadow.append(text);
    shadow.append(innerHost);
    host.append(light);
    document.body.append(host);
    const nodes = [host, light, text];
    nodes.forEach((node) => expect(utils.inDom(node)).toBe(true));
    const contains = vi.spyOn(dom.default, 'contains');
    const getRootNode = vi.spyOn(dom.default, 'getRootNode');
    for (let i = 0; i < 100; i++) {
      nodes.forEach((node) => expect(utils.inDom(node)).toBe(true));
    }
    expect({
      containment: contains.mock.calls.length,
      roots: getRootNode.mock.calls.length,
    }).toEqual({ containment: 300, roots: 0 });
  });

  it.each(['open', 'closed'] as const)(
    'matches the existing check through %s shadow moves and adoption',
    (mode) => {
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode });
      const text = document.createTextNode('content');
      shadow.append(text);
      function check(expected: boolean) {
        for (const node of [host, shadow, text]) {
          expect(utils.inDom(node)).toBe(expected);
          expect(utils.inDom(node)).toBe(legacyInDom(node));
        }
      }
      check(false);
      document.body.append(host);
      check(true);
      host.remove();
      check(false);
      const otherDoc = document.implementation.createHTMLDocument('other');
      otherDoc.adoptNode(host);
      check(false);
      otherDoc.body.append(host);
      check(true);
      document.body.append(host);
      check(true);
    },
  );

  it('preserves ownership semantics for documents and iframe contents', () => {
    expect(utils.inDom(document)).toBe(false);
    const iframe = document.createElement('iframe');
    document.body.append(iframe);
    const child = iframe.contentDocument!.createElement('span');
    iframe.contentDocument!.body.append(child);
    expect(utils.inDom(child)).toBe(true);
    iframe.remove();
    // Connected to its own Document is not the same as rendered in the top page.
    expect(utils.inDom(child)).toBe(legacyInDom(child));
    const fragment = document.createDocumentFragment();
    fragment.append(child);
    expect(utils.inDom(child)).toBe(false);
  });

  it('bypasses a patched instance connectivity getter', () => {
    const element = document.createElement('div');
    document.body.append(element);
    expect(utils.inDom(element)).toBe(true);
    const patched = vi
      .spyOn(element, 'isConnected', 'get')
      .mockImplementation(() => {
        throw new Error('patched getter must not run');
      });
    expect(utils.inDom(element)).toBe(true);
    element.remove();
    expect(utils.inDom(element)).toBe(false);
    expect(patched).not.toHaveBeenCalled();
  });

  it('falls back if the cached prototype is patched before first use', () => {
    const getter = vi.fn(() => false);
    Object.defineProperty(dom.getUntaintedPrototype('Node'), 'isConnected', {
      get: getter,
      configurable: true,
    });
    const host = document.createElement('div');
    const child = document.createTextNode('content');
    host.attachShadow({ mode: 'closed' }).append(child);
    document.body.append(host);
    const roots = vi.spyOn(dom.default, 'getRootNode');
    expect(utils.inDom(child)).toBe(true);
    expect(roots).toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
    host.remove();
    expect(utils.inDom(child)).toBe(false);
  });

  it('keeps the native function, not a cached connectivity value', () => {
    const host = document.createElement('div');
    const child = document.createTextNode('content');
    host.attachShadow({ mode: 'open' }).append(child);
    document.body.append(host);
    expect(utils.inDom(child)).toBe(true);
    const getter = vi.fn(() => false);
    Object.defineProperty(dom.getUntaintedPrototype('Node'), 'isConnected', {
      get: getter,
      configurable: true,
    });
    expect(utils.inDom(child)).toBe(true);
    host.remove();
    expect(utils.inDom(child)).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });

  it('retains the old walk when connectivity is unavailable', () => {
    const prototype = dom.getUntaintedPrototype('Node');
    Object.defineProperty(prototype, 'isConnected', {
      value: undefined,
      configurable: true,
    });
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'closed' });
    const child = document.createTextNode('content');
    shadow.append(child);
    for (const node of [host, shadow, child]) {
      Object.defineProperty(node, 'isConnected', {
        value: undefined,
        configurable: true,
      });
    }
    document.body.append(host);
    const contains = vi.spyOn(dom.default, 'contains');
    const roots = vi.spyOn(dom.default, 'getRootNode');
    expect(utils.inDom(child)).toBe(true);
    expect(contains).toHaveBeenCalled();
    expect(roots).toHaveBeenCalled();
    host.remove();
    expect(utils.inDom(child)).toBe(false);
  });
});
