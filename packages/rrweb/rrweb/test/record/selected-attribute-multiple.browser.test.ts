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
  await page.setContent('<main id="fixture"></main>');
  await page.evaluate(code);
});
afterEach(async () => {
  await page.close();
});
afterAll(async () => {
  await browser.close();
});

async function capture(
  shape: string,
  change: string,
  {
    redact = false,
    custom = true,
    useVirtualDom = false,
    block,
  }: {
    redact?: boolean;
    custom?: boolean;
    useVirtualDom?: boolean;
    block?: 'option' | 'optgroup';
  } = {},
) {
  return page.evaluate(
    async ({ shape, change, redact, custom, useVirtualDom, block }) => {
      const { record, Replayer } = (window as unknown as TestWindow).rrweb;
      let choices =
        shape === 'duplicates'
          ? '<option value="same">A</option><option value="same">B</option><option value="same">C</option>'
          : '<option value="a">A</option><option value="b">B</option><option value="c">C</option>';
      if (block) {
        const hidden = `<option value="blocked-multi-secret" ${block === 'option' ? 'class="rr-block"' : ''}>Hidden</option>`;
        choices =
          '<option value="a">A</option>' +
          (block === 'optgroup'
            ? `<optgroup class="rr-block">${hidden}</optgroup>`
            : hidden) +
          '<option value="c">C</option>';
      }
      document.querySelector('#fixture')!.innerHTML =
        '<select multiple>' +
        (shape === 'optgroup'
          ? `<optgroup label="Choices">${choices}</optgroup>`
          : choices) +
        '</select>';
      const select = document.querySelector('select')!;
      const events: eventWithTime[] = [];
      const stop = record({
        maskAllInputs: true,
        maskInputFn: custom
          ? (text) => (redact ? 'redacted' : text)
          : undefined,
        emit: (event) => events.push(event),
      })!;
      const indices =
        change === 'removeAttribute'
          ? [0, 1, 2]
          : shape === 'duplicates'
            ? [1, 2]
            : [0, 1];
      for (const index of indices) {
        if (change === 'defaultSelected')
          select.options[index].defaultSelected = true;
        else select.options[index].setAttribute('selected', '');
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (change === 'removeAttribute') {
        select.options[1].removeAttribute('selected');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const liveIndices = Array.from(
        select.selectedOptions,
        (option) => option.index,
      );
      stop();
      const inputs = events.flatMap((event) =>
        event.type === 3 && event.data.source === 5 ? [event.data] : [],
      );
      const selectedMutations = events.flatMap((event) =>
        event.type === 3 && event.data.source === 0
          ? event.data.attributes.filter((item) =>
              Object.hasOwn(item.attributes, 'selected'),
            )
          : [],
      );
      const replayer = new Replayer(events, { useVirtualDom });
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
        shape,
        change,
        redact,
        custom,
        liveIndices,
        replayIndices,
        inputs,
        selectedMutations,
        payload: JSON.stringify(events),
      };
    },
    { shape, change, redact, custom, useVirtualDom, block },
  );
}

for (const shape of ['direct', 'optgroup', 'duplicates']) {
  it.each(['setAttribute', 'defaultSelected', 'removeAttribute'])(
    `preserves passthrough multiple selections (${shape}, %s)`,
    async (change) => {
      const result = await capture(shape, change);
      expect(result.liveIndices).toEqual(
        change === 'removeAttribute'
          ? [0, 2]
          : shape === 'duplicates'
            ? [1, 2]
            : [0, 1],
      );
      expect(result.replayIndices).toEqual(result.liveIndices);
      expect(result.inputs).toEqual([]);
      expect(result.selectedMutations.length).toBeGreaterThan(0);
    },
  );
}

it.each(['direct', 'duplicates'])(
  'preserves passthrough choices during virtual-DOM seeking (%s)',
  async (shape) => {
    const result = await capture(shape, 'setAttribute', {
      useVirtualDom: true,
    });
    expect(result.replayIndices).toEqual(
      shape === 'duplicates' ? [1, 2] : [0, 1],
    );
    expect(result.inputs).toEqual([]);
  },
);

it.each(['option', 'optgroup'] as const)(
  'keeps blocked choices out of the legacy attribute path (%s)',
  async (block) => {
    const result = await capture('direct', 'setAttribute', { block });
    expect(result.liveIndices).toEqual([0, 1]);
    expect(result.replayIndices).toEqual([0]);
    expect(result.selectedMutations).toHaveLength(1);
    expect(result.inputs).toEqual([]);
    expect(result.payload).not.toContain('blocked-multi-secret');
  },
);

it('retains legacy attribute behavior for custom multiselect redactors', async () => {
  const result = await capture('direct', 'setAttribute', { redact: true });
  expect(result.liveIndices).toEqual([0, 1]);
  expect(result.replayIndices).toEqual([0, 1]);
  expect(result.selectedMutations).toHaveLength(2);
  expect(result.inputs).toEqual([]);
});

it.each(['direct', 'optgroup', 'duplicates'])(
  'keeps default-masked multiselects private (%s)',
  async (shape) => {
    const result = await capture(shape, 'setAttribute', { custom: false });
    expect(result.liveIndices).toEqual(
      shape === 'duplicates' ? [1, 2] : [0, 1],
    );
    expect(result.selectedMutations).toEqual([]);
    expect(result.inputs).toHaveLength(1);
    expect(result.inputs[0].text).toBe(shape === 'duplicates' ? '****' : '*');
    expect(result.inputs[0]).not.toHaveProperty('selectedOptionIds');
    expect(result.replayIndices).toEqual([]);
  },
);
