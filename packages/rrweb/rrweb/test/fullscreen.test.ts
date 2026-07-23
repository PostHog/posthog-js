import * as fs from 'fs';
import * as path from 'path';
import type * as puppeteer from 'puppeteer';
import { vi } from 'vitest';
import {
  EventType,
  FullscreenCustomEventTag,
  type customEvent,
  type eventWithTime,
  type fullscreenEventPayload,
  type listenerHandler,
  type recordOptions,
} from '@posthog/rrweb-types';
import { launchPuppeteer, waitForRAF } from './utils';

interface IWindow extends Window {
  rrweb: {
    record: ((
      options: recordOptions<eventWithTime>,
    ) => listenerHandler | undefined) & {
      mirror: { getId: (n: Node | null) => number };
    };
    Replayer: new (
      events: eventWithTime[],
      config?: Record<string, unknown>,
    ) => {
      pause: (timeOffset: number) => void;
      iframe: HTMLIFrameElement;
    };
  };
  emit: (e: eventWithTime) => void;
  replayer: InstanceType<IWindow['rrweb']['Replayer']>;
}

const CONTENT = `
  <!DOCTYPE html>
  <html>
    <body>
      <div id="target"></div>
      <div id="target2"></div>
    </body>
  </html>
`;

const fullscreenEvents = (events: eventWithTime[]) =>
  events.filter(
    (e): e is customEvent<fullscreenEventPayload> & { timestamp: number } =>
      e.type === EventType.Custom &&
      e.data.tag === FullscreenCustomEventTag,
  );

describe('record/replay native fullscreen', () => {
  vi.setConfig({ testTimeout: 15_000 });

  let browser: puppeteer.Browser;
  let code: string;
  let page: puppeteer.Page;
  let events: eventWithTime[];

  beforeAll(async () => {
    browser = await launchPuppeteer();
    code = fs.readFileSync(
      path.resolve(__dirname, '../dist/rrweb.umd.cjs'),
      'utf8',
    );
  });

  afterAll(async () => {
    await browser?.close();
  });

  beforeEach(async () => {
    page = await browser.newPage();
    await page.goto('about:blank');
    await page.setContent(CONTENT);
    await page.evaluate(code);
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

  // Drives a real `fullscreenchange` by shadowing `document.fullscreenElement`,
  // which is what the browser sets on native fullscreen (without any DOM change).
  const recordFullscreenSession = async (): Promise<number> => {
    const targetId = await page.evaluate(() => {
      const { record } = (window as unknown as IWindow).rrweb;
      record({ emit: (window as unknown as IWindow).emit });
      const target = document.getElementById('target') as HTMLElement;
      return (window as unknown as IWindow).rrweb.record.mirror.getId(target);
    });

    await page.evaluate(() => {
      const target = document.getElementById('target') as HTMLElement;
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        get: () => target,
      });
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    await page.waitForTimeout(50);
    await page.evaluate(() => {
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        get: () => null,
      });
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    await page.waitForTimeout(50);

    return targetId;
  };

  it('records fullscreen enter/exit as custom events carrying the element id', async () => {
    const targetId = await recordFullscreenSession();

    const fs = fullscreenEvents(events);
    expect(fs).toHaveLength(2);

    const [enter, exit] = fs;
    expect(enter.data.payload).toEqual({ id: targetId, enter: true });
    expect(exit.data.payload).toEqual({ id: targetId, enter: false });
    expect(targetId).toBeGreaterThan(0);
    expect(enter.timestamp).toBeLessThan(exit.timestamp);
  });

  it('emits nothing when the fullscreen element is not in the mirror', async () => {
    await page.evaluate(() => {
      const { record } = (window as unknown as IWindow).rrweb;
      record({ emit: (window as unknown as IWindow).emit });
      // A detached element was never serialized, so it has no mirror id.
      const orphan = document.createElement('div');
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        get: () => orphan,
      });
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    await page.waitForTimeout(50);

    expect(fullscreenEvents(events)).toHaveLength(0);
  });

  it('emits exit then enter when fullscreen switches directly between elements', async () => {
    const ids = await page.evaluate(() => {
      const { rrweb } = window as unknown as IWindow;
      rrweb.record({ emit: (window as unknown as IWindow).emit });
      return {
        a: rrweb.record.mirror.getId(document.getElementById('target')),
        b: rrweb.record.mirror.getId(document.getElementById('target2')),
      };
    });

    await page.evaluate(() => {
      const a = document.getElementById('target');
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        get: () => a,
      });
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    await page.waitForTimeout(20);
    // Switch straight to another element without exiting first — the browser
    // changes fullscreenElement directly, never passing through null.
    await page.evaluate(() => {
      const b = document.getElementById('target2');
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        get: () => b,
      });
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    await page.waitForTimeout(50);

    const payloads = fullscreenEvents(events).map((e) => e.data.payload);
    expect(payloads).toEqual([
      { id: ids.a, enter: true },
      { id: ids.a, enter: false },
      { id: ids.b, enter: true },
    ]);
  });

  it('replays fullscreen by toggling the marker attribute on the element', async () => {
    await recordFullscreenSession();

    const fs = fullscreenEvents(events);
    const baseline = events[0].timestamp;
    const enterOffset = fs[0].timestamp - baseline;
    const exitOffset = fs[1].timestamp - baseline;
    const snapshotOffset =
      events.filter((e) => e.type === EventType.FullSnapshot)[0].timestamp -
      baseline;

    await page.evaluate(`window.events = ${JSON.stringify(events)}`);
    await page.evaluate(`
      const { Replayer } = window.rrweb;
      window.replayer = new Replayer(window.events, { skipInactive: false });
    `);

    const stateAt = async (offset: number) => {
      await page.evaluate((o: number) => {
        (window as unknown as IWindow).replayer.pause(o);
      }, offset);
      await waitForRAF(page);
      return page.evaluate(() => {
        const replayer = (window as unknown as IWindow).replayer;
        const doc = replayer.iframe.contentDocument as Document;
        const el = doc.getElementById('target') as HTMLElement;
        const win = replayer.iframe.contentWindow as Window;
        return {
          hasMarker: el.hasAttribute('rr_fullscreen'),
          // The injected `[rr_fullscreen]` rule pins the element when marked.
          isPinned: win.getComputedStyle(el).position === 'fixed',
        };
      });
    };

    const activeOffset = Math.floor((enterOffset + exitOffset) / 2);
    // strictly after the snapshot: seeking to exactly the snapshot's
    // timestamp classifies it as "future" and skips the rebuild entirely
    // (known boundary bug — see 'pausing exactly at its timestamp' in
    // replayer.test.ts), which would leak the marker across this scrub
    const beforeOffset = Math.max(enterOffset - 1, snapshotOffset + 1);
    const off = { hasMarker: false, isPinned: false };
    const on = { hasMarker: true, isPinned: true };

    // Seeked in order — the replayer is stateful, so the "re-enter" checkpoint
    // both asserts and sets up the subsequent backward scrub.
    const checkpoints = [
      { name: 'before enter', offset: beforeOffset, expected: off },
      { name: 'during fullscreen', offset: activeOffset, expected: on },
      { name: 'after exit', offset: exitOffset + 1, expected: off },
      { name: 're-enter (scrub back to fullscreen)', offset: activeOffset, expected: on },
      { name: 'backward scrub to before enter', offset: beforeOffset, expected: off },
    ];
    for (const { name, offset, expected } of checkpoints) {
      expect(await stateAt(offset), name).toEqual(expected);
    }
  });
});
