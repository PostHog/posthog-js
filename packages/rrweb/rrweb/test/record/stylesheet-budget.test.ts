import * as fs from 'fs';
import * as path from 'path';
import type * as puppeteer from 'puppeteer';
import { vi } from 'vitest';
import type { recordOptions } from '../../src/types';
import {
  listenerHandler,
  eventWithTime,
  EventType,
} from '@posthog/rrweb-types';
import type { SnapshotCost } from '@posthog/rrweb-snapshot';
import { launchPuppeteer, waitForCondition } from '../utils';

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
    getLastSnapshotCost: () => SnapshotCost | null;
  };
  emit: (e: eventWithTime) => undefined;
}

// larger than any budget a caller would plausibly configure, so a default
// budget accidentally reintroduced in record() would trip the unbounded test
const RULE_COUNT = 12_000;

describe('record: stylesheet budget', function (this: ISuite) {
  vi.setConfig({ testTimeout: 100_000 });

  const ctx = {} as ISuite;

  beforeAll(async () => {
    ctx.browser = await launchPuppeteer();

    const bundlePath = path.resolve(__dirname, '../../dist/rrweb.umd.cjs');
    ctx.code = fs.readFileSync(bundlePath, 'utf8');
  });

  afterAll(async () => {
    await ctx.browser?.close();
  });

  beforeEach(async () => {
    ctx.page = await ctx.browser.newPage();
    await ctx.page.goto('about:blank');
    await ctx.page.setContent('<!DOCTYPE html><html><body></body></html>');
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

  const recordWithGiantStylesheet = (budget?: number) =>
    ctx.page.evaluate(
      (ruleCount, budgetRules) => {
        const rules: string[] = [];
        for (let i = 0; i < ruleCount; i++) {
          rules.push(`.rule-${i} { color: red; }`);
        }
        const style = document.createElement('style');
        style.textContent = rules.join('\n');
        document.head.appendChild(style);

        const win = window as unknown as IWindow;
        win.rrweb.record({
          emit: win.emit,
          inlineStylesheetBudgetRules: budgetRules,
        });
        return win.rrweb.getLastSnapshotCost();
      },
      RULE_COUNT,
      budget,
    );

  const findFullSnapshot = async () => {
    await waitForCondition(
      () => ctx.events.some((e) => e.type === EventType.FullSnapshot),
      { timeout: 10_000 },
    );
    return ctx.events.find((e) => e.type === EventType.FullSnapshot);
  };

  it('applies no budget when inlineStylesheetBudgetRules is not set', async () => {
    const cost = await recordWithGiantStylesheet(undefined);

    // every rule was stringified synchronously, i.e. no budget ever engaged
    expect(cost?.deferredStylesheetCount).toBe(0);
    expect(cost?.cssRuleCount).toBeGreaterThanOrEqual(RULE_COUNT);

    const snapshot = await findFullSnapshot();
    expect(JSON.stringify(snapshot)).toContain(`.rule-${RULE_COUNT - 1}`);
  });

  it('enforces the budget when the caller sets one', async () => {
    const cost = await recordWithGiantStylesheet(1000);

    // the sheet was over budget, so it was never stringified
    expect(cost?.cssRuleCount).toBeLessThan(RULE_COUNT);

    // fidelity is kept: the style element falls back to its raw textContent
    const snapshot = await findFullSnapshot();
    expect(JSON.stringify(snapshot)).toContain(`.rule-${RULE_COUNT - 1}`);
  });
});
