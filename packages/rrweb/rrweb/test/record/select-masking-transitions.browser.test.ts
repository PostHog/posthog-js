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

async function transition(
  startMasked: boolean,
  mode: string,
  signal: string,
  multiple = true,
) {
  return page.evaluate(
    async ({ startMasked, mode, signal, multiple }) => {
      const { record, Replayer } = (window as unknown as TestWindow).rrweb;
      document.body.innerHTML = `<select ${multiple ? 'multiple' : ''} data-private="${startMasked}"><option value="redacted">A</option><option value="redacted" selected>B</option><option value="redacted" selected>C</option></select>`;
      const select = document.querySelector('select')!;
      const events: eventWithTime[] = [];
      const stop = record({
        maskAllInputs: true,
        selectMaskingFn: (element) => {
          if (element.dataset.broken === 'true')
            throw new Error('policy failed');
          return element.dataset.private === 'true' ? 'masked' : 'unmasked';
        },
        maskInputFn: () => 'redacted',
        emit: (event) => events.push(event),
      })!;
      const initialSnapshot = events.find((event) => event.type === 2)!;
      const initialBytes = JSON.stringify(initialSnapshot.data);
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (signal === 'frozen-input') record.freezePage();
      select.dataset.private = String(!startMasked);
      if (signal === 'empty') select.selectedIndex = -1;
      if (signal === 'error') select.dataset.broken = 'true';
      if (signal === 'snapshot') record.takeFullSnapshot();
      if (signal !== 'attribute')
        select.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 30));
      stop();
      const inputEvents = events.flatMap((event) =>
        event.type === 3 && event.data.source === 5 ? [event.data] : [],
      );
      const replayer = new Replayer(events, {
        useVirtualDom: mode === 'virtual-seek',
      });
      const duration =
        events[events.length - 1].timestamp - events[0].timestamp + 1;
      if (mode === 'play') {
        replayer.play();
        await new Promise((resolve) => setTimeout(resolve, duration + 80));
      } else replayer.pause(duration);
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const replayIndices = Array.from(
        replayer.iframe.contentDocument!.querySelector('select')!
          .selectedOptions,
        (option) => option.index,
      );
      replayer.pause(initialSnapshot.timestamp - events[0].timestamp + 1);
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const backwardIndices = Array.from(
        replayer.iframe.contentDocument!.querySelector('select')!
          .selectedOptions,
        (option) => option.index,
      );
      replayer.destroy();
      return {
        replayIndices,
        inputEvents,
        backwardIndices,
        initialSnapshotUnchanged:
          JSON.stringify(initialSnapshot.data) === initialBytes,
        fullSnapshots: events.filter((event) => event.type === 2).length,
      };
    },
    { startMasked, mode, signal, multiple },
  );
}

for (const mode of ['play', 'real-seek', 'virtual-seek']) {
  for (const startMasked of [false, true]) {
    it.each(['input', 'attribute', 'frozen-input'])(
      `updates policy without a checkout (initially masked=${startMasked}, ${mode}, %s)`,
      async (signal) => {
        const result = await transition(startMasked, mode, signal);
        expect(result.replayIndices).toEqual(startMasked ? [1, 2] : []);
        expect(result.fullSnapshots).toBe(1);
        expect(result.initialSnapshotUnchanged).toBe(true);
        expect(result.backwardIndices).toEqual(startMasked ? [] : [1, 2]);
        if (!startMasked) {
          expect(result.inputEvents.length).toBeGreaterThan(0);
          for (const input of result.inputEvents)
            expect(input).not.toHaveProperty('selectedOptionIds');
        }
      },
    );
    it(`a checkout establishes the new policy baseline (initially masked=${startMasked}, ${mode})`, async () => {
      const result = await transition(startMasked, mode, 'snapshot');
      expect(result.replayIndices).toEqual(startMasked ? [1, 2] : []);
      expect(result.fullSnapshots).toBe(2);
      expect(result.initialSnapshotUnchanged).toBe(true);
      expect(result.backwardIndices).toEqual(startMasked ? [] : [1, 2]);
    });
  }
  it(`policy exceptions mask a previously public select (${mode})`, async () => {
    const result = await transition(false, mode, 'error');
    expect(result.replayIndices).toEqual([]);
    expect(result.initialSnapshotUnchanged).toBe(true);
    expect(result.fullSnapshots).toBe(1);
    expect(result.inputEvents.length).toBeGreaterThan(0);
    for (const input of result.inputEvents)
      expect(input).not.toHaveProperty('selectedOptionIds');
  });
}

