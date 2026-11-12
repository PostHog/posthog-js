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
  await page.setContent(
    '<select><option value="public" selected>Public</option><optgroup><option value="blocked-selection-secret">Other</option></optgroup></select>',
  );
  await page.evaluate(code);
});
afterEach(async () => {
  await page.close();
});
afterAll(async () => {
  await browser.close();
});

it.each(['option', 'optgroup', 'select', 'ignore class', 'ignore selector'])(
  'respects current privacy rules (%s)',
  async (rule) => {
    const result = await page.evaluate(async (rule) => {
      const { record } = (window as unknown as TestWindow).rrweb;
      const select = document.querySelector('select')!;
      if (rule === 'ignore class') select.className = 'rr-ignore';
      else if (rule === 'ignore selector')
        select.setAttribute('data-ignore', '');
      else if (rule === 'option') select.options[1].className = 'rr-block';
      else document.querySelector(rule)!.className = 'rr-block';
      const events: eventWithTime[] = [];
      const values: string[] = [];
      const stop = record({
        maskAllInputs: true,
        ignoreSelector: '[data-ignore]',
        maskInputFn: (value) => {
          values.push(value);
          return value;
        },
        emit: (event) => events.push(event),
      })!;
      values.length = 0;
      select.options[1].setAttribute('selected', '');
      await new Promise((resolve) => setTimeout(resolve, 20));
      stop();
      return {
        values,
        payload: JSON.stringify(events),
        selectedMutations: events.flatMap((event) =>
          event.type === 3 && event.data.source === 0
            ? event.data.attributes.filter((item) =>
                Object.hasOwn(item.attributes, 'selected'),
              )
            : [],
        ),
        inputs: events.flatMap((event) =>
          event.type === 3 && event.data.source === 5 ? [event.data] : [],
        ),
      };
    }, rule);
    expect(result.selectedMutations).toEqual([]);
    if (rule === 'option' || rule === 'optgroup') {
      expect(result.values).toEqual(['']);
      expect(result.inputs).toHaveLength(1);
      expect(result.inputs[0].text).toBe('');
      expect(result.payload).not.toContain('blocked-selection-secret');
    } else {
      expect(result.values).toEqual([]);
      expect(result.inputs).toEqual([]);
    }
  },
);

it('does not retain a select receiver when input observer setup fails', async () => {
  const result = await page.evaluate(async () => {
    const { record } = (window as unknown as TestWindow).rrweb;
    const events: eventWithTime[] = [];
    const errors: string[] = [];
    const descriptor = Object.getOwnPropertyDescriptor;
    let stop: () => void;
    try {
      Object.getOwnPropertyDescriptor = function (target, name) {
        if (target === HTMLInputElement.prototype && name === 'value')
          throw new Error('input-observer-unavailable');
        return descriptor(target, name);
      };
      stop = record({
        maskAllInputs: true,
        errorHandler: (error) => {
          errors.push(String(error));
          return true;
        },
        emit: (event) => events.push(event),
      })!;
    } finally {
      Object.getOwnPropertyDescriptor = descriptor;
    }
    const select = document.querySelector('select')!;
    select.options[1].setAttribute('selected', '');
    select.setAttribute('data-tick', '1');
    await new Promise((resolve) => setTimeout(resolve, 20));
    stop();
    return {
      errors,
      inputs: events.filter(
        (event) => event.type === 3 && event.data.source === 5,
      ),
      mutations: events.filter(
        (event) => event.type === 3 && event.data.source === 0,
      ),
    };
  });
  expect(result.errors).toEqual(['Error: input-observer-unavailable']);
  expect(result.mutations.length).toBeGreaterThan(0);
  expect(result.inputs).toEqual([]);
});

it('coalesces selected attributes and serializes new options before the input', async () => {
  const result = await page.evaluate(async () => {
    const { record } = (window as unknown as TestWindow).rrweb;
    const select = document.querySelector('select')!;
    const events: eventWithTime[] = [];
    const values: string[] = [];
    const stop = record({
      maskAllInputs: true,
      maskInputFn: (value) => {
        values.push(value);
        return value;
      },
      emit: (event) => events.push(event),
    })!;
    values.length = 0;
    const getter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      'selectedOptions',
    )!.get!;
    let scans = 0;
    Object.defineProperty(select, 'selectedOptions', {
      get() {
        scans++;
        return getter.call(this);
      },
    });
    select.replaceChildren();
    for (let i = 0; i < 100; i++) {
      const option = new Option(String(i), String(i));
      select.appendChild(option);
      option.setAttribute('selected', '');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    stop();
    const inputIndex = events.findIndex(
      (event) => event.type === 3 && event.data.source === 5,
    );
    const addIndex = events.findIndex(
      (event) =>
        event.type === 3 &&
        event.data.source === 0 &&
        event.data.adds.length > 0,
    );
    return {
      scans,
      values,
      inputIndex,
      addIndex,
      inputs: events.flatMap((event) =>
        event.type === 3 && event.data.source === 5 ? [event.data] : [],
      ),
    };
  });
  expect(result.scans).toBe(1);
  expect(result.values).toEqual(['99']);
  expect(result.inputs).toHaveLength(1);
  expect(result.inputs[0].text).toBe('99');
  expect(result.addIndex).toBeGreaterThan(-1);
  expect(result.inputIndex).toBeGreaterThan(result.addIndex);
});

