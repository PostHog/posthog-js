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

it.each([
  { policy: 'masked', prefix: '' },
  { policy: 'unmasked', prefix: '' },
  { policy: 'legacy', prefix: '' },
  { policy: 'masked', prefix: 'h:' },
  { policy: 'unmasked', prefix: 'h:' },
  { policy: 'legacy', prefix: 'h:' },
] as const)(
  'applies $policy policy to native XHTML selects (prefix=$prefix)',
  async ({ policy, prefix }) => {
    await page.goto(
      'data:application/xhtml+xml,' +
        encodeURIComponent(
          `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:h="http://www.w3.org/1999/xhtml"><head><title>XHTML</title></head><body><${prefix}select><${prefix}optgroup label="Choices"><${prefix}option value="a">A</${prefix}option><${prefix}option value="b" selected="selected">B</${prefix}option></${prefix}optgroup></${prefix}select><input id="other" value="initial"/></body></html>`,
        ),
    );
    await page.evaluate(code);
    const result = await page.evaluate(
      async ({ policy, prefix }) => {
        const { record } = (window as unknown as TestWindow).rrweb;
        const select = document.querySelector('select')!;
        const events: eventWithTime[] = [];
        const stop = record({
          maskAllInputs: policy === 'unmasked',
          maskInputFn: () => 'redacted',
          selectMaskingFn: policy === 'legacy' ? undefined : () => policy,
          emit: (event) => events.push(event),
        })!;
        select.value = 'a';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        const other = document.querySelector<HTMLInputElement>('#other')!;
        other.value = 'unchanged-scope';
        other.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 30));
        select.setAttribute('value', 'attribute-choice');
        select.options[1].removeAttribute('selected');
        select.options[0].setAttribute('selected', 'selected');
        await new Promise((resolve) => setTimeout(resolve, 30));
        const selectId = record.mirror.getId(select);
        stop();
        const nodes: serializedNodeWithId[] = [];
        const visit = (node: serializedNodeWithId) => {
          nodes.push(node);
          if ('childNodes' in node) node.childNodes.forEach(visit);
        };
        for (const event of events)
          if (event.type === 2) visit(event.data.node);
        return {
          tagName: select.tagName,
          nativeValue: select.value,
          attributes: events.flatMap((event) =>
            event.type === 3 && event.data.source === 0
              ? event.data.attributes
              : [],
          ),
          selectId,
          selects: nodes.filter((node) => node.id === selectId),
          selected: nodes.filter(
            (node) => node.type === 2 && node.attributes.selected,
          ),
          inputs: events.flatMap((event) =>
            event.type === 3 && event.data.source === 5 ? [event.data] : [],
          ),
        };
      },
      { policy, prefix },
    );
    expect(result.tagName).toBe(prefix + 'select');
    expect(result.nativeValue).toBe('a');
    expect(result.selects).toHaveLength(1);
    expect(result.selected).toHaveLength(policy === 'masked' ? 0 : 1);
    expect(result.attributes).toContainEqual(
      expect.objectContaining({
        id: result.selectId,
        attributes: expect.objectContaining({
          value: policy === 'masked' ? 'redacted' : 'attribute-choice',
        }),
      }),
    );
    const selectedAttributes = result.attributes.filter((entry) =>
      Object.hasOwn(entry.attributes, 'selected'),
    );
    if (policy === 'legacy')
      expect(selectedAttributes.length).toBeGreaterThan(0);
    else expect(selectedAttributes).toEqual([]);
    if (policy === 'legacy' && prefix) {
      expect(result.selects[0]).toHaveProperty('tagName', 'h:select');
      expect(result.selects[0]).not.toHaveProperty('attributes.value');
    } else
      expect(result.selects[0]).toMatchObject({
        attributes: { value: policy === 'masked' ? 'redacted' : 'b' },
      });
    if (policy === 'legacy') expect(result.inputs).toEqual([]);
    else {
      expect(result.inputs).toHaveLength(1);
      for (const input of result.inputs) {
        expect(input.text).toBe(policy === 'masked' ? 'redacted' : 'a');
        if (policy === 'masked')
          expect(input).not.toHaveProperty('selectedOptionIds');
        else expect(input.selectedOptionIds).toHaveLength(1);
      }
    }
  },
);

