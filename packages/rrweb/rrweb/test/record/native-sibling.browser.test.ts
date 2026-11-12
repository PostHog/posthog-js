import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { Browser, Page } from 'puppeteer';
import type { eventWithTime } from '@posthog/rrweb-types';
import { launchPuppeteer } from '../utils';

describe('native sibling positions in recorded additions', () => {
  let browser: Browser;
  let page: Page;
  const code = readFileSync(
    resolve(__dirname, '../../dist/rrweb.umd.cjs'),
    'utf8',
  );

  beforeAll(async () => {
    browser = await launchPuppeteer();
  });
  beforeEach(async () => {
    page = await browser.newPage();
    await page.setContent(
      '<!DOCTYPE html><main id="fixture"><!-- ignored --><b id="last">last</b></main>',
    );
    await page.evaluate(code);
  });
  afterEach(async () => {
    await page.close();
  });
  afterAll(async () => {
    await browser.close();
  });

  it.each(['added nodes', 'ignored sibling'])(
    'replays insertions in order with nextSibling patched on %s',
    async (patched) => {
      const result = await page.evaluate(async (patched) => {
        const { record, Replayer } = (
          window as unknown as {
            rrweb: typeof import('../../src');
          }
        ).rrweb;
        const events: eventWithTime[] = [];
        const stop = record({
          slimDOMOptions: { comment: true },
          emit: (event) => events.push(event),
        })!;
        const fixture = document.querySelector('#fixture')!;
        const ignored = fixture.firstChild!;
        const first = document.createElement('span');
        first.id = 'first';
        const second = document.createElement('span');
        second.id = 'second';
        const nodes = patched === 'added nodes' ? [first, second] : [ignored];
        for (const node of nodes) {
          Object.defineProperty(node, 'nextSibling', { get: () => null });
        }
        const fragment = document.createDocumentFragment();
        fragment.append(first, second);
        fixture.insertBefore(fragment, ignored);
        await new Promise((resolve) => setTimeout(resolve, 0));
        stop();
        const recorded = Array.from(fixture.children, (node) => node.id);
        const replayer = new Replayer(events);
        replayer.pause(
          events[events.length - 1].timestamp - events[0].timestamp + 1,
        );
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        const replayed = Array.from(
          replayer.iframe.contentDocument!.querySelector('#fixture')!.children,
          (node) => node.id,
        );
        replayer.destroy();
        return { recorded, replayed };
      }, patched);
      expect(result.recorded).toEqual(['first', 'second', 'last']);
      expect(result.replayed).toEqual(result.recorded);
    },
  );
});
