import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Browser } from 'puppeteer';
import { EventType, ReplayerEvents } from '@posthog/rrweb-types';
import type { Replayer } from '../../src/replay';
import { launchPuppeteer } from '../utils';
import * as path from 'path';

let browser: Browser;
beforeAll(async () => {
  browser = await launchPuppeteer();
});
afterAll(async () => {
  await browser?.close();
});

it('destroys a playing replayer after its host children are cleared in a browser', async () => {
  const page = await browser.newPage();
  try {
    await page.addScriptTag({
      path: path.resolve(__dirname, '../../dist/rrweb.umd.cjs'),
    });
    const result = await page.evaluate(
      async ({ EventType, ReplayerEvents }) => {
        const { rrweb } = window as unknown as {
          rrweb: { Replayer: typeof Replayer };
        };
        const root = document.createElement('div');
        document.body.appendChild(root);
        const replayer = new rrweb.Replayer(
          [
            { type: EventType.DomContentLoaded, data: {}, timestamp: 1000 },
            {
              type: EventType.Custom,
              data: { tag: 'queued-before-destroy', payload: null },
              timestamp: 1100,
            },
          ],
          { root, mouseTail: false },
        );
        let customEvents = 0;
        let destroyEvents = 0;
        replayer.on(ReplayerEvents.CustomEvent, () => customEvents++);
        replayer.on(ReplayerEvents.Destroy, () => destroyEvents++);
        replayer.play(1);
        const started = replayer.timer.isActive();
        const queuedBefore = replayer.timer['actions'].length;
        root.replaceChildren();
        replayer.destroy();
        replayer.destroy();
        const cleanup = {
          activeTimer: replayer.timer.isActive(),
          queuedActions: replayer.timer['actions'].length,
          handlers: replayer['emitterHandlers'].length,
          subscribed: !!replayer['serviceSubscription'],
          speedSubscribed: !!replayer['speedServiceSubscription'],
        };
        // Observe past the queued event, without making a performance assertion.
        await new Promise((resolve) => setTimeout(resolve, 200));
        return {
          started,
          queuedBefore,
          ...cleanup,
          customEvents,
          destroyEvents,
        };
      },
      { EventType, ReplayerEvents },
    );
    expect(result).toEqual({
      started: true,
      queuedBefore: 1,
      activeTimer: false,
      queuedActions: 0,
      handlers: 0,
      subscribed: false,
      speedSubscribed: false,
      customEvents: 0,
      destroyEvents: 1,
    });
  } finally {
    await page.close();
  }
});