it.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])(
  'rechecks policy after a reentrant unfreeze (opt-in=%s, mirrored=%s)',
  async (optIn, mirrored) => {
    const result = await page.evaluate(
      async ({ optIn, mirrored }) => {
        const { record } = (window as unknown as TestWindow).rrweb;
        document.body.innerHTML =
          '<select data-private="false"><option value="seed">Seed</option></select>';
        const select = document.querySelector('select')!;
        const publicOption = new Option('Public', 'public-choice');
        const privateOption = new Option('Private', 'private-choice');
        if (mirrored) select.append(publicOption, privateOption);
        let flipped = false;
        const inputs: eventWithTime[] = [];
        const stop = record({
          maskAllInputs: false,
          maskInputFn: () => 'redacted',
          selectMaskingFn: optIn
            ? (element) =>
                element.dataset.private === 'true' ? 'masked' : 'unmasked'
            : undefined,
          emit: (event) => {
            if (
              event.type === 3 &&
              event.data.source === 0 &&
              (event.data.adds.length || event.data.attributes.length) &&
              !flipped
            ) {
              flipped = true;
              select.dataset.private = 'true';
              select.value = 'private-choice';
            }
            if (flipped && event.type === 3 && event.data.source === 5)
              inputs.push(event);
          },
        })!;
        const initialPrivateId = record.mirror.getId(privateOption);
        record.freezePage();
        if (mirrored) select.dataset.pending = 'true';
        else select.append(publicOption, privateOption);
        select.value = 'public-choice';
        await new Promise((resolve) => setTimeout(resolve, 50));
        const privateId = record.mirror.getId(privateOption);
        stop();
        return { flipped, privateId, initialPrivateId, inputs };
      },
      { optIn, mirrored },
    );
    expect(result.initialPrivateId > 0).toBe(mirrored);
    expect(result.flipped).toBe(true);
    expect(result.privateId).toBeGreaterThan(0);
    expect(result.inputs.length).toBeGreaterThan(0);
    const inputs = result.inputs.flatMap((event) =>
      event.type === 3 && event.data.source === 5 ? [event.data] : [],
    );
    if (optIn) {
      for (const input of inputs) {
        expect(input.text).toBe('redacted');
        expect(input).not.toHaveProperty('selectedOptionIds');
      }
    } else
      expect(inputs).toContainEqual(
        expect.objectContaining({
          text: 'private-choice',
          selectedOptionIds: [result.privateId],
        }),
      );
  },
);

it.each([false, true])(
  'shares policy decisions within each bulk mutation emission (opt-in=%s)',
  async (optIn) => {
    const rows = await page.evaluate(async (optIn) => {
      const { record } = (window as unknown as TestWindow).rrweb;
      document.body.innerHTML = '<select></select>';
      const select = document.querySelector('select')!;
      let calls = 0;
      let scans = 0;
      let masked = true;
      const rows: { calls: number; scans: number; options: number }[] = [];
      const stop = record({
        maskAllInputs: false,
        selectMaskingFn: optIn
          ? (element) => {
              calls++;
              for (const option of Array.from(element.options)) {
                scans++;
                void option.selected;
              }
              return masked ? 'masked' : 'unmasked';
            }
          : undefined,
        emit: (event) => {
          if (event.type !== 3 || event.data.source !== 0) return;
          const options = event.data.adds.filter(
            ({ node }) => node.type === 2 && node.tagName === 'option',
          ).length;
          if (options) rows.push({ calls, scans, options });
        },
      })!;
      for (const nextMasked of [true, false]) {
        masked = nextMasked;
        calls = 0;
        scans = 0;
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < 200; i++)
          fragment.appendChild(new Option(String(i), String(i)));
        select.appendChild(fragment);
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      stop();
      return rows;
    }, optIn);
    expect(rows).toEqual([
      { calls: optIn ? 1 : 0, scans: optIn ? 200 : 0, options: 200 },
      { calls: optIn ? 1 : 0, scans: optIn ? 400 : 0, options: 200 },
    ]);
  },
);
