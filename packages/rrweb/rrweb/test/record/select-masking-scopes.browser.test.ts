import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { Browser, Page } from 'puppeteer';
import type { eventWithTime } from '@posthog/rrweb-types';
import { launchPuppeteer } from '../utils';

type TestWindow = Window & { rrweb: typeof import('../../src') };
const code = readFileSync(
  resolve(__dirname, '../../dist/rrweb.umd.cjs'),
  'utf8',
);
let browser: Browser;
let page: Page;
beforeAll(async () => {
  browser = await launchPuppeteer();
});
beforeEach(async () => {
  page = await browser.newPage();
  await page.evaluate(code);
});
afterEach(async () => {
  await page.close();
});
afterAll(async () => {
  await browser.close();
});

for (const scope of ['iframe', 'shadow']) {
  for (const startMasked of [false, true]) {
    it.each([false, true])(
      `captures policy-only transitions in ${scope} (initially masked=${startMasked}, virtual=%s)`,
      async (virtual) => {
        const result = await page.evaluate(
          async ({ scope, startMasked, virtual }) => {
            const { record, Replayer } = (window as unknown as TestWindow)
              .rrweb;
            const html = `<select multiple data-private="${startMasked}"><option value="redacted">A</option><option value="redacted" selected>B</option><option value="redacted" selected>C</option></select>`;
            let root: Document | ShadowRoot;
            if (scope === 'iframe') {
              const iframe = document.createElement('iframe');
              iframe.id = 'fixture';
              const loaded = new Promise((resolve) =>
                iframe.addEventListener('load', resolve, { once: true }),
              );
              iframe.srcdoc = html;
              document.body.appendChild(iframe);
              await loaded;
              root = iframe.contentDocument!;
            } else {
              const host = document.createElement('div');
              host.id = 'fixture';
              document.body.appendChild(host);
              root = host.attachShadow({ mode: 'open' });
              root.innerHTML = html;
            }
            const select = root.querySelector('select')!;
            const events: eventWithTime[] = [];
            const stop = record({
              maskAllInputs: true,
              selectMaskingFn: (element) =>
                element.dataset.private === 'true' ? 'masked' : 'unmasked',
              maskInputFn: () => 'redacted',
              emit: (event) => events.push(event),
            })!;
            await new Promise((resolve) => setTimeout(resolve, 50));
            const id = record.mirror.getId(select);
            if (id <= 0) throw new Error('Fixture select was not mirrored');
            select.dataset.private = String(!startMasked);
            await new Promise((resolve) => setTimeout(resolve, 30));
            stop();
            const inputs = events.flatMap((event) =>
              event.type === 3 &&
              event.data.source === 5 &&
              event.data.id === id
                ? [event.data]
                : [],
            );
            const replayer = new Replayer(events, { useVirtualDom: virtual });
            replayer.pause(
              events[events.length - 1].timestamp - events[0].timestamp + 1,
            );
            await new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            );
            const fixture =
              replayer.iframe.contentDocument!.querySelector('#fixture')!;
            const replayRoot =
              scope === 'iframe'
                ? (fixture as HTMLIFrameElement).contentDocument!
                : fixture.shadowRoot!;
            const indices = Array.from(
              replayRoot.querySelector('select')!.selectedOptions,
              (option) => option.index,
            );
            replayer.destroy();
            return { indices, inputs };
          },
          { scope, startMasked, virtual },
        );
        expect(result.indices).toEqual(startMasked ? [1, 2] : []);
        expect(result.inputs).toHaveLength(1);
        if (startMasked)
          expect(result.inputs[0].selectedOptionIds).toHaveLength(2);
        else expect(result.inputs[0]).not.toHaveProperty('selectedOptionIds');
      },
    );
  }
}
