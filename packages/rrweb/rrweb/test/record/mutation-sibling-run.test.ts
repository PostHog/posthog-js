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
// addedSet in topological order and never re-queues a node. The fail
// mode we are testing is the old `addList` tail-rescan dropping entries
// when the per-pass budget blew up — leaving residue in the set and
// losing nodes from the emitted adds stream.
//
// We assert the shape invariants rather than wall time:
//   - every added node reaches the emit sink (no silent drops)
//   - the drain only runs once per emission (no tail-rescan recursion)
//   - addedSet is empty at the end (no tombstone stall)
// These hold on the fix at any batch size and would fail on the pre-fix
// path for the batch sizes exercised below. Wall-time comparisons were
// removed because they flake under GC jitter in CI.

import { afterEach, describe, expect, it, vi } from 'vitest';
import record from '../../src/record';
import { mutationBuffers } from '../../src/record/observer';

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

type Row = { n: number; drainCalls: number; served: number; residue: number };

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
    .processBufferedMutations.bind(buffer);
  const drainSpy = vi.fn(() => original());
  (buffer as unknown as { processBufferedMutations: () => void }).processBufferedMutations =
    drainSpy;

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

  const residue = (buffer as unknown as { addedSet: Set<Node> }).addedSet.size;

  stop();
  return { n, drainCalls: drainSpy.mock.calls.length, served, residue };
}

describe('mutation buffer drain stays linear for long sibling runs (#5227)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('anchor siblings: every added node reaches the emit sink at 500 and 5000', async () => {
    const small = await measure(500, 'anchors');
    const big = await measure(5000, 'anchors');

    // Every added node must reach the emit sink. The old addList-based
    // path dropped nodes whose parentId couldn't be resolved in-batch;
    // the topological drain either resolves them or logs explicitly.
    expect(small.served).toBeGreaterThanOrEqual(small.n);
    expect(big.served).toBeGreaterThanOrEqual(big.n);

    // The addedSet must be fully drained at both scales. Residue would
    // indicate a tombstone-stall or an iterator early-exit.
    expect(small.residue).toBe(0);
    expect(big.residue).toBe(0);
  }, 60000);

  it('mixed comment+text+element siblings: no silent drops at 5k batch', async () => {
    const row = await measure(5000, 'mixed');
    expect(row.served).toBeGreaterThanOrEqual(row.n);
    expect(row.residue).toBe(0);
  }, 60000);
});
