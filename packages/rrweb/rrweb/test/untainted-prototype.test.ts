/**
 * @vitest-environment jsdom
 */

// getUntaintedPrototype falls back to pulling prototypes out of a temporary
// same-origin iframe when the page's globals have been monkey-patched. On
// WebKit/Safari a detached iframe's ScriptExecutionContext is torn down and
// MutationObserver.deliver() silently drops callbacks (webkit.org/b/179224),
// so on Safari the iframe must stay attached for the lifetime of the page.
// Ported from upstream rrweb #1854.
//
// In jsdom no prototype method has a native-code toString, so every call takes
// the iframe fallback path, which is exactly the path under test.

const SAFARI_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
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

describe('getUntaintedPrototype iframe fallback', () => {
  afterEach(() => {
    document
      .querySelectorAll('iframe')
      .forEach((iframe) => iframe.remove());
    vi.restoreAllMocks();
  });

  it('removes the fallback iframe on non-Safari browsers', async () => {
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
