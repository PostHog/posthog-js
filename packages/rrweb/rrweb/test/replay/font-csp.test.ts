import * as fs from 'fs';
import * as path from 'path';
import type { Browser, HTTPRequest, Page } from 'puppeteer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EventType,
  IncrementalSource,
  type eventWithTime,
} from '@posthog/rrweb-types';
import { NodeType } from '@posthog/rrweb-snapshot';
import type { Replayer } from '../../src/replay';
import { launchPuppeteer } from '../utils';

const APP_ORIGIN = 'http://app.example.test';
const FONT_URL = 'http://fonts.example.test/replay-test-font.ttf';
const FAMILY = 'ReplayTestFont';

const fontBytes = fs.readFileSync(
  path.resolve(__dirname, '../html/assets/replay-test-font.ttf'),
);

const events = (fontSource: string, buffer: boolean): eventWithTime[] => [
  {
    type: EventType.Meta,
    data: { href: 'http://recorded.example.test/', width: 800, height: 600 },
    timestamp: 1000,
  },
  {
    type: EventType.FullSnapshot,
    data: {
      node: {
        type: NodeType.Document,
        id: 1,
        childNodes: [
          {
            type: NodeType.Element,
            id: 2,
            tagName: 'html',
            attributes: {},
            childNodes: [
              {
                type: NodeType.Element,
                id: 3,
                tagName: 'head',
                attributes: {},
                childNodes: [],
              },
              {
                type: NodeType.Element,
                id: 4,
                tagName: 'body',
                attributes: {},
                childNodes: [{ type: NodeType.Text, id: 5, textContent: 'A' }],
              },
            ],
          },
        ],
      },
      initialOffset: { top: 0, left: 0 },
    },
    timestamp: 1000,
  },
  {
    type: EventType.IncrementalSnapshot,
    data: {
      source: IncrementalSource.Font,
      family: FAMILY,
      fontSource,
      buffer,
      descriptors: {},
    },
    timestamp: 1100,
  },
];

// The embedding page refuses external fonts. rrweb is mounted in a frame whose
// own policy allows them, the way an app keeps recorded content off its policy.
async function serveEmbeddingApp(page: Page, fontRequests: string[]) {
  await page.setRequestInterception(true);
  page.on('request', (request: HTTPRequest) => {
    const url = request.url();
    if (url === `${APP_ORIGIN}/app.html`) {
      void request.respond({
        status: 200,
        contentType: 'text/html',
        headers: { 'Content-Security-Policy': "font-src 'self'" },
        body: '<!doctype html><html><body></body></html>',
      });
    } else if (url === `${APP_ORIGIN}/frame.html`) {
      void request.respond({
        status: 200,
        contentType: 'text/html',
        headers: { 'Content-Security-Policy': 'font-src *' },
        body: '<!doctype html><html><body><div id="root"></div></body></html>',
      });
    } else if (url === FONT_URL) {
      fontRequests.push(url);
      void request.respond({
        status: 200,
        contentType: 'font/ttf',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: fontBytes,
      });
    } else {
      void request.abort();
    }
  });
  await page.goto(`${APP_ORIGIN}/app.html`);
  await page.addScriptTag({
    path: path.resolve(__dirname, '../../dist/rrweb.umd.cjs'),
  });
}

describe('replaying a font event', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await launchPuppeteer();
  });
  afterAll(async () => {
    await browser?.close();
  });

  it.each([
    {
      name: 'from a URL',
      fontSource: `url("${FONT_URL}")`,
      buffer: false,
      fetchesFont: true,
    },
    {
      name: 'from a buffer',
      fontSource: JSON.stringify(Array.from(fontBytes)),
      buffer: true,
      fetchesFont: false,
    },
  ])(
    'loads a font $name under the policy of the frame rrweb is mounted in',
    async ({ fontSource, buffer, fetchesFont }) => {
      const page = await browser.newPage();
      const fontRequests: string[] = [];
      try {
        await serveEmbeddingApp(page, fontRequests);
        const status = await page.evaluate(
          async ({ events, family }) => {
            const frame = document.createElement('iframe');
            frame.src = '/frame.html';
            await new Promise((resolve) => {
              frame.onload = resolve;
              document.body.appendChild(frame);
            });

            const { rrweb } = window as unknown as {
              rrweb: { Replayer: typeof Replayer };
            };
            const replayer = new rrweb.Replayer(events, {
              root: frame.contentDocument!.getElementById('root')!,
              mouseTail: false,
            });
            replayer.pause(200);

            const fontFace = [
              ...replayer.iframe.contentDocument!.fonts,
            ].find((f) => f.family === family);
            await fontFace?.load().catch(() => undefined);
            replayer.destroy();
            return fontFace?.status;
          },
          { events: events(fontSource, buffer), family: FAMILY },
        );

        expect(status).toBe('loaded');
        expect(fontRequests).toEqual(fetchesFont ? [FONT_URL] : []);
      } finally {
        await page.close();
      }
    },
  );
});
