import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { Browser, Page } from 'puppeteer';
import type { eventWithTime } from '@posthog/rrweb-types';
import type { recordOptions } from '../../src/types';
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

async function capture({
  policy,
  change = 'attribute',
  duplicate = false,
  maskAllInputs = true,
  virtual = false,
  blocked = false,
  initial = false,
}: {
  policy?: 'masked' | 'unmasked' | 'throw' | 'invalid';
  change?: string;
  duplicate?: boolean;
  maskAllInputs?: boolean;
  virtual?: boolean;
  blocked?: boolean;
  initial?: boolean;
}) {
  return page.evaluate(
    async ({
      policy,
      change,
      duplicate,
      maskAllInputs,
      virtual,
      blocked,
      initial,
    }) => {
      const { record, Replayer } = (window as unknown as TestWindow).rrweb;
      const options = ['a', 'b', 'c']
        .map(
          (value, index) =>
            `<option value="${duplicate ? 'redacted' : value}">${index}</option>`,
        )
        .join('');
      document.body.innerHTML = `<select multiple ${blocked ? 'class="rr-block"' : ''}><optgroup label="Choices">${options}</optgroup></select><input value="OTHER-SECRET">`;
      const select = document.querySelector('select')!;
      if (initial || change === 'remove')
        for (const index of [1, 2])
          select.options[index].setAttribute('selected', '');
      const events: eventWithTime[] = [];
      const maskCalls: string[] = [];
      const optionsToRecord: recordOptions<eventWithTime> = {
        maskAllInputs,
        maskInputOptions: { text: true, password: true },
        maskInputFn: (_text, element) => {
          maskCalls.push(element.tagName);
          return 'redacted';
        },
        selectMaskingFn: policy
          ? () => {
              if (policy === 'throw') throw new Error('policy failure');
              return policy === 'unmasked' ? 'unmasked' : 'masked';
            }
          : undefined,
        emit: (event) => events.push(event),
      };
      if (policy === 'invalid')
        Object.defineProperty(optionsToRecord, 'selectMaskingFn', {
          value: () => undefined,
        });
      const stop = record(optionsToRecord)!;
      if (!initial) {
        if (change === 'remove') select.options[1].removeAttribute('selected');
        else
          for (const index of [1, 2]) {
            if (change === 'default')
              select.options[index].defaultSelected = true;
            else if (change === 'setter' || change === 'native')
              select.options[index].selected = true;
            else select.options[index].setAttribute('selected', '');
          }
        if (change === 'native')
          select.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      const selectId = record.mirror.getId(select);
      stop();
      const inputs = events.flatMap((event) =>
        event.type === 3 &&
        event.data.source === 5 &&
        event.data.id === selectId
          ? [event.data]
          : [],
      );
      const selectedAttributes = events.flatMap((event) =>
        event.type === 3 && event.data.source === 0
          ? event.data.attributes.filter((item) =>
              Object.hasOwn(item.attributes, 'selected'),
            )
          : [],
      );
      const selectedSnapshots: number[] = [];
      const visit = (node: unknown) => {
        const value = node as {
          id: number;
          attributes?: Record<string, unknown>;
          childNodes?: unknown[];
        };
        if (value.attributes?.selected) selectedSnapshots.push(value.id);
        value.childNodes?.forEach(visit);
      };
      for (const event of events) if (event.type === 2) visit(event.data.node);
      const replayer = new Replayer(events, { useVirtualDom: virtual });
      replayer.pause(
        events[events.length - 1].timestamp - events[0].timestamp + 1,
      );
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const replayIndices = Array.from(
        replayer.iframe.contentDocument!.querySelector('select')!
          .selectedOptions,
        (option) => option.index,
      );
      replayer.destroy();
      return {
        inputs,
        selectedAttributes,
        selectedSnapshots,
        replayIndices,
        maskCalls,
        payload: JSON.stringify(events),
      };
    },
    { policy, change, duplicate, maskAllInputs, virtual, blocked, initial },
  );
}

for (const change of ['attribute', 'default', 'remove', 'setter', 'native']) {
  it.each([true, false])(
    `explicit masking suppresses selection metadata (${change}, category=%s)`,
    async (maskAllInputs) => {
      const result = await capture({ policy: 'masked', change, maskAllInputs });
      expect(result.selectedAttributes).toEqual([]);
      expect(result.selectedSnapshots).toEqual([]);
      expect(result.inputs).toHaveLength(1);
      expect(result.inputs[0].text).toBe('redacted');
      expect(result.inputs[0]).not.toHaveProperty('selectedOptionIds');
      expect(result.replayIndices).toEqual([]);
    },
  );
  it.each([false, true])(
    `explicit unmasking preserves duplicate identity (${change}, virtual=%s)`,
    async (virtual) => {
      const result = await capture({
        policy: 'unmasked',
        change,
        duplicate: true,
        virtual,
      });
      expect(result.replayIndices).toEqual(change === 'remove' ? [2] : [1, 2]);
      expect(result.maskCalls).not.toContain('SELECT');
      expect(result.payload).not.toContain('OTHER-SECRET');
      expect(result.selectedAttributes).toEqual([]);
      expect(result.inputs[0].selectedOptionIds).toHaveLength(
        change === 'remove' ? 1 : 2,
      );
    },
  );
}

it.each(['masked', 'unmasked'] as const)(
  'initial snapshots honor explicit %s policy',
  async (policy) => {
    const result = await capture({ policy, duplicate: true, initial: true });
    expect(result.replayIndices).toEqual(policy === 'masked' ? [] : [1, 2]);
    expect(result.selectedSnapshots).toHaveLength(policy === 'masked' ? 0 : 2);
  },
);

it.each(['throw', 'invalid'] as const)(
  'fails closed for %s policy results',
  async (policy) => {
    const result = await capture({ policy, maskAllInputs: false });
    expect(result.selectedAttributes).toEqual([]);
    expect(result.inputs[0].text).toBe('redacted');
    expect(result.inputs[0]).not.toHaveProperty('selectedOptionIds');
    expect(result.replayIndices).toEqual([]);
  },
);

it('explicit masking clears a callback value that matches a real option', async () => {
  const result = await capture({
    policy: 'masked',
    duplicate: true,
    change: 'setter',
  });
  expect(result.inputs[0].text).toBe('redacted');
  expect(result.inputs[0]).not.toHaveProperty('selectedOptionIds');
  expect(result.replayIndices).toEqual([]);
});

it('an explicit unmask decision cannot override subtree blocking', async () => {
  const result = await capture({ policy: 'unmasked', blocked: true });
  expect(result.selectedAttributes).toEqual([]);
  expect(result.inputs).toEqual([]);
  expect(result.replayIndices).toEqual([]);
});

it('advertises explicit selection masking support', async () => {
  expect(
    await page.evaluate(
      () =>
        (window as unknown as TestWindow).rrweb.record.supportsSelectMasking,
    ),
  ).toBe(true);
});

it('preserves the legacy custom-multiselect attribute path when absent', async () => {
  const result = await capture({});
  expect(result.selectedAttributes).toHaveLength(2);
  expect(result.inputs).toEqual([]);
  expect(result.replayIndices).toEqual([1, 2]);
});

it('classifies private and public selects independently in the same recording', async () => {
  const result = await page.evaluate(async () => {
    const { record, Replayer } = (window as unknown as TestWindow).rrweb;
    const choices =
      '<option value="same">A</option><option value="same">B</option><option value="same">C</option>';
    document.body.innerHTML = `<select id="private" multiple>${choices}</select><select id="public" multiple>${choices}</select>`;
    const events: eventWithTime[] = [];
    const policyElements: string[] = [];
    const stop = record({
      maskAllInputs: true,
      maskInputFn: () => 'redacted',
      selectMaskingFn: (select) => {
        policyElements.push(select.id);
        return select.id === 'public' ? 'unmasked' : 'masked';
      },
      emit: (event) => events.push(event),
    })!;
    const selects = Array.from(document.querySelectorAll('select'));
    const ids = selects.map((select) => record.mirror.getId(select));
    for (const select of selects)
      for (const index of [1, 2])
        select.options[index].setAttribute('selected', '');
    await new Promise((resolve) => setTimeout(resolve, 30));
    stop();
    const inputs = events.flatMap((event) =>
      event.type === 3 && event.data.source === 5 ? [event.data] : [],
    );
    const replayer = new Replayer(events);
    replayer.pause(
      events[events.length - 1].timestamp - events[0].timestamp + 1,
    );
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const replay = Array.from(
      replayer.iframe.contentDocument!.querySelectorAll('select'),
      (select) => Array.from(select.selectedOptions, (option) => option.index),
    );
    replayer.destroy();
    return { inputs, ids, replay, policyElements };
  });
  expect(result.replay).toEqual([[], [1, 2]]);
  expect(
    result.inputs.find((input) => input.id === result.ids[0]),
  ).not.toHaveProperty('selectedOptionIds');
  expect(
    result.inputs.find((input) => input.id === result.ids[1])!
      .selectedOptionIds,
  ).toHaveLength(2);
  expect(new Set(result.policyElements)).toEqual(
    new Set(['private', 'public']),
  );
});