for (const startMasked of [false, true]) {
  it.each([false, true])(
    `re-evaluates policy after option-list changes (initially masked=${startMasked}, virtual=%s)`,
    async (virtual) => {
      const result = await page.evaluate(
        async ({ startMasked, virtual }) => {
          const { record, Replayer } = (window as unknown as TestWindow).rrweb;
          document.body.innerHTML =
            '<select multiple><option value="redacted">A</option><option value="redacted" selected>B</option><option value="redacted" selected>C</option></select>';
          const select = document.querySelector('select')!;
          const events: eventWithTime[] = [];
          const stop = record({
            maskAllInputs: true,
            selectMaskingFn: (element) =>
              (element.options.length === 3 ? startMasked : !startMasked)
                ? 'masked'
                : 'unmasked',
            maskInputFn: () => 'redacted',
            emit: (event) => events.push(event),
          })!;
          if (startMasked) select.options[0].remove();
          else select.add(new Option('D', 'redacted'));
          await new Promise((resolve) => setTimeout(resolve, 30));
          stop();
          const replayer = new Replayer(events, { useVirtualDom: virtual });
          replayer.pause(
            events[events.length - 1].timestamp - events[0].timestamp + 1,
          );
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          const indices = Array.from(
            replayer.iframe.contentDocument!.querySelector('select')!
              .selectedOptions,
            (option) => option.index,
          );
          replayer.destroy();
          return indices;
        },
        { startMasked, virtual },
      );
      expect(result).toEqual(startMasked ? [0, 1] : []);
    },
  );
}

for (const mode of ['play', 'real-seek', 'virtual-seek']) {
  for (const startMasked of [false, true]) {
    it.each(['input', 'attribute'])(
      `single-select transitions preserve identity (initially masked=${startMasked}, ${mode}, %s)`,
      async (signal) => {
        const result = await transition(startMasked, mode, signal, false);
        expect(result.replayIndices).toEqual(startMasked ? [2] : []);
        expect(result.backwardIndices).toEqual(startMasked ? [] : [2]);
        expect(result.initialSnapshotUnchanged).toBe(true);
        expect(result.fullSnapshots).toBe(1);
      },
    );
  }
}

it.each([false, true])(
  'preserves empty selections across policy transitions (initially masked=%s)',
  async (startMasked) => {
    const result = await transition(startMasked, 'virtual-seek', 'empty');
    expect(result.replayIndices).toEqual([]);
    expect(result.initialSnapshotUnchanged).toBe(true);
    const latest = result.inputEvents[result.inputEvents.length - 1];
    if (startMasked) expect(latest.selectedOptionIds).toEqual([]);
    else expect(latest).not.toHaveProperty('selectedOptionIds');
  },
);

it('batches policy-only writes without extra snapshots or repeated selected-set scans', async () => {
  const result = await page.evaluate(async () => {
    const { record } = (window as unknown as TestWindow).rrweb;
    document.body.innerHTML =
      '<select multiple data-private="false"><option value="a">A</option><option value="b" selected>B</option></select>';
    const select = document.querySelector('select')!;
    let scans = 0;
    const getSelectedOptions = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      'selectedOptions',
    )!.get!;
    Object.defineProperty(select, 'selectedOptions', {
      get() {
        scans++;
        return getSelectedOptions.call(select);
      },
    });
    const events: eventWithTime[] = [];
    const stop = record({
      maskAllInputs: true,
      selectMaskingFn: (element) =>
        element.dataset.private === 'true' ? 'masked' : 'unmasked',
      maskInputFn: () => 'redacted',
      emit: (event) => events.push(event),
    })!;
    scans = 0;
    for (let index = 0; index < 100; index++)
      select.dataset.private = String(index % 2 === 1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    stop();
    return {
      scans,
      inputs: events.filter(
        (event) => event.type === 3 && event.data.source === 5,
      ).length,
      snapshots: events.filter((event) => event.type === 2).length,
    };
  });
  expect(result).toEqual({ scans: 1, inputs: 1, snapshots: 1 });
});

