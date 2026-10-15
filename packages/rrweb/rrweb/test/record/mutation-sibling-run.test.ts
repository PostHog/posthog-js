// @vitest-environment jsdom
//
// Regression test for #5227: MutationBuffer must stay linear when many
// sibling nodes mount under a single parent in one batch.
//
// Original repro: 50x35 PrimeVue DataTable (~13k nodes).
// Second repro (2026-10-15): Svelte 5 + bits-ui Portal — ~50k empty
// comment/text anchors as direct children of <body>, scaling at ~n^1.8
// on posthog-js 1.438.7 (pre-fix).
//
// After the port of upstream rrweb-io/rrweb#1652, the drain walks the
// addedSet in topological order and never re-queues a node, so per-node
// cost should stay flat as batch size grows. This test fails if the per-
// node drain cost at 5k nodes grows more than 5x the 500-node baseline —
// which is well above measured jsdom noise (~0.02 ms/node) but far below
// the ~n^1.8 regression the port fixes.

import { afterEach, describe, expect, it } from 'vitest';
import record from '../../src/record';
import { mutationBuffers } from '../../src/record/observer';

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

type Row = { n: number; drainMs: number; served: number };

async function measure(n: number, shape: 'anchors' | 'mixed'): Promise<Row> {
  document.body.innerHTML = '<main id="fixture"></main>';
  const fixture = document.getElementById('fixture')!;

  let served = 0;
  const stop = record({
    emit: (event) => {
      const e = event as { type?: number; data?: { adds?: unknown[] } };
      if (e.type === 3 && e.data && Array.isArray(e.data.adds)) {
        served += e.data.adds.length;
      }
    },
  });
  await settle();

  const buffer = mutationBuffers.find((b) => b.bufferDoc() === document)!;
  const original = (buffer as unknown as { processBufferedMutations: () => void })
    .processBufferedMutations;
  let drainMs = 0;
  (buffer as unknown as { processBufferedMutations: () => void }).processBufferedMutations =
    function () {
      const t0 = performance.now();
      original.call(buffer);
      drainMs += performance.now() - t0;
    };

  for (let i = 0; i < n; i++) {
    if (shape === 'anchors') {
      fixture.appendChild(
        i % 2 === 0 ? document.createComment('') : document.createTextNode(''),
      );
    } else {
      if (i % 3 === 0) fixture.appendChild(document.createComment(''));
      else if (i % 3 === 1) fixture.appendChild(document.createTextNode(''));
      else {
        const el = document.createElement('span');
        el.setAttribute('data-i', String(i));
        fixture.appendChild(el);
      }
    }
  }
  await settle();
  await settle();

  stop();
  return { n, drainMs, served };
}

describe('mutation buffer drain stays linear for long sibling runs (#5227)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('anchor siblings: per-node drain cost does not grow when batch grows 10x', async () => {
    const small = await measure(500, 'anchors');
    const big = await measure(5000, 'anchors');

    // Every added node must reach the emit sink. The old addList-based
    // path dropped nodes whose parentId couldn't be resolved in-batch;
    // the topological drain either resolves them or logs explicitly.
    expect(small.served).toBeGreaterThanOrEqual(small.n);
    expect(big.served).toBeGreaterThanOrEqual(big.n);

    // ms/node must stay flat for the fix to be O(n). The pre-fix path
    // was ~n^1.8, so 10x batch size => ~63x per-node cost. We assert
    // < 5x to keep margin for jsdom noise + GC jitter in CI.
    const perNodeSmall = small.drainMs / small.n;
    const perNodeBig = big.drainMs / big.n;
    expect(perNodeBig).toBeLessThan(perNodeSmall * 5);
  }, 60000);

  it('mixed comment+text+element siblings: no silent drops at 5k batch', async () => {
    const row = await measure(5000, 'mixed');
    expect(row.served).toBeGreaterThanOrEqual(row.n);
  }, 60000);
});
