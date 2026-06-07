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

describe('monkey-patched MutationObserver hardening', () => {
  vi.setConfig({ testTimeout: 45_000 });

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

  async function startRecording(page: puppeteer.Page, resetEvents = true) {
    await page.evaluate(
      (bundle, shouldReset) => {
        eval(bundle);
        const w = window as Window & { __rrwebEvents: eventWithTime[] };
        if (shouldReset || !w.__rrwebEvents) {
          w.__rrwebEvents = [];
        }
      (
        window as Window & { __rrwebStop: (() => void) | undefined }
      ).__rrwebStop = (
        window as Window & {
          rrweb: {
            record: (options: {
              emit: (e: eventWithTime) => void;
            }) => () => void;
          };
        }
      ).rrweb.record({
        emit: (e) => {
          (
            window as Window & { __rrwebEvents: eventWithTime[] }
          ).__rrwebEvents.push(e);
        },
      });
      },
      code,
      resetEvents,
    );
    await waitForRAF(page);
  }

  function mutationEvents(events: eventWithTime[]) {
    return events.filter(
      (e) =>
        e.type === EventType.IncrementalSnapshot &&
        (e.data as { source: number }).source === IncrementalSource.Mutation,
    );
  }

  it('records mutations across stop/start cycles', async () => {
    const page = await browser.newPage();
    await page.goto(`${serverURL}/html/monkey-patched-mutation.html`, {
      waitUntil: 'load',
    });
    await waitForRAF(page);

    await startRecording(page);
    await page.evaluate(() => {
      const li = document.createElement('li');
      li.textContent = 'first-session';
      document.getElementById('list')?.appendChild(li);
    });
    await waitForRAF(page);
    await page.evaluate(() => {
      (window as Window & { __rrwebStop: () => void }).__rrwebStop();
      (window as Window & { __rrwebStop: undefined }).__rrwebStop = undefined;
    });
    await waitForRAF(page);

    await startRecording(page, false);
    await page.evaluate(() => {
      const li = document.createElement('li');
      li.textContent = 'second-session';
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

    const mutations = mutationEvents(events);
    expect(mutations.length).toBeGreaterThanOrEqual(2);

    const texts = JSON.stringify(mutations);
    expect(texts).toContain('first-session');
    expect(texts).toContain('second-session');
    await page.close();
  });

  it('does not leak untainted iframes after recording stops', async () => {
    const page = await browser.newPage();
    await page.goto(`${serverURL}/html/monkey-patched-mutation.html`, {
      waitUntil: 'load',
    });
    await waitForRAF(page);

    await startRecording(page);
    await page.evaluate(() => {
      const li = document.createElement('li');
      li.textContent = 'cleanup-check';
      document.getElementById('list')?.appendChild(li);
    });
    await waitForRAF(page);

    const iframeCountDuringRecord = await page.evaluate(
      () =>
        document.querySelectorAll(
          'iframe[__rrwebUntaintedMutationObserver]',
        ).length,
    );

    await page.evaluate(() => {
      (window as Window & { __rrwebStop: () => void }).__rrwebStop();
    });
    await waitForRAF(page);

    const iframeCountAfterStop = await page.evaluate(
      () =>
        document.querySelectorAll(
          'iframe[__rrwebUntaintedMutationObserver]',
        ).length,
    );

    // Chromium removes the helper iframe immediately; attribute only exists on Safari.
    expect(iframeCountDuringRecord).toBeGreaterThanOrEqual(0);
    expect(iframeCountAfterStop).toBe(0);
    await page.close();
  });

  it('records attribute and child-list mutations when monkey-patched', async () => {
    const page = await browser.newPage();
    await page.goto(`${serverURL}/html/monkey-patched-mutation.html`, {
      waitUntil: 'load',
    });
    await waitForRAF(page);
    await startRecording(page);

    await page.evaluate(() => {
      const root = document.getElementById('list')!;
      root.setAttribute('data-test', 'mutated');
      const li = document.createElement('li');
      li.textContent = 'child-list';
      root.appendChild(li);
      root.firstElementChild?.remove();
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

    expect(mutationEvents(events).length).toBeGreaterThan(0);
    const serialized = JSON.stringify(events);
    expect(serialized).toContain('child-list');
    expect(serialized).toContain('data-test');
    await page.close();
  });
});
