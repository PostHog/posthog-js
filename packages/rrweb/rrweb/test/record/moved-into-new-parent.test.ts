import * as path from 'path';
import { vi } from 'vitest';
import type * as puppeteer from 'puppeteer';

import { launchPuppeteer, waitForRAF } from '../utils';
import { EventType } from '@posthog/rrweb-types';
import type { eventWithTime, listenerHandler } from '@posthog/rrweb-types';
import type { recordOptions } from '../../src/types';

interface IWindow extends Window {
  rrweb: {
    record: (
      options: recordOptions<eventWithTime>,
    ) => listenerHandler | undefined;
    Replayer: new (
      events: eventWithTime[],
      config: Record<string, unknown>,
    ) => { pause(timeOffset: number): void; iframe: HTMLIFrameElement };
  };
  emit: (e: eventWithTime) => undefined;
  stopRecording?: listenerHandler;
}

const pageContent = `<!DOCTYPE html><html><body>
  <div id="app"><div id="modal"><h1 id="header">Header</h1><p id="content">Body</p></div></div>
</body></html>`;

describe('nodes moved into a new parent', () => {
  vi.setConfig({ testTimeout: 30_000 });
  let browser: puppeteer.Browser;
  let page: puppeteer.Page;
  let events: eventWithTime[];

  beforeAll(async () => {
    browser = await launchPuppeteer();
  });

  afterAll(async () => {
    await browser?.close();
  });

  beforeEach(async () => {
    page = await browser.newPage();
    await page.goto('about:blank');
    await page.setContent(pageContent);
    await page.addScriptTag({
      path: path.resolve(__dirname, '../../dist/rrweb.umd.cjs'),
    });
    events = [];
    await page.exposeFunction('emit', (e: eventWithTime) => {
      if (e.type === EventType.DomContentLoaded || e.type === EventType.Load) {
        return;
      }
      events.push(e);
    });
  });

  afterEach(async () => {
    await page.close();
  });

  it('keeps them when their ancestor is moved in the same batch', async () => {
    await page.evaluate(() => {
      const win = window as unknown as IWindow;
      win.stopRecording = win.rrweb.record({ emit: win.emit });
    });
    await waitForRAF(page);
    // what Ionic does when it presents an inline modal: wrap the modal's
    // children in a new element and move the modal to the end of its parent
    await page.evaluate(() => {
      const app = document.getElementById('app')!;
      const modal = document.getElementById('modal')!;
      const wrapper = document.createElement('div');
      wrapper.id = 'wrapper';
      wrapper.append(...Array.from(modal.children));
      modal.appendChild(wrapper);
      app.appendChild(modal);
    });
    await waitForRAF(page);

    const structure = await page.evaluate(async (recorded) => {
      const win = window as unknown as IWindow;
      win.stopRecording?.();
      // a trailing event so seeking to the end applies the last mutation
      recorded.push({
        type: 5, // EventType.Custom; the enum isn't available in the page
        data: { tag: 'end', payload: {} },
        timestamp: Date.now(),
      } as eventWithTime);
      const describe = (el: Element): string =>
        `${el.tagName.toLowerCase()}#${el.id}(${Array.from(el.children)
          .map(describe)
          .join(',')})`;
      const live = describe(document.getElementById('app')!);

      const root = document.createElement('div');
      document.body.appendChild(root);
      const replayer = new win.rrweb.Replayer(recorded, {
        root,
        showWarning: false,
      });
      replayer.pause(
        recorded[recorded.length - 1].timestamp - recorded[0].timestamp,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      const replayedApp =
        replayer.iframe.contentDocument!.getElementById('app');
      return { live, replayed: replayedApp ? describe(replayedApp) : null };
    }, events);

    expect(structure.live).toBe(
      'div#app(div#modal(div#wrapper(h1#header(),p#content())))',
    );
    expect(structure.replayed).toBe(structure.live);
  });
});
