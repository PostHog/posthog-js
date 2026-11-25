import * as fs from 'fs';
import * as path from 'path';
import type * as puppeteer from 'puppeteer';
import type { recordOptions } from '../../src/types';
import type { eventWithTime, listenerHandler } from '@posthog/rrweb-types';
import { EventType, IncrementalSource } from '@posthog/rrweb-types';
import { launchPuppeteer, waitForRAF } from '../utils';

interface IWindow extends Window {
  rrweb: {
    record: (
      options: recordOptions<eventWithTime>,
    ) => listenerHandler | undefined;
  };
  emit: (e: eventWithTime) => undefined;
}

const PAGE_CONTENT = '<video></video><audio></audio><div></div>';

describe('record media interactions', () => {
  let browser: puppeteer.Browser;
  let code: string;

  beforeAll(async () => {
    browser = await launchPuppeteer();
    code = fs.readFileSync(
      path.resolve(__dirname, '../../dist/rrweb.umd.cjs'),
      'utf8',
    );
  });

  afterAll(async () => {
    await browser?.close();
  });

  const countMediaInteractionsAfterPlayEvent = async (
    frameName: 'top' | 'iframe',
    targetSelector: string,
  ): Promise<number> => {
    const page = await browser.newPage();
    try {
      await page.goto('about:blank');
      await page.setContent(
        `<!DOCTYPE html><html><body>${PAGE_CONTENT}<iframe></iframe></body></html>`,
        { waitUntil: 'load' },
      );
      const [topFrame, iframeFrame] = page.frames();
      await iframeFrame.evaluate((content) => {
        document.body.innerHTML = content;
      }, PAGE_CONTENT);

      const events: eventWithTime[] = [];
      await page.exposeFunction('emit', (e: eventWithTime) => {
        events.push(e);
      });
      await page.evaluate(code);
      await page.evaluate(() => {
        const { rrweb, emit } = window as unknown as IWindow;
        rrweb.record({ emit });
      });
      await waitForRAF(page);

      const targetFrame = frameName === 'top' ? topFrame : iframeFrame;
      await targetFrame.evaluate((selector) => {
        document
          .querySelector(selector)!
          .dispatchEvent(new Event('play', { bubbles: true }));
      }, targetSelector);
      await waitForRAF(page);

      return events.filter(
        (e) =>
          e.type === EventType.IncrementalSnapshot &&
          e.data.source === IncrementalSource.MediaInteraction,
      ).length;
    } finally {
      await page.close();
    }
  };

  it.each(
    (['top', 'iframe'] as const).flatMap((frameName) => [
      { frameName, targetSelector: 'video', expectedInteractions: 1 },
      { frameName, targetSelector: 'audio', expectedInteractions: 1 },
      { frameName, targetSelector: 'div', expectedInteractions: 0 },
    ]),
  )(
    'a play event on a $targetSelector in the $frameName document records $expectedInteractions media interactions',
    async ({ frameName, targetSelector, expectedInteractions }) => {
      expect(
        await countMediaInteractionsAfterPlayEvent(frameName, targetSelector),
      ).toBe(expectedInteractions);
    },
  );
});
