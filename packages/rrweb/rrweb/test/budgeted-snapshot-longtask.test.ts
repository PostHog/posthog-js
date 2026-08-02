/**
 * The committed, runnable evidence for `fullSnapshotYieldBudgetMs` — the
 * property the option sells is "no long main-thread stalls while the full
 * snapshot is built", so that is what CI asserts, via the Long Tasks API
 * rather than wall-clock totals (total time is background cost; the stall is
 * what a user feels).
 *
 * Both arms run on the same ~35k-node fixture with the production
 * MessageChannel yielder:
 *   - budget off: the serialize is expected to be one long task (that's the
 *     problem being solved — asserted so the fixture stays big enough to
 *     keep the comparison meaningful),
 *   - budget 10ms: NO task during the walk may reach the 50ms long-task
 *     threshold (5x the budget — loose enough for CI noise, tight enough
 *     that a broken yielder or an unbudgeted per-node cost regression fails).
 *
 * The per-run numbers are printed so a human can eyeball the distribution.
 */
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import type * as puppeteer from 'puppeteer';
import { vi, beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  launchPuppeteer,
  startServer,
  getServerURL,
  fakeGoto,
} from './utils';

const ROWS = 3200; // ~35k nodes
const BUDGET_MS = 10;
const LONG_TASK_MS = 50;

let server: http.Server;
let serverURL: string;
let browser: puppeteer.Browser;
let rrwebCode: string;
let snapshotCode: string;

function buildPage(budget: number): string {
  const rows: string[] = [];
  for (let i = 0; i < ROWS; i++) {
    rows.push(
      `<tr><td>cell ${i}-a</td><td>cell ${i}-b</td>` +
        `<td><span>cell ${i}-c</span></td><td><b>${i}</b></td></tr>`,
    );
  }
  return `<!DOCTYPE html>
<html><head><title>bench</title></head><body>
  <table><tbody>${rows.join('')}</tbody></table>
  <script>${snapshotCode}</script>
  <script>${rrwebCode}</script>
  <script>
    window.longTasks = [];
    window.__observer = new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (entry) {
        window.longTasks.push({
          start: entry.startTime,
          duration: entry.duration,
        });
      });
    });
    window.__observer.observe({ entryTypes: ['longtask'] });
    window.snapshots = [];
    window.__walkStarted = 0;
    window.__walkFinished = 0;
    // recording starts in a fresh task: the Long Tasks API cannot observe
    // the task its own observer was registered in, and the serialize would
    // otherwise hide inside the parse/script task
    setTimeout(function () {
      window.__walkStarted = performance.now();
      window.__stop = rrweb.record({
        emit: function (event) {
          window.snapshots.push(event);
          if (event.type === 2 && !window.__walkFinished) {
            window.__walkFinished = performance.now();
          }
        },
        fullSnapshotYieldBudgetMs: ${budget},
      });
    }, 0);
  </script>
</body></html>`;
}

type BenchResult = {
  walkMs: number;
  longTasksDuringWalk: Array<{ start: number; duration: number }>;
  nodeCount: number;
};

async function runArm(budget: number): Promise<BenchResult> {
  const page = await browser.newPage();
  try {
    await fakeGoto(page, `${serverURL}/html/bench.html`);
    await page.setContent(buildPage(budget));
    await page.waitForFunction('window.__walkFinished > 0', {
      timeout: 120_000,
    });
    // let trailing longtask entries deliver
    await new Promise((r) => setTimeout(r, 300));
    return (await page.evaluate(`
      (function () {
        function countNodes(node) {
          var count = 1;
          (node.childNodes || []).forEach(function (child) {
            count += countNodes(child);
          });
          return count;
        }
        var full = window.snapshots.filter(function (e) {
          return e.type === 2;
        })[0];
        return {
          walkMs: window.__walkFinished - window.__walkStarted,
          longTasksDuringWalk: window.longTasks.filter(function (t) {
            return t.start >= window.__walkStarted - 5 &&
              t.start <= window.__walkFinished + 5;
          }),
          nodeCount: full ? countNodes(full.data.node) : 0,
        };
      })()
    `)) as BenchResult;
  } finally {
    await page.close();
  }
}

describe('budgeted snapshot long-task bound', () => {
  vi.setConfig({ testTimeout: 240_000, hookTimeout: 120_000 });

  beforeAll(async () => {
    server = await startServer();
    serverURL = getServerURL(server);
    browser = await launchPuppeteer();
    rrwebCode = fs.readFileSync(
      path.resolve(__dirname, '../dist/rrweb.umd.cjs'),
      'utf8',
    );
    snapshotCode = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../rrweb-snapshot/dist/rrweb-snapshot.umd.cjs',
      ),
      'utf8',
    );
  });

  afterAll(async () => {
    await browser.close();
    server.close();
  });

  it('the synchronous arm stalls and the budgeted arm does not', async () => {
    const syncArm = await runArm(0);
    const budgetedArm = await runArm(BUDGET_MS);

    const syncMax = Math.max(
      0,
      ...syncArm.longTasksDuringWalk.map((t) => t.duration),
    );
    const budgetedMax = Math.max(
      0,
      ...budgetedArm.longTasksDuringWalk.map((t) => t.duration),
    );
    // eslint-disable-next-line no-console
    console.log(
      `[bench] nodes=${syncArm.nodeCount} | sync: serialize=${Math.round(
        syncArm.walkMs,
      )}ms, worst task=${Math.round(syncMax)}ms | budgeted(${BUDGET_MS}ms): ` +
        `walk=${Math.round(budgetedArm.walkMs)}ms, tasks>=50ms=${
          budgetedArm.longTasksDuringWalk.length
        }, worst=${Math.round(budgetedMax)}ms`,
    );

    // both arms serialized the same tree
    expect(budgetedArm.nodeCount).toBe(syncArm.nodeCount);
    expect(syncArm.nodeCount).toBeGreaterThan(30_000);
    // the fixture is big enough that the problem exists on the sync arm
    expect(syncMax).toBeGreaterThanOrEqual(LONG_TASK_MS);
    // the property being sold: nothing the walk does reaches the long-task
    // threshold (= 5x the configured budget)
    expect(budgetedArm.longTasksDuringWalk).toEqual([]);
  });
});
