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

type Action = 'dataset' | 'label' | 'addOption' | 'selectedAttribute' | 'change';

async function selectInputs(action: Action, policy: boolean) {
  return page.evaluate(
    async ({ action, policy }) => {
      const { record } = (window as unknown as TestWindow).rrweb;
      document.body.innerHTML =
        '<select><option value="a">A</option><option value="b">B</option></select>';
      const select = document.querySelector('select')!;
      const emitted: Array<{ event: eventWithTime; nonInteractive: unknown }> =
        [];
      const stop = record({
        maskAllInputs: true,
        selectMaskingFn: policy ? () => 'masked' : undefined,
        emit: (event, _isCheckout, nonInteractive) =>
          emitted.push({ event, nonInteractive }),
      })!;
      if (action === 'dataset') select.dataset.layout = 'ready';
      else if (action === 'label') select.options[0].textContent = 'Changed';
      else if (action === 'addOption') select.append(new Option('C', 'c'));
      else if (action === 'selectedAttribute')
        select.options[1].setAttribute('selected', '');
      else {
        select.selectedIndex = 1;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await new Promise((resolve) => setTimeout(resolve, 30));
      const selectId = record.mirror.getId(select);
      stop();
      return emitted
        .filter(
          ({ event }) =>
            event.type === 3 &&
            event.data.source === 5 &&
            event.data.id === selectId,
        )
        .map(({ nonInteractive }) => nonInteractive === true);
    },
    { action, policy },
  );
}

it.each(['dataset', 'label', 'addOption', 'selectedAttribute'] as const)(
  'marks policy inputs derived from a %s mutation as non-interactive',
  async (action) => {
    const inputs = await selectInputs(action, true);
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.every(Boolean)).toBe(true);
  },
);

it('keeps a native change event interactive with a policy', async () => {
  expect(await selectInputs('change', true)).toEqual([false]);
});

it.each(['dataset', 'change'] as const)(
  'does not mark legacy %s inputs as non-interactive',
  async (action) => {
    const inputs = await selectInputs(action, false);
    expect(inputs.every((nonInteractive) => !nonInteractive)).toBe(true);
  },
);
