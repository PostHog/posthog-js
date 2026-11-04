import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { vi } from 'vitest';
import type { Page } from 'puppeteer';
import type { eventWithTime } from '@posthog/rrweb-types';
import { startServer, launchPuppeteer, getServerURL } from '../utils';

// Build each checkout's recorder and its runtime prerequisites from the root:
// pnpm turbo run build --filter=@posthog/core
// pnpm --filter @posthog/rrweb-types exec vite build
// pnpm --filter @posthog/rrweb-utils exec vite build
// pnpm --filter @posthog/rrweb-record exec vite build
// Then, from packages/rrweb/rrweb:
// RRWEB_BENCH_BEFORE=/before/packages/rrweb/record/dist/rrweb-record.umd.cjs
// RRWEB_BENCH_AFTER=/after/packages/rrweb/record/dist/rrweb-record.umd.cjs
// pnpm exec vitest run test/benchmark/buffered-text-mutations.test.ts
// PUPPETEER_EXECUTABLE_PATH selects a locally installed Chrome.
// RRWEB_BENCH_OUTPUT optionally saves metadata, summaries and every sample as JSON.
const suites = [
  { title: '1 node x 1 change', nodes: 1, changes: 1, attributes: false },
  { title: '1 node x 10 changes', nodes: 1, changes: 10, attributes: false },
  { title: '1 node x 100 changes', nodes: 1, changes: 100, attributes: false },
  {
    title: '1 node x 1000 changes',
    nodes: 1,
    changes: 1000,
    attributes: false,
  },
  {
    title: '200 nodes x 20 changes',
    nodes: 200,
    changes: 20,
    attributes: false,
  },
  {
    title: '200 nodes x 20 text + attribute changes',
    nodes: 200,
    changes: 20,
    attributes: true,
  },
  {
    title: '200 nodes x 1 change (control)',
    nodes: 200,
    changes: 1,
    attributes: false,
  },
];
type Suite = (typeof suites)[number];
type Sample = {
  ms: number;
  textEntries: number;
  attributeEntries: number;
  events: number;
  bytes: number;
  callbacks: number;
  records: number;
};
type BenchWindow = Window & {
  rrweb: {
    record: (options: {
      emit: (event: eventWithTime) => void;
    }) => (() => void) | undefined;
  };
  bench: {
    durations: number[];
    records: number[];
    run: (batch: number) => Promise<Sample>;
    stop: () => void;
  };
};
const warmup = 50;
const runs = 200;
const seed = 5546;

function summarize(samples: Sample[]) {
  const sorted = samples.map((sample) => sample.ms).sort((a, b) => a - b);
  // Median of the middle pair, nearest-rank p95.
  const medianMs = (sorted[runs / 2 - 1] + sorted[runs / 2]) / 2;
  const p95Ms = sorted[Math.ceil(runs * 0.95) - 1];
  for (const key of [
    'textEntries',
    'attributeEntries',
    'events',
    'bytes',
    'callbacks',
    'records',
  ] as const) {
    expect(new Set(samples.map((sample) => sample[key])).size).toBe(1);
  }
  return { ...samples[0], ms: undefined, medianMs, p95Ms };
}