it('does not scan or emit selection after a mutation callback stops recording', async () => {
  const result = await page.evaluate(async () => {
    const { record } = (window as unknown as TestWindow).rrweb;
    const select = document.querySelector('select')!;
    const events: eventWithTime[] = [];
    let stopped = false;
    const stop = record({
      maskAllInputs: true,
      emit: (event) => {
        events.push(event);
        if (event.type === 3 && event.data.source === 0) {
          stop();
          stopped = true;
        }
      },
    })!;
    const getter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      'selectedOptions',
    )!.get!;
    let scans = 0;
    Object.defineProperty(select, 'selectedOptions', {
      get() {
        scans++;
        return getter.call(this);
      },
    });
    select.options[1].setAttribute('selected', '');
    select.setAttribute('data-tick', '1');
    await new Promise((resolve) => setTimeout(resolve, 20));
    return {
      scans,
      stopped,
      inputs: events.filter(
        (event) => event.type === 3 && event.data.source === 5,
      ),
    };
  });
  expect(result.stopped).toBe(true);
  expect(result.scans).toBe(0);
  expect(result.inputs).toEqual([]);
});

it('skips a select detached by a mutation emission callback', async () => {
  const result = await page.evaluate(async () => {
    const { record } = (window as unknown as TestWindow).rrweb;
    const select = document.querySelector('select')!;
    const events: eventWithTime[] = [];
    let detached = false;
    const stop = record({
      maskAllInputs: true,
      emit: (event) => {
        events.push(event);
        if (!detached && event.type === 3 && event.data.source === 0) {
          detached = true;
          select.remove();
        }
      },
    })!;
    select.options[1].setAttribute('selected', '');
    select.setAttribute('data-tick', '1');
    await new Promise((resolve) => setTimeout(resolve, 20));
    stop();
    return {
      detached,
      inputs: events.filter(
        (event) => event.type === 3 && event.data.source === 5,
      ),
    };
  });
  expect(result.detached).toBe(true);
  expect(result.inputs).toEqual([]);
});

it('holds selected changes with frozen mutations until the next snapshot', async () => {
  const result = await page.evaluate(async () => {
    const { record } = (window as unknown as TestWindow).rrweb;
    const select = document.querySelector('select')!;
    const events: eventWithTime[] = [];
    const stop = record({
      maskAllInputs: true,
      emit: (event) => events.push(event),
    })!;
    record.freezePage();
    select.options[1].defaultSelected = true;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const frozenInputs = events.filter(
      (event) => event.type === 3 && event.data.source === 5,
    ).length;
    record.takeFullSnapshot();
    stop();
    return {
      frozenInputs,
      inputs: events.flatMap((event) =>
        event.type === 3 && event.data.source === 5 ? [event.data] : [],
      ),
    };
  });
  expect(result.frozenInputs).toBe(0);
  expect(result.inputs).toHaveLength(1);
  expect(result.inputs[0].text).toBe(
    '*'.repeat('blocked-selection-secret'.length),
  );
  expect(result.inputs[0].id).toBeGreaterThan(0);
});

it('keeps the next recorder registered when the previous stop runs again', async () => {
  const result = await page.evaluate(async () => {
    const { record } = (window as unknown as TestWindow).rrweb;
    const first: eventWithTime[] = [];
    const second: eventWithTime[] = [];
    const stopFirst = record({
      maskAllInputs: true,
      emit: (event) => first.push(event),
    })!;
    stopFirst();
    first.length = 0;
    const stopSecond = record({
      maskAllInputs: true,
      emit: (event) => second.push(event),
    })!;
    stopFirst();
    document.querySelector('select')!.options[1].defaultSelected = true;
    await new Promise((resolve) => setTimeout(resolve, 20));
    stopSecond();
    return {
      first,
      inputs: second.flatMap((event) =>
        event.type === 3 && event.data.source === 5 ? [event.data] : [],
      ),
    };
  });
  expect(result.first).toEqual([]);
  expect(result.inputs).toHaveLength(1);
  expect(result.inputs[0].text).toBe(
    '*'.repeat('blocked-selection-secret'.length),
  );
});
