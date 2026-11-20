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
const markup =
  '<style>select,select::picker(select){appearance:base-select}</style><select data-private="false"><button><selectedcontent></selectedcontent></button><option value="a"><span data-choice="a">Alpha</span></option><option value="b"><span data-choice="b">Beta</span></option></select><selectedcontent id="unrelated">Outside</selectedcontent>';
let browser: Browser;
let page: Page;
beforeAll(async () => {
  // CI's legacy browser predates selectedcontent; other suites keep that browser.
  const executablePath = process.env.RRWEB_SELECTED_CONTENT_BROWSER;
  browser = await launchPuppeteer(
    executablePath ? { executablePath } : undefined,
  );
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

for (const stage of ['snapshot', 'change'] as const) {
  it.each(['masked', 'unmasked', 'legacy'] as const)(
    `handles native selected-content clones during ${stage} (%s)`,
    async (policy) => {
      const result = await page.evaluate(
        async ({ markup, stage, policy }) => {
          const { record } = (window as unknown as TestWindow).rrweb;
          document.body.innerHTML = markup;
          const select = document.querySelector('select')!;
          const content = select.querySelector('selectedcontent')!;
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          const before = content.textContent;
          const events: eventWithTime[] = [];
          const stop = record({
            maskAllInputs: false,
            maskInputFn: () => 'redacted',
            selectMaskingFn: policy === 'legacy' ? undefined : () => policy,
            emit: (event) => events.push(event),
          })!;
          if (stage === 'change') {
            select.value = 'b';
            select.dispatchEvent(new Event('change', { bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          const after = content.textContent;
          stop();
          const parents = new Map<number, number>();
          const containers = new Set<number>();
          const all: serializedNodeWithId[] = [];
          const visit = (node: serializedNodeWithId, parent = -1) => {
            parents.set(node.id, parent);
            all.push(node);
            if (
              node.type === 2 &&
              node.tagName === 'selectedcontent' &&
              !node.attributes.id
            )
              containers.add(node.id);
            if ('childNodes' in node)
              node.childNodes.forEach((child) => visit(child, node.id));
          };
          for (const event of events) {
            if (event.type === 2) visit(event.data.node);
            if (event.type === 3 && event.data.source === 0)
              event.data.adds.forEach((add) => visit(add.node, add.parentId));
          }
          const isClone = (id: number) => {
            let parent = parents.get(id);
            while (parent !== undefined && parent !== -1) {
              if (containers.has(parent)) return true;
              parent = parents.get(parent);
            }
            return false;
          };
          return {
            before,
            after,
            clones: all.filter((node) => isClone(node.id)),
            payload: JSON.stringify(events),
          };
        },
        { markup, stage, policy },
      );
      expect(result.before).toBe('Alpha');
      expect(result.after).toBe(stage === 'change' ? 'Beta' : 'Alpha');
      expect(result.payload).toContain('Alpha');
      expect(result.payload).toContain('Beta');
      expect(result.payload).toContain('Outside');
      if (policy === 'masked') expect(result.clones).toEqual([]);
      else expect(result.clones.length).toBeGreaterThan(0);
    },
  );
}

it.each(['dynamic', 'unmasked', 'legacy'] as const)(
  'filters changes to already-mirrored selected-content descendants (%s)',
  async (policy) => {
    const result = await page.evaluate(
      async ({ markup, policy }) => {
        const { record } = (window as unknown as TestWindow).rrweb;
        document.body.innerHTML = markup;
        const select = document.querySelector('select')!;
        const content = select.querySelector('selectedcontent')!;
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        const events: eventWithTime[] = [];
        const stop = record({
          maskAllInputs: false,
          maskInputFn: () => 'redacted',
          selectMaskingFn:
            policy === 'legacy'
              ? undefined
              : (element) =>
                  policy === 'dynamic' && element.dataset.private === 'true'
                    ? 'masked'
                    : 'unmasked',
          emit: (event) => events.push(event),
        })!;
        const span = content.querySelector('span')!;
        const mirrored = record.mirror.getId(span);
        const cutoff = events.length;
        select.dataset.private = 'true';
        span.setAttribute('data-choice', 'private-clone-attribute');
        (span.firstChild as Text).data = 'private-clone-text';
        await new Promise((resolve) => setTimeout(resolve, 50));
        const native = content.textContent;
        stop();
        return {
          mirrored,
          native,
          payload: JSON.stringify(events.slice(cutoff)),
        };
      },
      { markup, policy },
    );
    expect(result.mirrored).toBeGreaterThan(0);
    expect(result.native).toBe('private-clone-text');
    if (policy === 'dynamic') {
      expect(result.payload).not.toContain('private-clone-attribute');
      expect(result.payload).not.toContain('private-clone-text');
    } else {
      expect(result.payload).toContain('private-clone-attribute');
      expect(result.payload).toContain('private-clone-text');
    }
  },
);

it.each([false, true])(
  'replays selected-content policy transitions without extra snapshots (virtual=%s)',
  async (virtual) => {
    const result = await page.evaluate(
      async ({ markup, virtual }) => {
        const { record, Replayer } = (window as unknown as TestWindow).rrweb;
        document.body.innerHTML = markup;
        const select = document.querySelector('select')!;
        select.dataset.private = 'true';
        select.value = 'b';
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        const events: eventWithTime[] = [];
        const stop = record({
          maskAllInputs: false,
          maskInputFn: () => 'redacted',
          selectMaskingFn: (element) =>
            element.dataset.private === 'true' ? 'masked' : 'unmasked',
          emit: (event) => events.push(event),
        })!;
        const checkpoints: { time: number; masked: boolean }[] = [];
        for (const masked of [true, false, true, false]) {
          select.dataset.private = String(masked);
          select.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 40));
          record.addCustomEvent('checkpoint', {});
          checkpoints.push({
            time: events[events.length - 1].timestamp - events[0].timestamp + 1,
            masked,
          });
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        record.addCustomEvent('end', {});
        stop();
        const replayer = new Replayer(events, { useVirtualDom: virtual });
        const actual: {
          masked: boolean;
          selected: number;
          content: string | null;
        }[] = [];
        for (const point of [
          ...checkpoints,
          ...checkpoints.slice().reverse(),
        ]) {
          replayer.pause(point.time);
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          const replaySelect =
            replayer.iframe.contentDocument!.querySelector('select')!;
          actual.push({
            masked: point.masked,
            selected: replaySelect.selectedIndex,
            content: replaySelect.querySelector('selectedcontent')!.textContent,
          });
        }
        replayer.destroy();
        return {
          actual,
          snapshots: events.filter((event) => event.type === 2).length,
        };
      },
      { markup, virtual },
    );
    expect(result.snapshots).toBe(1);
    for (const row of result.actual) {
      expect(row.selected).toBe(row.masked ? -1 : 1);
      expect(row.content).toBe(row.masked ? '' : 'Beta');
    }
  },
);
