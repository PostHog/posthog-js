import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { Browser, Page } from 'puppeteer';
import type { eventWithTime, serializedNodeWithId } from '@posthog/rrweb-types';
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

for (const wrapper of ['div', 'optgroup'] as const) {
  for (const stage of ['snapshot', 'addition'] as const) {
    it.each(['masked', 'unmasked', 'legacy'] as const)(
      `serializes ${wrapper}-wrapped options during ${stage} with %s policy`,
      async (policy) => {
        const result = await page.evaluate(
          async ({ wrapper, stage, policy }) => {
            const { record } = (window as unknown as TestWindow).rrweb;
            document.body.innerHTML = '<select multiple></select>';
            const select = document.querySelector('select')!;
            const container = document.createElement(wrapper);
            const inner = container.appendChild(document.createElement('div'));
            for (const value of ['a', 'b']) {
              const option = inner.appendChild(
                document.createElement('option'),
              );
              option.value = value;
              option.textContent = value;
              option.selected = value === 'b';
            }
            if (stage === 'snapshot') select.appendChild(container);
            const events: eventWithTime[] = [];
            const stop = record({
              maskAllInputs: policy === 'unmasked',
              maskInputFn: () => 'redacted',
              selectMaskingFn: policy === 'legacy' ? undefined : () => policy,
              emit: (event) => events.push(event),
            })!;
            if (stage === 'addition') {
              select.appendChild(container);
              await new Promise((resolve) => setTimeout(resolve, 30));
            }
            const selectedValues = Array.from(
              select.selectedOptions,
              (option) => option.value,
            );
            stop();
            const selectedNodes: number[] = [];
            const visit = (node: serializedNodeWithId) => {
              if (
                node.type === 2 &&
                Object.hasOwn(node.attributes, 'selected')
              ) {
                selectedNodes.push(node.id);
              }
              if ('childNodes' in node) node.childNodes.forEach(visit);
            };
            for (const event of events) {
              if (event.type === 2) visit(event.data.node);
              if (event.type === 3 && event.data.source === 0) {
                event.data.adds.forEach((addition) => visit(addition.node));
              }
            }
            return { selectedValues, selectedNodes };
          },
          { wrapper, stage, policy },
        );
        expect(result.selectedValues).toEqual(['b']);
        expect(result.selectedNodes).toHaveLength(policy === 'masked' ? 0 : 1);
      },
    );
  }
}

it('evaluates a scanning policy once per select per snapshot, without caching later decisions', async () => {
  const result = await page.evaluate(() => {
    const { record } = (window as unknown as TestWindow).rrweb;
    document.body.innerHTML = '<select></select>';
    const select = document.querySelector('select')!;
    for (let i = 0; i < 200; i++) select.add(new Option(String(i), String(i)));
    select.selectedIndex = 199;
    let calls = 0;
    let scans = 0;
    let unmasked = false;
    const snapshots: { calls: number; scans: number; marker: unknown }[] = [];
    const stop = record({
      selectMaskingFn: (element) => {
        calls++;
        for (const option of Array.from(element.options)) {
          scans++;
          void option.selected;
        }
        return unmasked ? 'unmasked' : 'masked';
      },
      emit: (event) => {
        if (event.type !== 2) return;
        const visit = (node: serializedNodeWithId): unknown => {
          if (node.type === 2 && node.tagName === 'select')
            return node.attributes.rr_maskedSelect;
          if ('childNodes' in node) {
            for (const child of node.childNodes) {
              const marker = visit(child);
              if (marker !== undefined) return marker;
            }
          }
        };
        snapshots.push({ calls, scans, marker: visit(event.data.node) });
        calls = 0;
        scans = 0;
      },
    })!;
    unmasked = true;
    record.takeFullSnapshot();
    unmasked = false;
    record.takeFullSnapshot();
    stop();
    return snapshots;
  });
  expect(result).toEqual([
    { calls: 1, scans: 200, marker: true },
    { calls: 1, scans: 200, marker: null },
    { calls: 1, scans: 200, marker: true },
  ]);
});
