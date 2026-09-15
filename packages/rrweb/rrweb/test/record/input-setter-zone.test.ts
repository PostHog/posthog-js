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
} from '@posthog/rrweb-types';
import { launchPuppeteer, waitForCondition, waitForRAF } from '../utils';

interface ISuite {
  code: string;
  browser: puppeteer.Browser;
  page: puppeteer.Page;
  events: eventWithTime[];
}

interface IWindow extends Window {
  rrweb: {
    record: (
      options: recordOptions<eventWithTime>,
    ) => listenerHandler | undefined;
  };
  emit: (e: eventWithTime) => undefined;
}

const CHECKBOX_COUNT = 50;

const content = `
  <!DOCTYPE html>
  <html>
    <body>
      ${'<input type="checkbox" />'.repeat(CHECKBOX_COUNT)}
    </body>
  </html>
`;

// Stands in for zone.js, which patches the global timers and keeps the originals
// on the window under the names `Zone.__symbol__` returns. Using the real library
// would add a dependency for the two behaviours under test: the patched timer must
// stay untouched, and the unpatched one must still run the deferred hook.
const installZoneLikeTimerPatch = () => {
  const zoneGlobals = window as unknown as Record<string, unknown>;
  const counts = { patched: 0, unpatched: 0 };
  const nativeSetTimeout = window.setTimeout.bind(window);

  zoneGlobals.__zone_timer_counts__ = counts;
  zoneGlobals.__zone_symbol__setTimeout = (
    callback: () => void,
    delay: number,
  ) => {
    counts.unpatched++;
    return nativeSetTimeout(callback, delay);
  };
  zoneGlobals.Zone = { __symbol__: (key: string) => `__zone_symbol__${key}` };
  window.setTimeout = ((callback: () => void, delay: number) => {
    counts.patched++;
    return nativeSetTimeout(callback, delay);
  }) as unknown as typeof setTimeout;
};

describe('input setter hooks under a zone.js-patched setTimeout', () => {
  vi.setConfig({ testTimeout: 20_000 });

  const ctx = {} as ISuite;

  beforeAll(async () => {
    ctx.browser = await launchPuppeteer();
    ctx.code = fs.readFileSync(
      path.resolve(__dirname, '../../dist/rrweb.umd.cjs'),
      'utf8',
    );
  });

  beforeEach(async () => {
    ctx.page = await ctx.browser.newPage();
    await ctx.page.goto('about:blank');
    await ctx.page.setContent(content);
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

  afterAll(async () => {
    await ctx.browser?.close();
  });

  it('schedules no work on the patched timer and still records the writes', async () => {
    await ctx.page.evaluate(installZoneLikeTimerPatch);
    await ctx.page.evaluate(() => {
      const { record } = (window as unknown as IWindow).rrweb;
      record({ emit: (window as unknown as IWindow).emit });
    });
    await waitForRAF(ctx.page);

    const result = await ctx.page.evaluate(() => {
      const counts = (window as unknown as Record<string, unknown>)
        .__zone_timer_counts__ as { patched: number; unpatched: number };
      const checkboxes = Array.from(
        document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
      );

      // Nothing else runs between these two reads, so every patched-timer call
      // counted here comes from the hooked `checked` setter. In an Angular app
      // each of those timers ends a zone task, which triggers another change
      // detection, which writes the property again.
      const patchedBefore = counts.patched;
      const unpatchedBefore = counts.unpatched;
      for (const checkbox of checkboxes) checkbox.checked = true;

      return {
        patchedDuringWrites: counts.patched - patchedBefore,
        unpatchedDuringWrites: counts.unpatched - unpatchedBefore,
        writesApplySynchronously: checkboxes.every(
          (checkbox) => checkbox.checked === true,
        ),
      };
    });

    expect(result).toEqual({
      patchedDuringWrites: 0,
      unpatchedDuringWrites: CHECKBOX_COUNT,
      writesApplySynchronously: true,
    });

    const inputEvents = () =>
      ctx.events.filter(
        (e) =>
          e.type === EventType.IncrementalSnapshot &&
          e.data.source === IncrementalSource.Input,
      );
    await waitForCondition(() => inputEvents().length === CHECKBOX_COUNT);
    expect(
      inputEvents().every((e) => (e.data as { isChecked: boolean }).isChecked),
    ).toBe(true);
  });
});
