import * as fs from 'fs';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  EventType,
  IncrementalSource,
  eventWithTime,
} from '@posthog/rrweb-types';
import {
  getServerURL,
  launchPuppeteer,
  startServer,
  waitForRAF,
} from '../utils';
import type { Server } from 'http';
import type * as puppeteer from 'puppeteer';

describe('monkey-patched MutationObserver', () => {
  vi.setConfig({ testTimeout: 30_000 });

  let server: Server;
  let serverURL: string;
  let browser: puppeteer.Browser;
  let code: string;

  beforeAll(async () => {
    server = await startServer();
    serverURL = getServerURL(server);
    browser = await launchPuppeteer();
    code = fs.readFileSync(
      path.resolve(__dirname, '../../dist/rrweb.umd.cjs'),
      'utf-8',
    );
  });

  afterAll(async () => {
    await browser.close();
    await server.close();
  });

  it('records DOM mutations when MutationObserver is monkey-patched', async () => {
    const page = await browser.newPage();
    await page.goto(`${serverURL}/html/monkey-patched-mutation.html`, {
      waitUntil: 'load',
    });
    await waitForRAF(page);

    const patchActive = await page.evaluate(() => {
      try {
        new MutationObserver(() => {});
        return false;
      } catch (e) {
        return (e as Error).message.includes('hijacked');
      }
    });
    expect(patchActive).toBe(true);

    await page.evaluate((bundle) => {
      eval(bundle);
      (window as Window & { __rrwebEvents: eventWithTime[] }).__rrwebEvents =
        [];
      (
        window as Window & { __rrwebStop: () => void }
      ).__rrwebStop = (
        window as Window & {
          rrweb: { record: (options: { emit: (e: eventWithTime) => void }) => () => void };
        }
      ).rrweb.record({
        emit: (e) => {
          (
            window as Window & { __rrwebEvents: eventWithTime[] }
          ).__rrwebEvents.push(e);
        },
      });
    }, code);
    await waitForRAF(page);

    await page.evaluate(() => {
      const li = document.createElement('li');
      li.textContent = 'b';
      document.getElementById('list')?.appendChild(li);
    });
    await waitForRAF(page);
    await waitForRAF(page);

    const events = (await page.evaluate(() =>
      JSON.parse(
        JSON.stringify(
          (window as Window & { __rrwebEvents: eventWithTime[] })
            .__rrwebEvents,
        ),
      ),
    )) as eventWithTime[];

    const mutationEvents = events.filter(
      (e) =>
        e.type === EventType.IncrementalSnapshot &&
        (e.data as { source: number }).source === IncrementalSource.Mutation,
    );

    expect(mutationEvents.length).toBeGreaterThan(0);
    await page.close();
  });
});
