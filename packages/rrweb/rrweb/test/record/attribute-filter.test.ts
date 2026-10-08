import * as fs from 'fs';
import * as path from 'path';
import type * as puppeteer from 'puppeteer';
import { vi } from 'vitest';
import type { recordOptions } from '../../src/types';
import {
  listenerHandler,
  eventWithTime,
  EventType,
  IncrementalSource,
  mutationData,
} from '@posthog/rrweb-types';
import { getServerURL, launchPuppeteer, startServer, waitForRAF } from '../utils';
import type { Server } from 'http';

interface ISuite {
  code: string;
  browser: puppeteer.Browser;
  page: puppeteer.Page;
  events: eventWithTime[];
  server: Server;
  serverURL: string;
}

interface IWindow extends Window {
  rrweb: {
    record: (
      options: recordOptions<eventWithTime>,
    ) => listenerHandler | undefined;
  };
  emit: (e: eventWithTime) => undefined;
}

const CONTENT = `
  <!DOCTYPE html>
  <html>
    <body>
      <div id="target" class="initial" style="color: red;">hello</div>
      <div id="shadow-host"></div>
    </body>
  </html>
`;

function attributeMutations(events: eventWithTime[]) {
  return events
    .filter(
      (e) =>
        e.type === EventType.IncrementalSnapshot &&
        (e.data as { source: number }).source === IncrementalSource.Mutation,
    )
    .flatMap((e) => (e.data as mutationData).attributes)
    .flatMap((a) => Object.keys(a.attributes));
}

describe('record: attributeFilter', function (this: ISuite) {
  vi.setConfig({ testTimeout: 100_000 });

  const ctx = {} as ISuite;

  beforeAll(async () => {
    ctx.server = await startServer();
    ctx.serverURL = getServerURL(ctx.server);
    ctx.browser = await launchPuppeteer();

    const bundlePath = path.resolve(__dirname, '../../dist/rrweb.umd.cjs');
    ctx.code = fs.readFileSync(bundlePath, 'utf8');
  });

  afterAll(async () => {
    await ctx.browser?.close();
    ctx.server?.close();
  });

  beforeEach(async () => {
    ctx.page = await ctx.browser.newPage();
    await ctx.page.goto('about:blank');
    await ctx.page.setContent(CONTENT);
    await ctx.page.evaluate(ctx.code);

    ctx.events = [];
    await ctx.page.exposeFunction('emit', (e: eventWithTime) => {
      if (e.type === EventType.DomContentLoaded || e.type === EventType.Load) {
        return;
      }
      ctx.events.push(e);
    });

    ctx.page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
  });

  afterEach(async () => {
    await ctx.page.close();
  });

  it('records all attribute mutations when attributeFilter is not set', async () => {
    await ctx.page.evaluate(() => {
      const { record } = (window as unknown as IWindow).rrweb;
      record({
        emit: (window as unknown as IWindow).emit,
      });
      const target = document.getElementById('target')!;
      target.setAttribute('style', 'color: blue;');
      target.setAttribute('class', 'changed');
      target.setAttribute('data-foo', 'bar');
    });
    await waitForRAF(ctx.page);

    const mutated = attributeMutations(ctx.events);
    expect(mutated).toContain('style');
    expect(mutated).toContain('class');
    expect(mutated).toContain('data-foo');
  });

  it('only records mutations for listed attributes when attributeFilter is set', async () => {
    await ctx.page.evaluate(() => {
      const { record } = (window as unknown as IWindow).rrweb;
      record({
        emit: (window as unknown as IWindow).emit,
        attributeFilter: ['class'],
      });
      const target = document.getElementById('target')!;
      target.setAttribute('style', 'color: blue;');
      target.setAttribute('class', 'changed');
      target.setAttribute('data-foo', 'bar');
    });
    await waitForRAF(ctx.page);

    const mutated = attributeMutations(ctx.events);
    expect(mutated).toContain('class');
    expect(mutated).not.toContain('style');
    expect(mutated).not.toContain('data-foo');
  });

  it('applies the filter to mutations inside shadow roots', async () => {
    await ctx.page.evaluate(() => {
      const { record } = (window as unknown as IWindow).rrweb;
      record({
        emit: (window as unknown as IWindow).emit,
        attributeFilter: ['class'],
      });
      const host = document.getElementById('shadow-host')!;
      const shadow = host.attachShadow({ mode: 'open' });
      const inner = document.createElement('div');
      inner.id = 'inner';
      shadow.appendChild(inner);
    });
    await waitForRAF(ctx.page);
    await ctx.page.evaluate(() => {
      const host = document.getElementById('shadow-host')!;
      const inner = host.shadowRoot!.getElementById('inner')!;
      inner.setAttribute('style', 'color: blue;');
      inner.setAttribute('class', 'shadow-changed');
    });
    await waitForRAF(ctx.page);

    const mutated = attributeMutations(ctx.events);
    expect(mutated).toContain('class');
    expect(mutated).not.toContain('style');
  });

  it('treats an empty attributeFilter as unset rather than observing nothing', async () => {
    await ctx.page.evaluate(() => {
      const { record } = (window as unknown as IWindow).rrweb;
      record({
        emit: (window as unknown as IWindow).emit,
        attributeFilter: [],
      });
      const target = document.getElementById('target')!;
      target.setAttribute('style', 'color: blue;');
    });
    await waitForRAF(ctx.page);

    const mutated = attributeMutations(ctx.events);
    expect(mutated).toContain('style');
  });

  it('still records childList and characterData mutations for filtered-out attributes', async () => {
    await ctx.page.evaluate(() => {
      const { record } = (window as unknown as IWindow).rrweb;
      record({
        emit: (window as unknown as IWindow).emit,
        attributeFilter: ['class'],
      });
      const target = document.getElementById('target')!;
      const child = document.createElement('span');
      child.textContent = 'added';
      target.appendChild(child);
      target.firstChild!.textContent = 'changed text';
    });
    await waitForRAF(ctx.page);

    const mutationEvents = ctx.events.filter(
      (e) =>
        e.type === EventType.IncrementalSnapshot &&
        (e.data as { source: number }).source === IncrementalSource.Mutation,
    );
    const adds = mutationEvents.flatMap((e) => (e.data as mutationData).adds);
    const texts = mutationEvents.flatMap((e) => (e.data as mutationData).texts);
    expect(adds.length).toBeGreaterThan(0);
    expect(texts.length).toBeGreaterThan(0);
  });
});
