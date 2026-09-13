import * as fs from 'fs';
import * as path from 'path';
import type * as puppeteer from 'puppeteer';
import { launchPuppeteer } from '../utils';
import type { Replayer } from '../../src/replay';

type ReplayWindow = Window & { rrweb: { Replayer: typeof Replayer } };

describe('destroying live playback in a browser', () => {
  let browser: puppeteer.Browser;
  let page: puppeteer.Page;

  beforeAll(async () => {
    browser = await launchPuppeteer();
  });

  beforeEach(async () => {
    page = await browser.newPage();
    await page.goto('about:blank');
    await page.evaluate(
      fs.readFileSync(
        path.resolve(__dirname, '../../dist/rrweb.umd.cjs'),
        'utf8',
      ),
    );
  });

  afterEach(async () => {
    await page?.close();
  });

  afterAll(async () => {
    await browser?.close();
  });

  it.each([true, false])(
    'stops queued custom events with the host intact (liveMode=%s)',
    async (liveMode) => {
      const result = await page.evaluate(async (liveMode) => {
        const root = document.createElement('div');
        document.body.appendChild(root);
        const now = Date.now();
        const queued = {
          type: 5 as const,
          timestamp: now + 100,
          data: { tag: 'queued-before-destroy', payload: null },
        };
        const player = new (window as unknown as ReplayWindow).rrweb.Replayer(
          liveMode ? [] : [{ ...queued, timestamp: now }, queued],
          {
            root,
            liveMode,
            mouseTail: false,
          },
        );
        if (liveMode) {
          player.startLive(now);
          player.addEvent(queued);
          await Promise.resolve();
        } else {
          player.play(1);
        }
        let callbacksAfterDestroy = 0;
        player.on('custom-event', () => callbacksAfterDestroy++);
        const before = {
          active: player.timer.isActive(),
          actions: player.timer['actions'].length,
          hostIntact: root.isConnected && root.contains(player.wrapper),
        };
        player.destroy();
        player.destroy();
        const after = {
          active: player.timer.isActive(),
          actions: player.timer['actions'].length,
          wrapperRemoved: root.childElementCount === 0,
        };
        await new Promise((resolve) => setTimeout(resolve, 250));
        return {
          before,
          after,
          callbacksAfterDestroy,
          activeAfterWait: player.timer.isActive(),
        };
      }, liveMode);

      expect(result).toEqual({
        before: { active: true, actions: 1, hostIntact: true },
        after: { active: false, actions: 0, wrapperRemoved: true },
        callbacksAfterDestroy: 0,
        activeAfterWait: false,
      });
    },
  );
});
