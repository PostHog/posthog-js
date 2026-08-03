import * as fs from 'fs';
import * as path from 'path';
import type * as puppeteer from 'puppeteer';
import { vi } from 'vitest';
import type { recordOptions } from '../../src/types';
import {
  eventWithTime,
  EventType,
  IncrementalSource,
  listenerHandler,
  mutationData,
} from '@posthog/rrweb-types';
import { launchPuppeteer, waitForRAF } from '../utils';

interface IWindow extends Window {
  rrweb: {
    record: (
      options: recordOptions<eventWithTime>
    ) => listenerHandler | undefined;
  };
  emit: (e: eventWithTime) => undefined;
}

function attributeMutations(events: eventWithTime[]) {
  return events
    .filter(
      (e) =>
        e.type === EventType.IncrementalSnapshot &&
        (e.data as { source: number }).source === IncrementalSource.Mutation
    )
    .flatMap((e) => (e.data as mutationData).attributes)
    .map((mutation) => mutation.attributes);
}

describe('record: attribute masking', () => {
  vi.setConfig({ testTimeout: 100_000 });

  let browser: puppeteer.Browser;
  let page: puppeteer.Page;
  let code: string;
  let events: eventWithTime[];

  beforeAll(async () => {
    browser = await launchPuppeteer();
    code = fs.readFileSync(
      path.resolve(__dirname, '../../dist/rrweb.umd.cjs'),
      'utf8'
    );
  });

  beforeEach(async () => {
    page = await browser.newPage();
    await page.goto('about:blank');
    await page.setContent(`
      <div id="target" style="color: red"></div>
      <svg><use id="icon"></use></svg>
      <iframe id="frame" sandbox="" srcdoc="<p>opaque</p>"></iframe>
    `);
    await page.evaluate(code);
    events = [];
    await page.exposeFunction('emit', (event: eventWithTime) => {
      if (
        event.type !== EventType.DomContentLoaded &&
        event.type !== EventType.Load
      ) {
        events.push(event);
      }
    });
  });

  afterEach(async () => {
    await page.close();
  });

  afterAll(async () => {
    await browser?.close();
  });

  it('does not let compact styleDiff overwrite a callback mask', async () => {
    await page.evaluate(() => {
      (window as unknown as IWindow).rrweb.record({
        emit: (window as unknown as IWindow).emit,
        maskAttributeFn: (name, value) =>
          name === 'style' ? '[STYLE-MASKED]' : value,
      });
    });
    await waitForRAF(page);
    events = [];

    await page.evaluate(() => {
      document
        .getElementById('target')!
        .setAttribute(
          'style',
          'color: blue; background-color: red; border-color: green; outline-color: black;'
        );
    });
    await waitForRAF(page);

    expect(attributeMutations(events)).toContainEqual({
      style: '[STYLE-MASKED]',
    });
  });

  it('masks style and ordinary rendering attributes with the coarse option', async () => {
    await page.evaluate(() => {
      (window as unknown as IWindow).rrweb.record({
        emit: (window as unknown as IWindow).emit,
        maskAllElementAttributes: true,
      });
    });
    await waitForRAF(page);
    events = [];

    await page.evaluate(() => {
      const target = document.getElementById('target')!;
      target.setAttribute('class', 'alice@example.com');
      target.setAttribute('style', '--owner: alice@example.com');
      target.setAttribute('title', 'alice@example.com');
    });
    await waitForRAF(page);

    const attributes = Object.assign({}, ...attributeMutations(events));
    expect(attributes.class).toMatch(/^\*+$/);
    expect(attributes.style).toMatch(/^\*+$/);
    expect(attributes.title).toMatch(/^\*+$/);
    expect(JSON.stringify(attributes)).not.toContain('alice@example.com');
  });

  it('uses qualified names for SVG namespace mutations and preserves removals', async () => {
    await page.evaluate(() => {
      (window as unknown as IWindow).rrweb.record({
        emit: (window as unknown as IWindow).emit,
        maskAttributeFn: (name, value, element) =>
          element instanceof SVGElement ? `[${name}-MASKED]` : value,
      });
    });
    await waitForRAF(page);
    events = [];

    await page.evaluate(() => {
      document
        .getElementById('icon')!
        .setAttributeNS(
          'http://www.w3.org/1999/xlink',
          'xlink:href',
          '/sprites.svg#alice@example.com'
        );
    });
    await waitForRAF(page);

    expect(attributeMutations(events)).toContainEqual({
      'xlink:href': '[xlink:href-MASKED]',
    });

    events = [];
    await page.evaluate(() => {
      document
        .getElementById('icon')!
        .removeAttributeNS('http://www.w3.org/1999/xlink', 'href');
    });
    await waitForRAF(page);

    expect(attributeMutations(events)).toContainEqual({
      'xlink:href': null,
    });
  });

  it('masks an inaccessible iframe mutation under rr_src', async () => {
    await page.evaluate(() => {
      (window as unknown as IWindow).rrweb.record({
        emit: (window as unknown as IWindow).emit,
        maskAttributeFn: (name, value) =>
          name === 'rr_src' ? '[IFRAME-SOURCE-MASKED]' : value,
      });
    });
    await waitForRAF(page);
    events = [];

    await page.evaluate(() => {
      document
        .getElementById('frame')!
        .setAttribute('src', 'https://example.com/?email=alice@example.com');
    });
    await waitForRAF(page);

    expect(attributeMutations(events)).toContainEqual({
      rr_src: '[IFRAME-SOURCE-MASKED]',
    });
  });
});
