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
    record: ((
      options: recordOptions<eventWithTime>,
    ) => listenerHandler | undefined) & {
      takeFullSnapshot: (isCheckout?: boolean) => void;
    };
  };
  emit?: (e: eventWithTime) => undefined;
}

type IframeOrigin = 'same-origin' | 'cross-origin';
type BlockingOptions = Pick<recordOptions<eventWithTime>, 'blockSelector'>;

const INITIAL_CONTENT = 'initial-iframe-content';
const LATER_CONTENT = 'later-iframe-content';
const NAVIGATED_CONTENT = 'navigated-iframe-content';

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

  const blockLaterCases = [
    {
      blocking: 'the block class',
      block: 'class',
      blockingOptions: {},
    },
    {
      blocking: 'the block selector',
      block: 'attribute',
      blockingOptions: { blockSelector: '[data-private]' },
    },
    {
      blocking: 'a blocked parent',
      block: 'parent',
      blockingOptions: {},
    },
    {
      blocking: 'a selector that matches through a sibling',
      block: 'sibling',
      blockingOptions: { blockSelector: '.private + iframe' },
    },
  ] as const;

  it.each(
    (['same-origin', 'cross-origin'] as const).flatMap((iframeOrigin) =>
      blockLaterCases.flatMap((blockCase) =>
        [false, true].map((takeFullSnapshot) => ({
          iframeOrigin,
          takeFullSnapshot,
          ...blockCase,
        })),
      ),
    ),
  )(
    'a $iframeOrigin iframe that gets $blocking stops being recorded (full snapshot: $takeFullSnapshot)',
    async ({ iframeOrigin, block, blockingOptions, takeFullSnapshot }) => {
      const isCrossOrigin = iframeOrigin === 'cross-origin';
      const src = isCrossOrigin
        ? `src="${getServerURL(server)}/html/blank.html"`
        : '';
      const page = await browser.newPage();
      try {
        await page.goto('about:blank');
        await page.setContent(
          `<!DOCTYPE html><html><body>
            <div id="parent"><span id="sibling"></span><iframe ${src}></iframe></div>
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
        expect(JSON.stringify(events)).toContain(INITIAL_CONTENT);
        const eventsBeforeBlocking = events.length;

        await topFrame.evaluate(
          (block, takeFullSnapshot) => {
            const iframe = document.querySelector('iframe')!;
            if (block === 'class') iframe.classList.add('rr-block');
            if (block === 'attribute') iframe.setAttribute('data-private', '');
            if (block === 'parent') {
              document.getElementById('parent')!.classList.add('rr-block');
            }
            if (block === 'sibling') {
              document.getElementById('sibling')!.classList.add('private');
            }
            if (takeFullSnapshot) {
              // let the block mutation be processed before the snapshot
              return new Promise<void>((resolve) =>
                setTimeout(() => {
                  (
                    window as unknown as IWindow
                  ).rrweb.record.takeFullSnapshot(true);
                  resolve();
                }),
              );
            }
          },
          block,
          takeFullSnapshot,
        );
        await waitForRAF(page);

        await appendParagraph(iframeFrame, LATER_CONTENT);
        await waitForRAF(page);

        const recordedAfterBlocking = JSON.stringify(
          events.slice(eventsBeforeBlocking),
        );
        expect({
          initialContent: recordedAfterBlocking.includes(INITIAL_CONTENT),
          laterContent: recordedAfterBlocking.includes(LATER_CONTENT),
        }).toEqual({ initialContent: false, laterContent: false });
      } finally {
        await page.close();
      }
    },
  );

  it('a same-origin iframe does not record input in the same task it gets blocked', async () => {
    const page = await browser.newPage();
    try {
      await page.goto('about:blank');
      await page.setContent(
        `<!DOCTYPE html><html><body>
          <iframe srcdoc="<input>"></iframe>
        </body></html>`,
        { waitUntil: 'load' },
      );
      const events: eventWithTime[] = [];
      await page.exposeFunction('emit', (e: eventWithTime) => {
        events.push(e);
      });
      await startRecording(page.mainFrame(), {});
      await waitForRAF(page);
      const eventsBeforeBlocking = events.length;

      await page.evaluate((value) => {
        const iframe = document.querySelector('iframe')!;
        iframe.classList.add('rr-block');
        const input = iframe.contentDocument!.querySelector('input')!;
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, LATER_CONTENT);
      await waitForRAF(page);

      expect(JSON.stringify(events.slice(eventsBeforeBlocking))).not.toContain(
        LATER_CONTENT,
      );
    } finally {
      await page.close();
    }
  });

  it('a same-origin iframe that gets blocked and then navigates is not recorded', async () => {
    const page = await browser.newPage();
    try {
      await page.goto('about:blank');
      await page.setContent(
        `<!DOCTYPE html><html><body>
          <iframe srcdoc="<p>${INITIAL_CONTENT}</p>"></iframe>
        </body></html>`,
        { waitUntil: 'load' },
      );
      const events: eventWithTime[] = [];
      await page.exposeFunction('emit', (e: eventWithTime) => {
        events.push(e);
      });
      await startRecording(page.mainFrame(), {});
      await waitForRAF(page);
      expect(JSON.stringify(events)).toContain(INITIAL_CONTENT);
      const eventsBeforeBlocking = events.length;

      await page.evaluate(async (content) => {
        const iframe = document.querySelector('iframe')!;
        iframe.classList.add('rr-block');
        await new Promise<void>((resolve) => {
          iframe.addEventListener('load', () => resolve(), { once: true });
          iframe.srcdoc = `<p>${content}</p>`;
        });
      }, NAVIGATED_CONTENT);
      await waitForRAF(page);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(JSON.stringify(events.slice(eventsBeforeBlocking))).not.toContain(
        NAVIGATED_CONTENT,
      );
    } finally {
      await page.close();
    }
  });

  it.each([
    { blockSelector: '[', description: 'an invalid selector' },
    {
      // an unknown pseudo-class also stands in for one a browser lacks
      blockSelector: '.private, :not-a-pseudo',
      description: 'a selector list with one unsupported part',
    },
  ])(
    'does not record anything with $description',
    async ({ blockSelector }) => {
      const page = await browser.newPage();
      try {
        await page.goto('about:blank');
        await page.setContent(
          '<html><body><div class="private">initial-private</div></body></html>',
        );
        const events: eventWithTime[] = [];
        const errors: string[] = [];
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(message.text());
        });
        await page.exposeFunction('emit', (e: eventWithTime) => {
          events.push(e);
        });
        await page.addScriptTag({
          path: path.resolve(__dirname, '../../dist/rrweb.umd.cjs'),
        });
        const started = await page.evaluate((blockSelector) => {
          const { rrweb, emit } = window as unknown as IWindow;
          return (
            rrweb.record({ blockSelector, emit: (event) => emit?.(event) }) !==
            undefined
          );
        }, blockSelector);
        await waitForRAF(page);

        await page.evaluate(() => {
          document.querySelector('.private')!.textContent = 'later-private';
        });
        await waitForRAF(page);

        expect({
          started,
          events: events.length,
          loggedError: errors.some((e) => e.includes('blockSelector')),
        }).toEqual({ started: false, events: 0, loggedError: true });
      } finally {
        await page.close();
      }
    },
  );
});
