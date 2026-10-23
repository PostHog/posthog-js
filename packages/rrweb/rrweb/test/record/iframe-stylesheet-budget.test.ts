import * as path from 'path';
import type { Browser, HTTPRequest, Page } from 'puppeteer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  EventType,
  IncrementalSource,
  type eventWithTime,
  type mutationData,
} from '@posthog/rrweb-types';
import type { Replayer } from '../../src/replay';
import type { recordOptions } from '../../src/types';
import { launchPuppeteer, waitForCondition } from '../utils';

const ORIGIN = 'http://app.example.test';
const BUDGET_RULES = 300;
const SMALL_SHEET_RULES = 100;
const BIG_SHEET_RULES = 1200;
const RECREATIONS = 3;

const sheet = (prefix: string, rules: number) =>
  Array.from(
    { length: rules },
    (_, i) => `.${prefix}-${i} { color: rgb(${i % 256}, 0, 0); }`,
  ).join('\n');

// Counts native cssText reads in the iframe's own realm: the recorder
// stringifies rules through the iframe's CSSRule prototype, not the host's.
const frameHtml = `<!doctype html><html><head>
<script>
  (function () {
    var desc = Object.getOwnPropertyDescriptor(CSSRule.prototype, 'cssText');
    Object.defineProperty(CSSRule.prototype, 'cssText', {
      configurable: true,
      get: function () {
        parent.__cssTextReads = (parent.__cssTextReads || 0) + 1;
        return desc.get.call(this);
      },
    });
  })();
</script>
<link rel="stylesheet" href="/small.css">
<link rel="stylesheet" href="/big.css">
</head><body><div id="viewer">frame content</div></body></html>`;

async function serveApp(page: Page) {
  await page.setRequestInterception(true);
  page.on('request', (request: HTTPRequest) => {
    const { pathname } = new URL(request.url());
    const respond = (contentType: string, body: string) =>
      void request.respond({ status: 200, contentType, body });
    if (pathname === '/app.html') {
      respond('text/html', '<!doctype html><html><body></body></html>');
    } else if (pathname === '/frame.html') {
      respond('text/html', frameHtml);
    } else if (pathname === '/small.css') {
      respond('text/css', sheet('small', SMALL_SHEET_RULES));
    } else if (pathname === '/big.css') {
      respond('text/css', sheet('big', BIG_SHEET_RULES));
    } else {
      void request.abort();
    }
  });
  await page.goto(`${ORIGIN}/app.html`);
  await page.addScriptTag({
    path: path.resolve(__dirname, '../../dist/rrweb.umd.cjs'),
  });
}

type PageState = {
  events: eventWithTime[];
  readsAtAttach: number[];
  __cssTextReads?: number;
};

const isAttachIframe = (e: eventWithTime) =>
  e.type === EventType.IncrementalSnapshot &&
  e.data.source === IncrementalSource.Mutation &&
  Boolean((e.data as mutationData).isAttachIframe);