for (const mode of ['play', 'real-seek', 'virtual-seek']) {
  it.each([false, true])(
    `preserves repeated transitions across a checkout and repeated scrubbing (${mode}, multiple=%s)`,
    async (multiple) => {
      const result = await page.evaluate(
        async ({ mode, multiple }) => {
          const { record, Replayer } = (window as unknown as TestWindow).rrweb;
          document.body.innerHTML = `<select ${multiple ? 'multiple' : ''} data-private="false"><option value="redacted">A</option><option value="redacted" selected>B</option><option value="redacted" selected>C</option></select>`;
          const select = document.querySelector('select')!;
          const events: eventWithTime[] = [];
          const snapshots: { event: eventWithTime; bytes: string }[] = [];
          const stop = record({
            maskAllInputs: true,
            maskInputFn: () => 'redacted',
            selectMaskingFn: (element) => {
              if (element.dataset.broken === 'true')
                throw new Error('policy failure');
              return element.dataset.private === 'true' ? 'masked' : 'unmasked';
            },
            emit: (event) => {
              events.push(event);
              if (event.type === 2)
                snapshots.push({ event, bytes: JSON.stringify(event.data) });
            },
          })!;
          const pause = (ms: number) =>
            new Promise((resolve) => setTimeout(resolve, ms));
          const frames = () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            );
          const checkpoints: number[] = [];
          const privateInputs: boolean[] = [];
          await pause(30);
          checkpoints.push(Date.now() - events[0].timestamp + 1);
          for (let index = 1; index <= 6; index++) {
            await pause(70);
            const before = events.length;
            select.dataset.private = String(index % 2 === 1 && index !== 5);
            select.dataset.broken = String(index === 5);
            if (index === 4) {
              record.freezePage();
              select.add(new Option('D', 'redacted'));
            }
            const chosen =
              index === 2
                ? []
                : index >= 4
                  ? multiple
                    ? [0, 3]
                    : [3]
                  : multiple
                    ? [0, 2]
                    : [1];
            Array.from(select.options).forEach((option, optionIndex) => {
              option.selected = chosen.includes(optionIndex);
            });
            if (!chosen.length) select.selectedIndex = -1;
            if (index === 3) record.takeFullSnapshot();
            select.dispatchEvent(new Event('change', { bubbles: true }));
            await pause(30);
            if (index % 2 === 1)
              privateInputs.push(
                ...events
                  .slice(before)
                  .flatMap((event) =>
                    event.type === 3 && event.data.source === 5
                      ? [Object.hasOwn(event.data, 'selectedOptionIds')]
                      : [],
                  ),
              );
            checkpoints.push(Date.now() - events[0].timestamp + 1);
          }
          await pause(70);
          record.addCustomEvent('end-select-masking-timeline', {});
          stop();
          const unchanged = () =>
            snapshots.every(
              ({ event, bytes }) => JSON.stringify(event.data) === bytes,
            );
          const unchangedAfterRecord = unchanged();
          const replayer = new Replayer(events, {
            useVirtualDom: mode === 'virtual-seek',
          });
          const indices = () =>
            Array.from(
              replayer.iframe.contentDocument!.querySelector('select')!
                .selectedOptions,
              (option) => option.index,
            );
          const played: number[][] = [];
          if (mode === 'play') {
            replayer.play();
            for (const offset of checkpoints) {
              const deadline = performance.now() + 5000;
              while (replayer.getCurrentTime() < offset) {
                if (performance.now() > deadline)
                  throw new Error('Playback did not reach checkpoint');
                await pause(5);
              }
              await frames();
              played.push(indices());
            }
          }
          const order = [6, 0, 4, 1, 3, 2, 5, 0, 6, 3, 4];
          const scrubbed: number[][] = [];
          for (const index of order) {
            replayer.pause(checkpoints[index]);
            await frames();
            scrubbed.push(indices());
          }
          const unchangedAfterReplay = unchanged();
          replayer.destroy();
          return {
            played,
            scrubbed,
            order,
            privateInputs,
            unchangedAfterRecord,
            unchangedAfterReplay,
            snapshots: snapshots.length,
          };
        },
        { mode, multiple },
      );
      const expected = [
        multiple ? [1, 2] : [2],
        [],
        [],
        [],
        multiple ? [0, 3] : [3],
        [],
        multiple ? [0, 3] : [3],
      ];
      if (mode === 'play') expect(result.played).toEqual(expected);
      expect(result.scrubbed).toEqual(
        result.order.map((index) => expected[index]),
      );
      expect(result.privateInputs.length).toBeGreaterThan(0);
      expect(result.privateInputs.every((hasIds) => !hasIds)).toBe(true);
      expect(result.snapshots).toBe(2);
      expect(result.unchangedAfterRecord).toBe(true);
      expect(result.unchangedAfterReplay).toBe(true);
    },
  );
}
