import * as path from 'path';
import type * as http from 'http';
import type * as puppeteer from 'puppeteer';
import type { recordOptions } from '../../src/types';
import type { eventWithTime, listenerHandler } from '@posthog/rrweb-types';
import {
  getServerURL,
  launchPuppeteer,
  startServer,
  waitForRAF,
} from '../utils';

interface IWindow extends Window {
  rrweb: {
    record: (
      options: recordOptions<eventWithTime>,
    ) => listenerHandler | undefined;
  };
  emit?: (e: eventWithTime) => undefined;
}

type IframeOrigin = 'same-origin' | 'cross-origin';
type BlockingOptions = Pick<recordOptions<eventWithTime>, 'blockSelector'>;

const INITIAL_CONTENT = 'initial-iframe-content';
const LATER_CONTENT = 'later-iframe-content';

describe('record a blocked iframe', () => {
  let browser: puppeteer.Browser;
  let server: http.Server;

  beforeAll(async () => {
    browser = await launchPuppeteer();
    server = await startServer();
  });

  afterAll(async () => {
    await browser?.close();
    server?.close();
  });

  const appendParagraph = (frame: puppeteer.Frame, text: string) =>
    frame.evaluate((text) => {
      const paragraph = document.createElement('p');
      paragraph.textContent = text;
      document.body.appendChild(paragraph);
    }, text);

  const startRecording = async (
    frame: puppeteer.Frame,
    options: recordOptions<eventWithTime>,
  ) => {
    await frame.addScriptTag({
      path: path.resolve(__dirname, '../../dist/rrweb.umd.cjs'),
    });
    await frame.evaluate((options) => {
      const { rrweb, emit } = window as unknown as IWindow;
      // only the top frame has `emit`, a child frame relays to its parent
      rrweb.record({ ...options, emit: (event) => emit?.(event) });
    }, options);
  };

  const recordPageWithIframe = async (
    iframeOrigin: IframeOrigin,
    iframeAttributes: string,
    blockingOptions: BlockingOptions,
  ): Promise<string> => {
    const isCrossOrigin = iframeOrigin === 'cross-origin';
    // the page is about:blank, so an iframe served over http is cross-origin
    const src = isCrossOrigin
      ? `src="${getServerURL(server)}/html/blank.html"`
      : '';
    const page = await browser.newPage();
    try {
      await page.goto('about:blank');
      await page.setContent(
        `<!DOCTYPE html><html><body>
          <iframe ${iframeAttributes} ${src}></iframe>
        </body></html>`,
        { waitUntil: 'load' },
      );
      const [topFrame, iframeFrame] = page.frames();
      await appendParagraph(iframeFrame, INITIAL_CONTENT);

      const events: eventWithTime[] = [];
      await page.exposeFunction('emit', (e: eventWithTime) => {
        events.push(e);
      });
      const options = {
        ...blockingOptions,
        recordCrossOriginIframes: isCrossOrigin,
      };
      await startRecording(topFrame, options);
      if (isCrossOrigin) {
        await startRecording(iframeFrame, options);
      }
      await waitForRAF(page);

      await appendParagraph(iframeFrame, LATER_CONTENT);
      await waitForRAF(page);

      return JSON.stringify(events);
    } finally {
      await page.close();
    }
  };

  const blockingCases = [
    {
      blocking: 'the block class',
      iframeAttributes: 'class="rr-block"',
      blockingOptions: {},
      isRecorded: false,
    },
    {
      blocking: 'the block selector',
      iframeAttributes: 'data-private',
      blockingOptions: { blockSelector: '[data-private]' },
      isRecorded: false,
    },
    {
      blocking: 'no blocking',
      iframeAttributes: '',
      blockingOptions: {},
      isRecorded: true,
    },
  ];

  it.each(
    (['same-origin', 'cross-origin'] as const).flatMap((iframeOrigin) =>
      blockingCases.map((blockingCase) => ({ iframeOrigin, ...blockingCase })),
    ),
  )(
    'a $iframeOrigin iframe with $blocking has its document recorded: $isRecorded',
    async ({ iframeOrigin, iframeAttributes, blockingOptions, isRecorded }) => {
      const recorded = await recordPageWithIframe(
        iframeOrigin,
        iframeAttributes,
        blockingOptions,
      );

      expect({
        initialContent: recorded.includes(INITIAL_CONTENT),
        laterContent: recorded.includes(LATER_CONTENT),
      }).toEqual({ initialContent: isRecorded, laterContent: isRecorded });
    },
  );

  it.each(['same-origin', 'cross-origin'] as const)(
    'a %s iframe is in the first snapshot when the block selector is invalid',
    async (iframeOrigin) => {
      const recorded = await recordPageWithIframe(iframeOrigin, '', {
        blockSelector: '[',
      });

      expect(recorded).toContain(INITIAL_CONTENT);
    },
  );
});
