// @vitest-environment jsdom
//
// Guard on the new topological-order drain: when many sibling nodes
// mount under a single parent in one batch, the per-node sibling-lookup
// count must stay flat as the batch grows.
//
// The lookups counted here (`dom.previousSibling` / `dom.nextSibling` /
// `dom.lastChild`) are introduced by the drain itself; the old
// addList-based path did not call them at all, so counting these on the
// old code would be ~0 and the assertion would misfire for the wrong
// reason. This test is not a regression check against the old path, but
// a scaling guard on the new drain: on the new path lookups per node
// stay flat as n grows; a future change that regressed the drain to
// super-linear per-node work would show up here as perNodeBig outpacing
// perNodeSmall.
//
// Scaling intuition for the margin below: pre-fix total was roughly
// n^1.8, i.e. n^0.8 per node, so a 10x batch size gave about a 6x
// per-node growth. The assertion keeps a < 5x bound against batching
// noise.

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
  // count calls between the batch append and the next settle.
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

describe('mutation buffer drain stays linear for long sibling runs', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('anchor siblings: sibling-lookup count per node stays flat as batch grows 10x', async () => {
    const small = await measure(500, 'anchors');
    const big = await measure(5000, 'anchors');

    // Every added node must reach the emit sink.
    expect(small.served).toBeGreaterThanOrEqual(small.n);
    expect(big.served).toBeGreaterThanOrEqual(big.n);

    // Lookups/node must stay flat for the drain to be O(n). A 10x batch
    // on a quadratic-ish path grows per-node work by about 6x; we
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