describe('benchmark: buffered text mutations', () => {
  vi.setConfig({ testTimeout: 240000 });

  it('compares recorder callbacks and mutation payloads in alternating order', async () => {
    const server = await startServer(0);
    // Cross-origin isolation gives performance.now() 5 us resolution in Chrome.
    server.prependListener('request', (_req, res) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    });
    const browser = await launchPuppeteer({ headless: true });
    const fallback = path.resolve(
      __dirname,
      '../../../record/dist/rrweb-record.umd.cjs',
    );
    const bundles = {
      before: path.resolve(process.env.RRWEB_BENCH_BEFORE || fallback),
      after: path.resolve(process.env.RRWEB_BENCH_AFTER || fallback),
    };
    const results: unknown[] = [];
    const metadata = {
      browser: await browser.version(),
      platform: os.platform(),
      cpu: os.cpus()[0].model,
      node: process.version,
      warmup,
      runs,
      seed,
      bundles,
      cpuThrottling: 1,
      timing:
        'performance.now around native MutationObserver callback, including processing and emit, excluding DOM writes, scheduling and JSON serialization',
      bytes:
        'sum of UTF-8 JSON.stringify lengths of mutation events, including timestamps, no compression',
      order: 'before/after on even trials, after/before on odd trials',
    };

    const setup = async (page: Page, bundle: string, suite: Suite) => {
      await page.goto(`${getServerURL(server)}/html/blank.html`);
      await page.evaluate(() => {
        const w = window as unknown as BenchWindow;
        w.bench = {
          durations: [],
          records: [],
        } as unknown as BenchWindow['bench'];
        const NativeMutationObserver = window.MutationObserver;
        window.MutationObserver = class extends NativeMutationObserver {
          constructor(callback: MutationCallback) {
            super((records, observer) => {
              const start = performance.now();
              try {
                callback(records, observer);
              } finally {
                w.bench.durations.push(performance.now() - start);
                w.bench.records.push(records.length);
              }
            });
          }
        };
        // rrweb checks constructor.toString() before choosing this realm's
        // observer. Keep that check from bypassing our timing wrapper.
        Object.defineProperty(window.MutationObserver, 'toString', {
          value: () => NativeMutationObserver.toString(),
        });
      });
      await page.addScriptTag({ content: fs.readFileSync(bundle, 'utf8') });
      await page.evaluate(
        ({ nodes, changes, attributes, seed }) => {
          if (!crossOriginIsolated)
            throw new Error('High resolution timer requires isolation');
          const w = window as unknown as BenchWindow;
          const spans = Array.from({ length: nodes }, () => {
            const span = document.createElement('span');
            span.appendChild(document.createTextNode('initial'));
            document.body.appendChild(span);
            return span;
          });
          let events: eventWithTime[] = [];
          w.bench.stop = w.rrweb.record({
            emit: (event) => {
              // Only collect mutation events. Serialization happens after timing.
              if (event.type === 3 && event.data.source === 0)
                events.push(event);
            },
          })!;
          if (!w.bench.stop) throw new Error('Recorder did not start');
          w.bench.run = async (batch) => {
            events = [];
            w.bench.durations = [];
            w.bench.records = [];
            let state = (seed + batch) >>> 0;
            const values = Array.from({ length: changes * nodes }, () => {
              state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
              // Fixed-width values keep bytes comparable across all trials.
              return (
                batch.toString(16).padStart(8, '0') +
                state.toString(16).padStart(8, '0')
              );
            });
            for (let change = 0; change < changes; change++) {
              for (let node = 0; node < nodes; node++) {
                const value = values[change * nodes + node];
                spans[node].firstChild!.textContent = value;
                if (attributes) spans[node].setAttribute('data-value', value);
              }
            }
            // Yield after the writes so Chrome delivers one native mutation batch.
            await new Promise((resolve) => setTimeout(resolve, 0));
            const mutations = events.flatMap((event) =>
              event.type === 3 && event.data.source === 0 ? [event.data] : [],
            );
            const texts = mutations.flatMap((mutation) => mutation.texts);
            const attrs = mutations.flatMap((mutation) => mutation.attributes);
            // Check the final value for every distinct node, without requiring
            // deduplication so the same benchmark runs against either revision.
            const finalTexts = new Map(
              texts.map((text) => [text.id, text.value]),
            );
            if (finalTexts.size !== nodes)
              throw new Error('Missing text nodes');
            const actual = [...finalTexts.values()].sort();
            const expected = values.slice(-nodes).sort();
            if (JSON.stringify(actual) !== JSON.stringify(expected))
              throw new Error('Incorrect final text');
            if (attrs.length !== (attributes ? nodes : 0))
              throw new Error('Incorrect attribute count');
            if (
              attributes &&
              JSON.stringify(
                attrs.map((attr) => attr.attributes['data-value']).sort(),
              ) !== JSON.stringify(expected)
            ) {
              throw new Error('Incorrect final attributes');
            }
            return {
              ms: w.bench.durations.reduce((sum, ms) => sum + ms, 0),
              callbacks: w.bench.durations.length,
              records: w.bench.records.reduce((sum, count) => sum + count, 0),
              events: events.length,
              textEntries: texts.length,
              attributeEntries: attrs.length,
              bytes: events.reduce(
                (sum, event) =>
                  sum +
                  new TextEncoder().encode(JSON.stringify(event)).byteLength,
                0,
              ),
            };
          };
        },
        { ...suite, seed },
      );
    };

    try {
      for (const suite of suites) {
        const pages = {
          before: await browser.newPage(),
          after: await browser.newPage(),
        };
        const samples: Record<keyof typeof pages, Sample[]> = {
          before: [],
          after: [],
        };
        try {
          await setup(pages.before, bundles.before, suite);
          await setup(pages.after, bundles.after, suite);
          for (let batch = 0; batch < warmup + runs; batch++) {
            const order: (keyof typeof pages)[] =
              batch % 2 === 0 ? ['before', 'after'] : ['after', 'before'];
            for (const version of order) {
              const sample = await pages[version].evaluate(
                (batch) => (window as unknown as BenchWindow).bench.run(batch),
                batch,
              );
              expect(sample.callbacks).toBe(1);
              expect(sample.records).toBe(
                suite.nodes * suite.changes * (suite.attributes ? 2 : 1),
              );
              expect(sample.events).toBe(1);
              if (batch >= warmup) samples[version].push(sample);
            }
          }
          const summary = {
            before: summarize(samples.before),
            after: summarize(samples.after),
          };
          console.log(suite.title);
          console.table(summary);
          results.push({ suite, summary, samples });
        } finally {
          for (const page of Object.values(pages)) {
            await page.evaluate(() =>
              (window as unknown as BenchWindow).bench.stop?.(),
            );
            await page.close();
          }
        }
      }
      console.log(JSON.stringify(metadata));
      if (process.env.RRWEB_BENCH_OUTPUT) {
        fs.writeFileSync(
          process.env.RRWEB_BENCH_OUTPUT,
          JSON.stringify({ metadata, results }, null, 2) + '\n',
        );
      }
    } finally {
      await browser.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
