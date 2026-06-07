import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

const safariUA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15';
const chromeUA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

class HijackedMutationObserver {
  constructor(_callback: MutationCallback) {}
  observe() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

async function loadUtils(userAgent: string) {
  vi.resetModules();
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost',
  });
  const { window } = dom;
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', window.document);
  vi.stubGlobal('navigator', { userAgent });
  vi.stubGlobal(
    'MutationObserver',
    HijackedMutationObserver as unknown as typeof MutationObserver,
  );

  return import('@posthog/rrweb-utils');
}

describe('untainted MutationObserver iframe', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('keeps the iframe attached on Safari', async () => {
    const utils = await loadUtils(safariUA);
    utils.mutationObserverCtor();

    const iframe = document.querySelector('iframe.rr-block');
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute('__rrwebUntaintedMutationObserver')).toBe('');

    utils.cleanupUntaintedIframe();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('removes the iframe immediately on non-Safari browsers', async () => {
    const utils = await loadUtils(chromeUA);
    utils.mutationObserverCtor();

    expect(document.querySelector('iframe')).toBeNull();
    utils.cleanupUntaintedIframe();
  });
});
