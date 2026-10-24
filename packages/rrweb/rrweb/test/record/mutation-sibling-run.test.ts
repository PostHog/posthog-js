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
// The fail mode we are testing is the old `addList` tail-rescan walking
// the sibling chain O(n) times per emission as it tries to resolve
// parentId/nextId for queued nodes. We assert this by counting
// `dom.previousSibling` / `dom.nextSibling` / `dom.lastChild` lookups
// per node across two batch sizes:
//   - On the fix: total lookups scale as O(n), so lookups/node stays
//     flat as n grows.
//   - Pre-fix: total scaled as ~n^1.8, so lookups/node grew ~63× for a
//     10× batch — well above any CI noise.
//
// Earlier versions of this test asserted on `buffer.addedSet.size` at
// the end, but `emit()` swaps in a fresh empty addedSet before the
// drain, so that residue check can never fire. @TueHaulund flagged this
// on review of 5f35b1da4.

import { afterEach, describe, expect, it } from 'vitest';
import record from '../../src/record';
import dom from '@posthog/rrweb-utils';

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

type Row = { n: number; lookupCalls: number; served: number };

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

  // Patch the three sibling-walk helpers the drain depends on and
  // count calls between the batch append and the next settle. These
  // are the hot-path lookups that scaled as ~n^1.8 on the pre-fix
  // `addList` tail-rescan.
  const originalPrev = dom.previousSibling;
  const originalNext = dom.nextSibling;
  const originalLast = dom.lastChild;
  let lookupCalls = 0;
  dom.previousSibling = function (node: Node) {
    lookupCalls += 1;
    return originalPrev.call(dom, node);
  };
  dom.nextSibling = function (node: Node) {
    lookupCalls += 1;
    return originalNext.call(dom, node);
  };
  dom.lastChild = function (node: Node) {
    lookupCalls += 1;
    return originalLast.call(dom, node);
  };

  try {
    const batch = document.createDocumentFragment();
    for (let i = 0; i < n; i++) {
      if (shape === 'anchors') {
        batch.appendChild(
          i % 2 === 0 ? document.createComment('') : document.createTextNode(''),
        );
      } else {
        if (i % 3 === 0) batch.appendChild(document.createComment(''));
        else if (i % 3 === 1) batch.appendChild(document.createTextNode(''));
        else {
          const el = document.createElement('span');
          el.setAttribute('data-i', String(i));
          batch.appendChild(el);
        }
      }
    }
    fixture.appendChild(batch);
    await settle();
    await settle();
  } finally {
    dom.previousSibling = originalPrev;
    dom.nextSibling = originalNext;
    dom.lastChild = originalLast;
    stop();
  }

  return { n, lookupCalls, served };
}

describe('mutation buffer drain stays linear for long sibling runs (#5227)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('anchor siblings: sibling-lookup count per node stays flat as batch grows 10x', async () => {
    const small = await measure(500, 'anchors');
    const big = await measure(5000, 'anchors');

    // Every added node must reach the emit sink. The old addList-based
    // path dropped nodes whose parentId couldn't be resolved in-batch;
    // the topological drain either resolves them or logs explicitly.
    expect(small.served).toBeGreaterThanOrEqual(small.n);
    expect(big.served).toBeGreaterThanOrEqual(big.n);

    // Lookups/node must stay flat for the fix to be O(n). The pre-fix
    // path was ~n^1.8, so 10x batch size => ~63x per-node lookups. We
    // assert < 5x to keep margin against batching noise.
    const perNodeSmall = small.lookupCalls / small.n;
    const perNodeBig = big.lookupCalls / big.n;
    expect(perNodeBig).toBeLessThan(perNodeSmall * 5);
  }, 60000);

  it('mixed comment+text+element siblings: no silent drops at 5k batch', async () => {
    const row = await measure(5000, 'mixed');
    expect(row.served).toBeGreaterThanOrEqual(row.n);
  }, 60000);
});
