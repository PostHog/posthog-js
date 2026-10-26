// @vitest-environment jsdom
//
// Guard on the drain's backward fast path: with slimDOM ignoring
// comments and scripts, a long run of new siblings interleaved with
// IGNORED_NODE neighbours must still drain in O(n). Without a probe-past-
// IGNORED step on the backward walk, each new node would fall back to
// walk-up + descend, pushing the drain back to O(n²).

import { afterEach, describe, expect, it } from 'vitest';
import record from '../../src/record';
import dom from '@posthog/rrweb-utils';

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

type Row = { addedCount: number; lookupCalls: number; served: number };

async function measure(addedCount: number): Promise<Row> {
  // Seed the DOM with a long run of IGNORED_NODE siblings (scripts) so
  // the drain, when processing new siblings inserted between them, has
  // to probe past them on both the backward fast path and the forward
  // walk.
  const seed =
    '<main id="fixture">' +
    Array.from({ length: addedCount }, (_, i) => `<script>/* seed ${i} */</script>`).join('') +
    '<div id="trailing-existing"></div>' +
    '</main>';
  document.body.innerHTML = seed;
  const fixture = document.getElementById('fixture')!;
  const existing = document.getElementById('trailing-existing')!;

  let served = 0;
  const stop = record({
    slimDOMOptions: 'all',
    emit: (event) => {
      const e = event as { type?: number; data?: { adds?: unknown[] } };
      if (e.type === 3 && e.data && Array.isArray(e.data.adds)) {
        served += e.data.adds.length;
      }
    },
  });
  await settle();

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
    // Insert one new <div> immediately after each ignored <script>, so
    // the final shape is: script, div, script, div, ..., script, div,
    // existing-div. Each new <div> has an IGNORED_NODE sibling in both
    // directions.
    const scripts = Array.from(fixture.querySelectorAll('script'));
    for (const script of scripts) {
      const div = document.createElement('div');
      div.className = 'new';
      // Insert before the trailing-existing so the new node is never
      // lastChild and the drain actually runs the sibling walks.
      fixture.insertBefore(div, existing);
    }
    await settle();
    await settle();
  } finally {
    dom.previousSibling = originalPrev;
    dom.nextSibling = originalNext;
    dom.lastChild = originalLast;
    stop();
  }

  return { addedCount, lookupCalls, served };
}

describe('mutation drain stays linear with interleaved IGNORED_NODE siblings', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('sibling-lookup count per node stays flat as batch grows 10x with interleaved <script>s', async () => {
    const small = await measure(100);
    const big = await measure(1000);

    expect(small.served).toBeGreaterThanOrEqual(small.addedCount);
    expect(big.served).toBeGreaterThanOrEqual(big.addedCount);

    const perNodeSmall = small.lookupCalls / small.addedCount;
    const perNodeBig = big.lookupCalls / big.addedCount;
    expect(perNodeBig).toBeLessThan(perNodeSmall * 5);
  }, 60000);
});
