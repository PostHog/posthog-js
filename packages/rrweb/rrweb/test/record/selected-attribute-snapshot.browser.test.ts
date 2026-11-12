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
    '<select><option value="public" selected>Public</option><option value="private">Private</option></select>',
  );
  await page.evaluate(code);
});
afterEach(async () => {
  await page.close();
});
afterAll(async () => {
  await browser.close();
});

for (const masker of ['passthrough', 'redactor'] as const) {
  it.each([true, false])(
    `keeps the restored update after a full snapshot (${masker}, virtual=%s)`,
    async (useVirtualDom) => {
      const result = await page.evaluate(
        async ({ masker, useVirtualDom }) => {
          const { record, Replayer } = (window as unknown as TestWindow).rrweb;
          const select = document.querySelector('select')!;
          const option = select.options[1];
          const events: eventWithTime[] = [];
          const stop = record({
            maskAllInputs: true,
            maskInputFn: (text) =>
              masker === 'passthrough' ? text : 'redacted',
            emit: (event) => events.push(event),
          })!;
          option.setAttribute('selected', '');
          await new Promise((resolve) => setTimeout(resolve, 20));
          const initialInputs = events.flatMap((event) =>
            event.type === 3 && event.data.source === 5
              ? [event.data.text]
              : [],
          );
          option.removeAttribute('selected');
          const snapshotLiveIndex = select.selectedIndex;
          record.takeFullSnapshot();
          const snapshotIndex = events.findLastIndex(
            (event) => event.type === 2,
          );
          const meta = record.mirror.getMeta(select)!;
          const snapshotValue =
            meta.type === 2 ? meta.attributes.value : undefined;
          option.setAttribute('selected', '');
          await new Promise((resolve) => setTimeout(resolve, 20));
          const liveIndex = select.selectedIndex;
          stop();
          const inputs = events
            .slice(snapshotIndex + 1)
            .flatMap((event) =>
              event.type === 3 && event.data.source === 5 ? [event.data] : [],
            );
          const replayer = new Replayer(events, { useVirtualDom });
          replayer.pause(
            events[events.length - 1].timestamp - events[0].timestamp + 1,
          );
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          const replayIndex =
            replayer.iframe.contentDocument!.querySelector(
              'select',
            )!.selectedIndex;
          replayer.destroy();
          return {
            initialInputs,
            snapshotLiveIndex,
            snapshotValue,
            inputs,
            liveIndex,
            replayIndex,
          };
        },
        { masker, useVirtualDom },
      );
      const text = masker === 'passthrough' ? 'private' : 'redacted';
      expect(result.initialInputs).toEqual([text]);
      expect(result.snapshotLiveIndex).toBe(0);
      expect(result.snapshotValue).toBe(
        masker === 'passthrough' ? 'public' : 'redacted',
      );
      expect(result.liveIndex).toBe(1);
      expect(result.inputs).toHaveLength(1);
      expect(result.inputs[0].text).toBe(text);
      expect(result.inputs[0].id).toBeGreaterThan(0);
      expect(result.inputs[0]).not.toHaveProperty('selectedOptionIds');
      expect(result.replayIndex).toBe(masker === 'passthrough' ? 1 : -1);
    },
  );
}

it('invalidates before a full-snapshot emit callback restores and stops', async () => {
  const result = await page.evaluate(async () => {
    const { record, Replayer } = (window as unknown as TestWindow).rrweb;
    const select = document.querySelector('select')!;
    const option = select.options[1];
    const events: eventWithTime[] = [];
    let restoreOnSnapshot = false;
    const stop = record({
      maskAllInputs: true,
      maskInputFn: (text) => text,
      emit: (event) => {
        events.push(event);
        if (restoreOnSnapshot && event.type === 2) {
          option.setAttribute('selected', '');
          select.dispatchEvent(new Event('change', { bubbles: true }));
          stop();
        }
      },
    })!;
    option.setAttribute('selected', '');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const initialInputs = events.flatMap((event) =>
      event.type === 3 && event.data.source === 5 ? [event.data.text] : [],
    );
    option.removeAttribute('selected');
    restoreOnSnapshot = true;
    record.takeFullSnapshot();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const snapshotIndex = events.findLastIndex((event) => event.type === 2);
    const afterSnapshot = events
      .slice(snapshotIndex + 1)
      .flatMap((event) =>
        event.type === 3 && event.data.source === 5 ? [event.data.text] : [],
      );
    const replayer = new Replayer(events, { useVirtualDom: false });
    replayer.pause(
      events[events.length - 1].timestamp - events[0].timestamp + 1,
    );
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const replayIndex =
      replayer.iframe.contentDocument!.querySelector('select')!.selectedIndex;
    replayer.destroy();
    return { initialInputs, afterSnapshot, replayIndex };
  });
  expect(result.initialInputs).toEqual(['private']);
  expect(result.afterSnapshot).toEqual(['private']);
  expect(result.replayIndex).toBe(1);
});

it('does not duplicate unrelated text inputs after an automatic checkout', async () => {
  const result = await page.evaluate(() => {
    const { record } = (window as unknown as TestWindow).rrweb;
    const input = document.createElement('input');
    input.value = 'public';
    document.body.appendChild(input);
    const events: eventWithTime[] = [];
    const stop = record({
      maskAllInputs: false,
      checkoutEveryNth: 1,
      emit: (event) => events.push(event),
    })!;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    stop();
    return {
      snapshots: events.filter((event) => event.type === 2).length,
      inputs: events.flatMap((event) =>
        event.type === 3 && event.data.source === 5 ? [event.data.text] : [],
      ),
    };
  });
  expect(result.snapshots).toBeGreaterThan(1);
  expect(result.inputs).toEqual(['public']);
});

it('still deduplicates repeated inputs without another snapshot', async () => {
  const inputs = await page.evaluate(async () => {
    const { record } = (window as unknown as TestWindow).rrweb;
    const select = document.querySelector('select')!;
    const events: eventWithTime[] = [];
    const stop = record({
      maskAllInputs: true,
      maskInputFn: (text) => text,
      emit: (event) => events.push(event),
    })!;
    for (let i = 0; i < 3; i++)
      select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    stop();
    return events.flatMap((event) =>
      event.type === 3 && event.data.source === 5 ? [event.data.text] : [],
    );
  });
  expect(inputs).toEqual(['public']);
});