describe('same-origin iframe document stylesheet budget', () => {
  vi.setConfig({ testTimeout: 60_000 });
  let browser: Browser;

  beforeAll(async () => {
    browser = await launchPuppeteer();
  });
  afterAll(async () => {
    await browser?.close();
  });

  it('bounds stylesheet work on every iframe re-creation and still records the deferred sheet', async () => {
    const page = await browser.newPage();
    try {
      await serveApp(page);
      await page.evaluate((budget) => {
        const state = window as unknown as PageState;
        state.events = [];
        state.readsAtAttach = [];
        const { rrweb } = window as unknown as {
          rrweb: {
            record: (o: recordOptions<eventWithTime>) => () => void;
          };
        };
        (window as unknown as { stopRecording: () => void }).stopRecording =
          rrweb.record({
            emit: (event) => {
              const data = (event as { data?: Partial<mutationData> }).data;
              if (data?.isAttachIframe) {
                // the iframe document's serialization has just finished, and
                // nothing deferred has run yet
                state.readsAtAttach.push(state.__cssTextReads || 0);
              }
              state.events.push(event);
            },
            inlineStylesheetBudgetRules: budget,
          });
      }, BUDGET_RULES);

      const syncReads: number[] = [];
      for (let i = 0; i < RECREATIONS; i++) {
        const readsBefore = await page.evaluate(() => {
          document.querySelector('iframe')?.remove();
          const frame = document.createElement('iframe');
          frame.src = '/frame.html';
          document.body.appendChild(frame);
          return (window as unknown as PageState).__cssTextReads || 0;
        });
        const readsAtAttach = await waitForCondition(
          () =>
            page.evaluate(
              (n) => (window as unknown as PageState).readsAtAttach[n],
              i,
            ),
          { timeout: 10_000 },
        );
        syncReads.push(readsAtAttach - readsBefore);
        expect(syncReads[i]).toBeLessThanOrEqual(BUDGET_RULES);

        // the big sheet still reaches the recording, from idle time
        await waitForCondition(
          () =>
            page.evaluate((marker) => {
              const { events } = window as unknown as PageState;
              const attaches = events.filter(
                (e) =>
                  e.type === 3 &&
                  (e.data as { isAttachIframe?: boolean }).isAttachIframe,
              );
              const attachIndex = events.indexOf(attaches[attaches.length - 1]);
              return events
                .slice(attachIndex)
                .some(
                  (e) =>
                    e.type === 3 &&
                    (e.data as mutationData).source === 0 &&
                    (e.data as mutationData).attributes?.some((a) =>
                      String(a.attributes._cssText || '').includes(marker),
                    ),
                );
            }, '.big-0'),
          { timeout: 10_000 },
        );
      }

      // only the small sheet fits the budget; the big one is never stringified
      // inside the iframe-load task
      expect(syncReads).toEqual(Array(RECREATIONS).fill(SMALL_SHEET_RULES));

      await page.evaluate(() => {
        const frameDoc = document.querySelector('iframe')!.contentDocument!;
        const inFrame = frameDoc.createElement('p');
        inFrame.id = 'after-frame';
        inFrame.textContent = 'added in frame';
        frameDoc.body.appendChild(inFrame);
        const inHost = document.createElement('p');
        inHost.id = 'after-host';
        inHost.textContent = 'added in host';
        document.body.appendChild(inHost);
      });
      await waitForCondition(() =>
        page.evaluate(() =>
          JSON.stringify((window as unknown as PageState).events).includes(
            'added in host',
          ),
        ),
      );

      const replayed = await page.evaluate(() => {
        (window as unknown as { stopRecording: () => void }).stopRecording();
        const { events } = window as unknown as PageState;
        const { rrweb } = window as unknown as {
          rrweb: { Replayer: typeof Replayer };
        };
        const root = document.createElement('div');
        document.body.appendChild(root);
        const replayer = new rrweb.Replayer(events, {
          root,
          mouseTail: false,
        });
        replayer.pause(
          events[events.length - 1].timestamp - events[0].timestamp + 1,
        );
        const hostDoc = replayer.iframe.contentDocument!;
        const frames = hostDoc.querySelectorAll('iframe');
        const frameDoc = frames[frames.length - 1]?.contentDocument;
        const styles = Array.from(frameDoc?.querySelectorAll('style') || []);
        const result = {
          frameCount: frames.length,
          frameText: frameDoc?.getElementById('after-frame')?.textContent,
          viewerText: frameDoc?.getElementById('viewer')?.textContent,
          hostText: hostDoc.getElementById('after-host')?.textContent,
          smallSheetInlined: styles.some((s) =>
            (s.textContent || '').includes('.small-0'),
          ),
          bigSheetInlined: styles.some((s) =>
            (s.textContent || '').includes(`.big-1199`),
          ),
        };
        replayer.destroy();
        return result;
      });

      expect(replayed).toEqual({
        frameCount: 1,
        frameText: 'added in frame',
        viewerText: 'frame content',
        hostText: 'added in host',
        smallSheetInlined: true,
        bigSheetInlined: true,
      });

      const attaches = (
        await page.evaluate(() => (window as unknown as PageState).events)
      ).filter(isAttachIframe);
      expect(attaches).toHaveLength(RECREATIONS);
    } finally {
      await page.close();
    }
  });
});
