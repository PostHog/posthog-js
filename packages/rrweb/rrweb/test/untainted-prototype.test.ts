/**
 * @vitest-environment jsdom
 */

// getUntaintedPrototype falls back to pulling prototypes out of a temporary
// same-origin iframe when the page's globals have been monkey-patched. On
// WebKit/Safari a detached iframe's ScriptExecutionContext is torn down and
// MutationObserver.deliver() silently drops callbacks (webkit.org/b/179224),
// so on WebKit the iframe must stay attached for the lifetime of the page.
// Ported from upstream rrweb #1854.
//
// In jsdom no prototype method has a native-code toString, so every call takes
// the iframe fallback path, which is exactly the path under test.

const SAFARI_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const WKWEBVIEW_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', {
    value: ua,
    configurable: true,
  });
}

function keepaliveIframes(): HTMLIFrameElement[] {
  return Array.from(
    document.querySelectorAll('iframe[__rrwebUntaintedPrototype]'),
  );
}

async function freshGetUntaintedPrototype() {
  // the untainted prototype cache is module state, so each test needs a
  // fresh module instance
  vi.resetModules();
  const module = await import('@posthog/rrweb-utils');
  return module.getUntaintedPrototype;
}

describe('untainted accessor cache', () => {
  let utils: typeof import('@posthog/rrweb-utils');

  beforeEach(async () => {
    setUserAgent(CHROME_UA);
    vi.resetModules();
    utils = await import('@posthog/rrweb-utils');
  });

  afterEach(() => {
    document.querySelectorAll('iframe').forEach((iframe) => iframe.remove());
    vi.restoreAllMocks();
  });

  it('does not stringify cache keys on every DOM access', () => {
    const parent = document.createElement('div');
    const child = document.createElement('span');
    parent.append(child);
    // Warm the native getter cache before measuring per-node work.
    utils.childNodes(parent);
    utils.parentNode(child);
    const stringify = vi.spyOn(globalThis, 'String');
    for (let i = 0; i < 100; i++) {
      expect(utils.childNodes(parent)[0]).toBe(child);
      expect(utils.parentNode(child)).toBe(parent);
    }
    expect(
      stringify.mock.calls.filter(
        ([key]) => key === 'childNodes' || key === 'parentNode',
      ),
    ).toHaveLength(0);
  });

  it('caches getters, not DOM values or their receiver', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    const child = document.createTextNode('first');
    a.append(child);
    expect(utils.parentNode(child)).toBe(a);
    expect(utils.textContent(a)).toBe('first');
    expect(utils.childNodes(a).length).toBe(1);
    b.append(child);
    child.textContent = 'second';
    expect(utils.parentNode(child)).toBe(b);
    expect(utils.textContent(a)).toBe('');
    expect(utils.textContent(b)).toBe('second');
    expect(utils.childNodes(a).length).toBe(0);
    expect(utils.childNodes(b)[0]).toBe(child);
  });

  it('still bypasses a patched getter after the native accessor is cached', () => {
    const parent = document.createElement('div');
    const child = document.createElement('span');
    parent.append(child);
    expect(utils.childNodes(parent)[0]).toBe(child);
    const patched = vi.spyOn(parent, 'childNodes', 'get').mockImplementation(() => {
      throw new Error('patched childNodes must not run');
    });
    expect(utils.childNodes(parent)[0]).toBe(child);
    expect(patched).not.toHaveBeenCalled();
  });

  it('keeps Node, Element and ShadowRoot accessor caches separate', () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const child = document.createElement('span');
    shadow.append(child);
    for (let i = 0; i < 2; i++) {
      expect(utils.shadowRoot(host)).toBe(shadow);
      expect(utils.host(shadow)).toBe(host);
      expect(utils.parentNode(child)).toBe(shadow);
      expect(utils.parentElement(child)).toBeNull();
      expect(utils.childNodes(host).length).toBe(0);
      expect(utils.childNodes(shadow)[0]).toBe(child);
    }
  });

  it('retains the instance fallback for properties without a getter', () => {
    const element = document.createElement('div');
    // Object.prototype properties must not look like cached DOM accessors.
    expect(utils.getUntaintedAccessor('Node', element, 'toString')).toBe(
      element.toString,
    );
    expect(utils.getUntaintedAccessor('Node', element, 'constructor')).toBe(
      element.constructor,
    );
  });
});

describe('getUntaintedPrototype iframe fallback', () => {
  afterEach(() => {
    document
      .querySelectorAll('iframe')
      .forEach((iframe) => iframe.remove());
    vi.restoreAllMocks();
  });

  it('removes the fallback iframe on non-WebKit browsers', async () => {
    setUserAgent(CHROME_UA);
    const getUntaintedPrototype = await freshGetUntaintedPrototype();

    const prototype = getUntaintedPrototype('MutationObserver');

    expect(prototype).toBeDefined();
    expect(document.querySelectorAll('iframe').length).toBe(0);
  });

  it('keeps the fallback iframe attached on Safari so its context stays live', async () => {
    setUserAgent(SAFARI_UA);
    const getUntaintedPrototype = await freshGetUntaintedPrototype();

    const prototype = getUntaintedPrototype('MutationObserver');

    expect(prototype).toBeDefined();
    const iframes = keepaliveIframes();
    expect(iframes.length).toBe(1);
    expect(iframes[0].getAttribute('__rrwebUntaintedPrototype')).toBe(
      'MutationObserver',
    );
  });

  it('keeps the fallback iframe attached in WKWebView', async () => {
    setUserAgent(WKWEBVIEW_UA);
    const getUntaintedPrototype = await freshGetUntaintedPrototype();

    const prototype = getUntaintedPrototype('MutationObserver');

    expect(prototype).toBeDefined();
    expect(keepaliveIframes().length).toBe(1);
  });

  it('hides the kept iframe and blocks it from being recorded', async () => {
    setUserAgent(SAFARI_UA);
    const getUntaintedPrototype = await freshGetUntaintedPrototype();

    getUntaintedPrototype('MutationObserver');

    const iframe = keepaliveIframes()[0];
    expect(iframe.style.display).toBe('none');
    // upstream rrweb default block class and the PostHog default, so the
    // recorder skips this iframe whichever config is in use
    expect(iframe.classList.contains('rr-block')).toBe(true);
    expect(iframe.classList.contains('ph-no-capture')).toBe(true);
  });

  it('reuses the cached prototype instead of attaching more iframes', async () => {
    setUserAgent(SAFARI_UA);
    const getUntaintedPrototype = await freshGetUntaintedPrototype();

    const first = getUntaintedPrototype('MutationObserver');
    const second = getUntaintedPrototype('MutationObserver');

    expect(second).toBe(first);
    expect(keepaliveIframes().length).toBe(1);
  });

  it('returns a usable MutationObserver constructor from the kept iframe', async () => {
    setUserAgent(SAFARI_UA);
    const getUntaintedPrototype = await freshGetUntaintedPrototype();

    const prototype = getUntaintedPrototype('MutationObserver');
    const observer = new (prototype.constructor as new (
      callback: MutationCallback,
    ) => MutationObserver)(() => {});

    expect(observer.observe).toBeDefined();
    observer.observe(document.body, { childList: true, subtree: true });
    observer.disconnect();
  });
});
