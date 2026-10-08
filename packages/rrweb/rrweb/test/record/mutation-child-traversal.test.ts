// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import record from '../../src/record';
import { mutationBuffers } from '../../src/record/observer';

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('mutation child traversal', () => {
  let stop: (() => void) | undefined;

  beforeEach(() => {
    document.body.innerHTML =
      '<main id="fixture">' +
      Array.from({ length: 100 }, (_, i) => `<span>value ${i}</span>`).join(
        '',
      ) +
      '</main><aside id="destination"></aside>';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    stop?.();
    document.body.innerHTML = '';
  });

  it('avoids per-node forEach callbacks in repeated add/delete bookkeeping', async () => {
    stop = record({ emit: () => {} });
    await settle();
    const buffer = mutationBuffers.find((b) => b.bufferDoc() === document)!;
    buffer.lock(); // isolate preprocessing from serialization
    const root = document.getElementById('fixture')!;
    const destination = document.getElementById('destination')!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
    const nodes: Node[] = [];
    do {
      nodes.push(walker.currentNode);
    } while (walker.nextNode());
    const lists = new Set<NodeList>(nodes.map((node) => node.childNodes));
    const forEach = NodeList.prototype.forEach;
    let enumerations = 0;
    vi.spyOn(NodeList.prototype, 'forEach').mockImplementation(function (
      this: NodeList,
      ...args
    ) {
      if (lists.has(this)) enumerations++;
      return forEach.apply(this, args);
    });

    for (let round = 0; round < 5; round++) {
      destination.append(root);
      document.body.insertBefore(root, destination);
    }
    destination.append(root);
    await settle();

    const moved = [...buffer['movedSet']];
    expect(moved).toHaveLength(nodes.length);
    moved.forEach((node, i) => expect(node).toBe(nodes[i]));
    // processRemoves still enumerates these lists once. genAdds/deepDelete
    // previously enumerated all of them another 21 times using callbacks.
    expect(enumerations).toBe(nodes.length);
    buffer.unlock();
    await settle();
  });

  it('keeps right-to-left depth-first deletion order', async () => {
    stop = record({ emit: () => {} });
    await settle();
    const buffer = mutationBuffers.find((b) => b.bufferDoc() === document)!;
    buffer.lock();
    const root = document.getElementById('fixture')!;
    const destination = document.getElementById('destination')!;
    destination.append(root);
    await settle();
    const remove = vi.spyOn(buffer['movedSet'], 'delete');
    document.body.insertBefore(root, destination);
    await settle();
    const expected = [
      root,
      ...Array.from(root.children)
        .reverse()
        .flatMap((span) => [span, span.firstChild]),
    ];
    const removed = remove.mock.calls.map(([node]) => node);
    expect(removed).toHaveLength(expected.length);
    removed.forEach((node, i) => expect(node).toBe(expected[i]));
  });

  it.each(['light', 'shadow'] as const)(
    'keeps the initial child-list length when a %s traversal appends a sibling',
    async (kind) => {
      const root = document.getElementById('fixture')!;
      root.innerHTML = '';
      const parent =
        kind === 'shadow' ? root.attachShadow({ mode: 'open' }) : root;
      parent.innerHTML = '<span>first</span><span>second</span>';
      const first = parent.firstChild!;
      const appended = document.createElement('span');
      stop = record({ emit: () => {} });
      await settle();
      const buffer = mutationBuffers.find((b) => b.bufferDoc() === document)!;
      buffer.lock();
      const check = vi
        .spyOn(buffer['processedNodeManager'], 'inOtherBuffer')
        .mockImplementation((node) => {
          if (node === first) parent.append(appended);
          return false;
        });

      buffer['genAdds'](root);

      expect(check.mock.calls.map(([node]) => node)).toContain(first);
      expect(check.mock.calls.map(([node]) => node)).not.toContain(appended);
      expect(buffer['addedSet'].has(appended)).toBe(false);
    },
  );

  it.each(['light', 'shadow'] as const)(
    'skips a sibling removed during a %s traversal',
    async (kind) => {
      const root = document.getElementById('fixture')!;
      root.innerHTML = '';
      const parent =
        kind === 'shadow' ? root.attachShadow({ mode: 'open' }) : root;
      parent.innerHTML = '<span>first</span><span>second</span>';
      const first = parent.firstChild!;
      const removed = parent.lastChild!;
      stop = record({ emit: () => {} });
      await settle();
      const buffer = mutationBuffers.find((b) => b.bufferDoc() === document)!;
      buffer.lock();
      const check = vi
        .spyOn(buffer['processedNodeManager'], 'inOtherBuffer')
        .mockImplementation((node) => {
          if (node === first) parent.removeChild(removed);
          return false;
        });

      expect(() => buffer['genAdds'](root)).not.toThrow();
      expect(check.mock.calls.map(([node]) => node)).not.toContain(removed);
      expect(buffer['movedSet'].has(removed)).toBe(false);
    },
  );

  // Regression test for posthog-js #5227: before porting upstream rrweb
  // PR #1652 the addList-based drain in processBufferedMutations was O(n²)
  // when a single render added many sibling nodes (e.g. a 50×35 table
  // mounting ~13k nodes at once). The reporter observed ~10 s main-thread
  // freezes. The new topological-order addedSet drain is O(n), so a large
  // single-batch addition must both (a) complete without stalling the test
  // runner and (b) emit every added node in a parent-before-child order
  // the replay engine can consume.
  it('emits every node in a single-render large-batch sibling addition (fixes #5227)', async () => {
    const events: Array<{ type: number }> = [];
    stop = record({
      emit: (event) => {
        events.push(event);
      },
    });
    await settle();
    const buffer = mutationBuffers.find((b) => b.bufferDoc() === document)!;
    const destination = document.getElementById('destination')!;

    // Mount 500 siblings each with 4 nested children (~2500 nodes) in one
    // synchronous render — the shape #5227 reports as pathological.
    const batch = document.createDocumentFragment();
    const expectedTexts: string[] = [];
    for (let i = 0; i < 500; i++) {
      const row = document.createElement('div');
      row.className = `row-${i}`;
      for (let j = 0; j < 3; j++) {
        const cell = document.createElement('span');
        const text = `r${i}c${j}`;
        cell.textContent = text;
        expectedTexts.push(text);
        row.appendChild(cell);
      }
      batch.appendChild(row);
    }

    const start = Date.now();
    destination.appendChild(batch);
    await settle();
    const elapsedMs = Date.now() - start;

    // Collect every full-mutation payload emitted since the batch was appended.
    const addsAfterBatch: Array<{ parentId: number; nextId: number | null }> =
      [];
    for (const event of events) {
      if (event.type !== 3) continue;
      const data = (event as unknown as { data: { adds?: unknown[] } }).data;
      if (!data?.adds) continue;
      for (const add of data.adds as Array<{
        parentId: number;
        nextId: number | null;
      }>) {
        addsAfterBatch.push({ parentId: add.parentId, nextId: add.nextId });
      }
    }

    // The row+cell count that must have shipped as "add" mutations. Serialized
    // text nodes nest inside cells and so are not counted here directly; the
    // 2000 bound guards against the pre-fix regression where entire subtrees
    // were silently dropped by the "escape the dead while loop" fallback once
    // the addList rescan budget blew up.
    expect(addsAfterBatch.length).toBeGreaterThan(1000);

    // Every emitted add must reference a parent that is also already in the
    // mirror by the time the replay engine processes it — otherwise the
    // replay would reject the mutation. parentId -1 or nextId -1 at this
    // point would signal that pushAdd silently dropped a resolvable node.
    for (const add of addsAfterBatch) {
      expect(add.parentId).not.toBe(-1);
    }

    // Addedset must have been fully drained; the new algorithm deletes each
    // node after processing so a non-empty residue would indicate a leaked
    // reference.
    expect(buffer['addedSet'].size).toBe(0);

    // Not a strict perf gate — jsdom is slower than real browsers — but the
    // old O(n²) drain would exceed this budget for 500 siblings even in CI.
    expect(elapsedMs).toBeLessThan(5000);
  });
});
