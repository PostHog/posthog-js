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
      blockLaterCases
        // cross-origin iframes are not relayed at all under a block selector
        .filter(
          (blockCase) =>
            iframeOrigin === 'same-origin' ||
            !('blockSelector' in blockCase.blockingOptions),
        )
        .flatMap((blockCase) =>
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

  it("a recorder inside a same-origin iframe records its own changes when the parent blocks that iframe", async () => {
    const page = await browser.newPage();
    try {
      await page.goto('about:blank');
      await page.setContent(
        `<!DOCTYPE html><html><body>
          <iframe class="rr-block" srcdoc="<p>${INITIAL_CONTENT}</p>"></iframe>
        </body></html>`,
        { waitUntil: 'load' },
      );
      const iframeFrame = page.frames()[1];
      const events: eventWithTime[] = [];
      await page.exposeFunction('emit', (e: eventWithTime) => {
        events.push(e);
      });
      await iframeFrame.addScriptTag({
        path: path.resolve(__dirname, '../../dist/rrweb.umd.cjs'),
      });
      // records the iframe on its own, the way an embedded page with its own SDK would
      await iframeFrame.evaluate(() => {
        const { rrweb } = window as unknown as IWindow;
        const { emit } = window.parent as unknown as IWindow;
        rrweb.record({ emit: (event) => emit?.(event) });
      });
      await waitForRAF(page);

      await appendParagraph(iframeFrame, LATER_CONTENT);
      await waitForRAF(page);

      expect(JSON.stringify(events)).toContain(LATER_CONTENT);
    } finally {
      await page.close();
    }
  });

  it('does not record shadow-root changes buffered in a frozen iframe that gets blocked', async () => {
    const page = await browser.newPage();
    try {
      await page.goto('about:blank');
      await page.setContent(
        `<!DOCTYPE html><html><body>
          <button>click</button>
          <iframe srcdoc="<body><div id=host></div></body>"></iframe>
        </body></html>`,
        { waitUntil: 'load' },
      );
      await page.evaluate(() => {
        const doc = document.querySelector('iframe')!.contentDocument!;
        doc
          .getElementById('host')!
          .attachShadow({ mode: 'open' }).innerHTML = '<p>shadow</p>';
      });
      const events: eventWithTime[] = [];
      await page.exposeFunction('emit', (e: eventWithTime) => {
        events.push(e);
      });
      await startRecording(page.mainFrame(), {});
      await waitForRAF(page);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const eventsBeforeBlocking = events.length;

      await page.evaluate(async (content) => {
        const { rrweb } = window as unknown as IWindow;
        const tick = () => new Promise((resolve) => setTimeout(resolve));
        const iframe = document.querySelector('iframe')!;
        const shadow = iframe.contentDocument!.getElementById('host')!
          .shadowRoot!;
        (rrweb.record as unknown as { freezePage: () => void }).freezePage();
        shadow.querySelector('p')!.textContent = content;
        await tick();
        iframe.classList.add('rr-block');
        await tick();
        document.querySelector('button')!.click();
      }, LATER_CONTENT);
      await waitForRAF(page);

      expect(JSON.stringify(events.slice(eventsBeforeBlocking))).not.toContain(
        LATER_CONTENT,
      );
    } finally {
      await page.close();
    }
  });

  it('records a sibling iframe after a frozen page unfreezes and one iframe is blocked', async () => {
    const page = await browser.newPage();
    try {
      await page.goto('about:blank');
      await page.setContent(
        `<!DOCTYPE html><html><body>
          <button>click</button>
          <iframe id="first" srcdoc="<body></body>"></iframe>
          <iframe id="second" srcdoc="<body></body>"></iframe>
        </body></html>`,
        { waitUntil: 'load' },
      );
      const events: eventWithTime[] = [];
      await page.exposeFunction('emit', (e: eventWithTime) => {
        events.push(e);
      });
      await startRecording(page.mainFrame(), {});
      await waitForRAF(page);
      await new Promise((resolve) => setTimeout(resolve, 100));

      await page.evaluate(
        async (initial, later) => {
          const { rrweb } = window as unknown as IWindow;
          const tick = () => new Promise((resolve) => setTimeout(resolve));
          const docs = ['first', 'second'].map(
            (id) =>
              (document.getElementById(id) as HTMLIFrameElement)
                .contentDocument!,
          );
          (rrweb.record as unknown as { freezePage: () => void }).freezePage();
          docs[0].body.append(initial);
          docs[1].body.append(later);
          await tick();
          document.getElementById('first')!.classList.add('rr-block');
          await tick();
          document.querySelector('button')!.click();
        },
        INITIAL_CONTENT,
        LATER_CONTENT,
      );
      await waitForRAF(page);

      const recorded = JSON.stringify(events);
      expect({
        blockedIframe: recorded.includes(INITIAL_CONTENT),
        siblingIframe: recorded.includes(LATER_CONTENT),
      }).toEqual({ blockedIframe: false, siblingIframe: true });
    } finally {
      await page.close();
    }
  });

  it('does not record a stylesheet adopted by a same-origin iframe in the same task it gets blocked', async () => {
    const page = await browser.newPage();
    try {
      await page.goto('about:blank');
      await page.setContent(
        `<!DOCTYPE html><html><body>
          <iframe srcdoc="<body></body>"></iframe>
        </body></html>`,
        { waitUntil: 'load' },
      );
      const events: eventWithTime[] = [];
      await page.exposeFunction('emit', (e: eventWithTime) => {
        events.push(e);
      });
      await startRecording(page.mainFrame(), {});
      await waitForRAF(page);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const eventsBeforeBlocking = events.length;

      await page.evaluate((content) => {
        const iframe = document.querySelector('iframe')!;
        iframe.classList.add('rr-block');
        const doc = iframe.contentDocument!;
        const sheet = new (doc.defaultView as typeof window).CSSStyleSheet();
        sheet.replaceSync(`body::after { content: "${content}"; }`);
        doc.adoptedStyleSheets = [sheet];
      }, LATER_CONTENT);
      await waitForRAF(page);

      expect(JSON.stringify(events.slice(eventsBeforeBlocking))).not.toContain(
        LATER_CONTENT,
      );
    } finally {
      await page.close();
    }
  });

  it('does not record a stylesheet that finishes loading in a same-origin iframe after it gets blocked', async () => {
    const page = await browser.newPage();
    try {
      // the iframe must share the stylesheet's origin so its rules are readable
      await page.goto(`${getServerURL(server)}/html/blank.html`);
      await page.setContent(
        `<!DOCTYPE html><html><body>
          <iframe srcdoc="<body></body>"></iframe>
        </body></html>`,
        { waitUntil: 'load' },
      );
      const events: eventWithTime[] = [];
      await page.exposeFunction('emit', (e: eventWithTime) => {
        events.push(e);
      });
      await startRecording(page.mainFrame(), {});
      await waitForRAF(page);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const eventsBeforeBlocking = events.length;

      // the test server answers after 100ms, so the link loads after the block
      await page.evaluate((href) => {
        const iframe = document.querySelector('iframe')!;
        const link = iframe.contentDocument!.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        iframe.contentDocument!.head.append(link);
        setTimeout(() => iframe.classList.add('rr-block'), 20);
      }, `${getServerURL(server)}/html/css-variable-padding.css`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await waitForRAF(page);

      expect(JSON.stringify(events.slice(eventsBeforeBlocking))).not.toContain(
        'rgb(1, 2, 3)',
      );
    } finally {
      await page.close();
    }
  });

  it.each([
    { blocking: 'a blocked parent', blockSelector: undefined, fullSnapshot: false },
    { blocking: 'a blocked parent', blockSelector: undefined, fullSnapshot: true },
    {
      blocking: 'a block added and removed in one task',
      blockSelector: undefined,
      fullSnapshot: false,
      sameTask: true,
    },

  ])(
    'drops a cross-origin message from an iframe briefly blocked by $blocking before it arrived (full snapshot: $fullSnapshot)',
    async ({ blockSelector, fullSnapshot, sameTask }) => {
    const page = await browser.newPage();
    try {
      await page.goto('about:blank');
      await page.setContent(
        `<!DOCTYPE html><html><body>
          <div id="parent"><span id="sibling"></span><iframe src="${getServerURL(server)}/html/blank.html"></iframe></div>
        </body></html>`,
        { waitUntil: 'load' },
      );
      const [topFrame, iframeFrame] = page.frames();
      const events: eventWithTime[] = [];
      await page.exposeFunction('emit', (e: eventWithTime) => {
        events.push(e);
      });
      const options = { blockSelector, recordCrossOriginIframes: true };
      const blockTarget = blockSelector?.includes('+') ? 'sibling' : 'parent';
      const blockAttribute =
        blockSelector === '[data-private]' ? 'data-private' : null;
      await startRecording(topFrame, options);
      // hold back the child's relayed events so one lands after the unblock
      await iframeFrame.evaluate(() => {
        const held: Array<[unknown, string]> = [];
        const post = window.parent.postMessage.bind(window.parent);
        (window as unknown as { held: typeof held }).held = held;
        (window as unknown as { hold: boolean }).hold = false;
        Object.defineProperty(window, 'parent', {
          value: new Proxy(window.parent, {
            get: (target, key) =>
              key === 'postMessage'
                ? (message: unknown, origin: string) =>
                    (window as unknown as { hold: boolean }).hold
                      ? held.push([message, origin])
                      : post(message, origin)
                : Reflect.get(target, key),
          }),
        });
      });
      await startRecording(iframeFrame, options);
      await waitForRAF(page);
      await appendParagraph(iframeFrame, INITIAL_CONTENT);
      await waitForRAF(page);
      await new Promise((resolve) => setTimeout(resolve, 100));
      // the relay works before the block
      expect(JSON.stringify(events)).toContain(INITIAL_CONTENT);

      await iframeFrame.evaluate(() => {
        (window as unknown as { hold: boolean }).hold = true;
      });
      if (sameTask) {
        // the child posts while blocked; the parent observes add and remove
        // in a single mutation batch
        await appendParagraph(iframeFrame, LATER_CONTENT);
        await waitForRAF(page);
        await topFrame.evaluate(
          (id, attribute) => {
            const el = document.getElementById(id)!;
            if (attribute) {
              el.setAttribute(attribute, '');
              el.removeAttribute(attribute);
            } else {
              el.classList.add('rr-block');
              el.classList.remove('rr-block');
            }
          },
          blockTarget,
          blockAttribute,
        );
      } else {
        await topFrame.evaluate(
          (id) => document.getElementById(id)!.classList.add('rr-block'),
          blockTarget,
        );
        await waitForRAF(page);
        await appendParagraph(iframeFrame, LATER_CONTENT);
      }
      await waitForRAF(page);
      await topFrame.evaluate(
        (id, fullSnapshot) => {
          document.getElementById(id)!.classList.remove('rr-block');
          if (fullSnapshot) {
            // let the unblock mutation be processed before the snapshot
            return new Promise<void>((resolve) =>
              setTimeout(() => {
                (window as unknown as IWindow).rrweb.record.takeFullSnapshot(
                  true,
                );
                resolve();
              }),
            );
          }
        },
        blockTarget,
        fullSnapshot,
      );
      await waitForRAF(page);
      const eventsBeforeDelivery = events.length;
      // the child did produce the private event while blocked
      expect(
        await iframeFrame.evaluate(() =>
          JSON.stringify(
            (window as unknown as { held: unknown[] }).held,
          ),
        ),
      ).toContain(LATER_CONTENT);
      await iframeFrame.evaluate(() => {
        const w = window as unknown as {
          hold: boolean;
          held: Array<[unknown, string]>;
        };
        w.hold = false;
        w.held.forEach(([message, origin]) =>
          window.parent.postMessage(message, origin),
        );
      });
      await waitForRAF(page);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(
        JSON.stringify(events.slice(eventsBeforeDelivery)),
      ).not.toContain(LATER_CONTENT);
    } finally {
      await page.close();
    }
  },
  );

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

  it('does not record cross-origin iframes when a block selector is set', async () => {
    const page = await browser.newPage();
    try {
      const warnings: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'warn') warnings.push(message.text());
      });
      await page.goto('about:blank');
      await page.setContent(
        `<!DOCTYPE html><html><body>
          <iframe src="${getServerURL(server)}/html/blank.html"></iframe>
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
        blockSelector: '[data-private]',
        recordCrossOriginIframes: true,
      };
      await startRecording(topFrame, options);
      await startRecording(iframeFrame, options);
      await waitForRAF(page);
      await appendParagraph(iframeFrame, LATER_CONTENT);
      await waitForRAF(page);

      const recorded = JSON.stringify(events);
      expect({
        recording: events.some((e) => e.type === 2),
        iframeContent:
          recorded.includes(INITIAL_CONTENT) || recorded.includes(LATER_CONTENT),
        warned: warnings.some((w) => w.includes('blockSelector')),
      }).toEqual({ recording: true, iframeContent: false, warned: true });
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
