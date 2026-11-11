import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { Browser, Page } from 'puppeteer';
import type { eventWithTime } from '@posthog/rrweb-types';
import { launchPuppeteer } from '../utils';

type Masking = 'default' | 'redactor' | 'passthrough' | 'unmasked';
type Shape = 'direct' | 'optgroup' | 'multiple' | 'shadow' | 'iframe';
type Change = 'setAttribute' | 'defaultSelected' | 'removeAttribute' | 'change';

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
  await page.setContent('<!DOCTYPE html><main id="fixture"></main>');
  await page.evaluate(code);
});
afterEach(async () => {
  await page.close();
});
afterAll(async () => {
  await browser.close();
});

async function capture(masking: Masking, shape: Shape, change: Change) {
  return page.evaluate(
    async ({ masking, shape, change }) => {
      const { record, Replayer } = (
        window as unknown as {
          rrweb: typeof import('../../src');
        }
      ).rrweb;
      const initiallyPrivate = change === 'removeAttribute';
      const hidden = `<option value="private" ${initiallyPrivate ? 'selected' : ''}>Private</option>`;
      let fixture: Element | ShadowRoot = document.querySelector('#fixture')!;
      if (shape === 'shadow') {
        const host = document.createElement('section');
        fixture.appendChild(host);
        fixture = host.attachShadow({ mode: 'open' });
      } else if (shape === 'iframe') {
        const iframe = document.createElement('iframe');
        const loaded = new Promise((resolve) =>
          iframe.addEventListener('load', resolve, { once: true }),
        );
        fixture.appendChild(iframe);
        await loaded;
        fixture = iframe.contentDocument!.body;
      }
      fixture.innerHTML =
        `<select ${shape === 'multiple' ? 'multiple' : ''}>` +
        `<option value="public" ${!initiallyPrivate || shape === 'multiple' ? 'selected' : ''}>Public</option>` +
        (shape === 'optgroup'
          ? `<optgroup label="Choices">${hidden}</optgroup>`
          : hidden) +
        '</select>';
      const select = fixture.querySelector('select')!;
      const option = select.options[1];
      const callbackValues: string[] = [];
      const callbackElements: (string | undefined)[] = [];
      const events: eventWithTime[] = [];
      const stop = record({
        maskAllInputs: masking !== 'unmasked',
        userTriggeredOnInput: true,
        maskInputFn:
          masking === 'redactor' || masking === 'passthrough'
            ? (value, element) => {
                callbackValues.push(value);
                callbackElements.push(element?.tagName);
                return masking === 'passthrough'
                  ? value
                  : '#'.repeat(value.length);
              }
            : undefined,
        emit: (event) => events.push(event),
      })!;
      if (shape === 'iframe')
        await new Promise((resolve) => setTimeout(resolve, 20));
      const optionId = record.mirror.getId(option);
      const snapshotNode = record.mirror.getMeta(option)!;
      const snapshotSelected =
        snapshotNode.type === 2 ? snapshotNode.attributes.selected : undefined;
      callbackValues.length = 0;
      callbackElements.length = 0;
      if (change === 'setAttribute') option.setAttribute('selected', '');
      else if (change === 'defaultSelected') option.defaultSelected = true;
      else if (change === 'removeAttribute') option.removeAttribute('selected');
      else {
        option.selected = true;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
      const liveIndices = Array.from(
        select.selectedOptions,
        (item) => item.index,
      );
      stop();
      const selectedMutations = events.flatMap((event) =>
        event.type === 3 && event.data.source === 0
          ? event.data.attributes.filter((item) =>
              Object.hasOwn(item.attributes, 'selected'),
            )
          : [],
      );
      const inputs = events.flatMap((event) =>
        event.type === 3 && event.data.source === 5 ? [event.data] : [],
      );
      async function replay(input: eventWithTime[]) {
        const replayer = new Replayer(input, { useVirtualDom: false });
        replayer.pause(
          input[input.length - 1].timestamp - input[0].timestamp + 1,
        );
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        let replayRoot: Document | ShadowRoot =
          replayer.iframe.contentDocument!;
        if (shape === 'shadow')
          replayRoot = replayRoot.querySelector('section')!.shadowRoot!;
        else if (shape === 'iframe')
          replayRoot =
            replayRoot.querySelector('#fixture iframe')!.contentDocument!;
        const replaySelect = replayRoot.querySelector('select')!;
        const indices = Array.from(
          replaySelect.selectedOptions,
          (item) => item.index,
        );
        replayer.destroy();
        return indices;
      }
      const replayIndices = await replay(events);
      return {
        masking,
        shape,
        change,
        optionId,
        snapshotSelected,
        liveIndices,
        selectedMutations,
        inputs,
        callbackValues,
        callbackElements,
        replayIndices,
      };
    },
    { masking, shape, change },
  );
}

for (const masking of ['default', 'redactor'] as const) {
  for (const shape of ['direct', 'optgroup', 'multiple'] as const) {
    it.each<Change>(['setAttribute', 'defaultSelected', 'removeAttribute'])(
      `does not expose selected identity (${masking}, ${shape}, %s)`,
      async (change) => {
        const result = await capture(masking, shape, change);
        expect(result.optionId).toBeGreaterThan(0);
        expect(result.snapshotSelected).toBeUndefined();
        expect(result.liveIndices).toEqual(
          change === 'removeAttribute'
            ? [0]
            : shape === 'multiple'
              ? [0, 1]
              : [1],
        );
        expect(result.selectedMutations).toEqual([]);
        const value =
          change === 'removeAttribute' || shape === 'multiple'
            ? 'public'
            : 'private';
        expect(result.inputs).toHaveLength(1);
        expect(result.inputs[0].text).toBe(
          (masking === 'default' ? '*' : '#').repeat(value.length),
        );
        expect(result.inputs[0]).not.toHaveProperty('selectedOptionIds');
        expect(result.inputs[0].userTriggered).toBe(false);
        expect(result.callbackValues).toEqual(
          masking === 'redactor' ? [value] : [],
        );
        expect(result.callbackElements).toEqual(
          masking === 'redactor' ? ['SELECT'] : [],
        );
        expect(result.replayIndices).toEqual([]);
      },
    );
    it(`masks an explicit change event (${masking}, ${shape})`, async () => {
      const result = await capture(masking, shape, 'change');
      expect(result.selectedMutations).toEqual([]);
      expect(result.inputs).toHaveLength(1);
      expect(result.inputs[0].text).toBe(
        (masking === 'default' ? '*' : '#').repeat(
          shape === 'multiple' ? 6 : 7,
        ),
      );
    });
  }
}

for (const shape of ['shadow', 'iframe'] as const) {
  it.each<Masking>(['redactor', 'passthrough'])(
    `routes masked changes through the owning document (${shape}, %s)`,
    async (masking) => {
      const result = await capture(masking, shape, 'setAttribute');
      expect(result.optionId).toBeGreaterThan(0);
      expect(result.selectedMutations).toEqual([]);
      expect(result.inputs).toHaveLength(1);
      expect(result.inputs[0].text).toBe(
        masking === 'passthrough' ? 'private' : '#######',
      );
      expect(result.callbackValues).toEqual(['private']);
      expect(result.callbackElements).toEqual(['SELECT']);
      expect(result.replayIndices).toEqual(
        masking === 'passthrough' ? [1] : [],
      );
    },
  );
}

for (const masking of ['unmasked', 'passthrough'] as const) {
  it.each<Change>(['setAttribute', 'defaultSelected', 'removeAttribute'])(
    `preserves permitted attribute-driven choices (${masking}, %s)`,
    async (change) => {
      const result = await capture(masking, 'direct', change);
      if (masking === 'unmasked') {
        expect(result.selectedMutations).toEqual([
          {
            id: result.optionId,
            attributes: { selected: change === 'removeAttribute' ? null : '' },
          },
        ]);
      }
      expect(result.replayIndices).toEqual(result.liveIndices);
      expect(result.liveIndices).toEqual(
        change === 'removeAttribute' ? [0] : [1],
      );
      if (masking === 'passthrough') {
        const value = change === 'removeAttribute' ? 'public' : 'private';
        expect(result.selectedMutations).toEqual([]);
        expect(result.inputs).toHaveLength(1);
        expect(result.inputs[0].text).toBe(value);
        expect(result.callbackValues).toEqual([value]);
        expect(result.callbackElements).toEqual(['SELECT']);
      }
    },
  );
}
