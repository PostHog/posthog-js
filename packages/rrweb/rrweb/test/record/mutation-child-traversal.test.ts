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

  // A single-render large-batch sibling addition must emit every added
  // node, in a parent-before-child order the replay engine can consume,
  // without stalling the test runner. 500 rows × (1 div + 3 spans + 3
  // text nodes) = exactly 3500 adds expected.
  it('emits every node in a single-render large-batch sibling addition in parent-before-child order', async () => {
    const events: Array<{ type: number }> = [];
    stop = record({
      emit: (event) => {
        events.push(event);
      },
    });
    await settle();
    const destination = document.getElementById('destination')!;

    const batch = document.createDocumentFragment();
    for (let i = 0; i < 500; i++) {
      const row = document.createElement('div');
      row.className = `row-${i}`;
      for (let j = 0; j < 3; j++) {
        const cell = document.createElement('span');
        cell.textContent = `r${i}c${j}`;
        row.appendChild(cell);
      }
      batch.appendChild(row);
    }

    destination.appendChild(batch);
    await settle();

    const addsAfterBatch: Array<{
      id: number;
      parentId: number;
      nextId: number | null;
    }> = [];
    for (const event of events) {
      if (event.type !== 3) continue;
      const data = (event as unknown as { data: { adds?: unknown[] } }).data;
      if (!data?.adds) continue;
      for (const add of data.adds as Array<{
        parentId: number;
        nextId: number | null;
        node: { id: number };
      }>) {
        addsAfterBatch.push({
          id: add.node.id,
          parentId: add.parentId,
          nextId: add.nextId,
        });
      }
    }

    // Exact count: 500 rows + 1500 cells + 1500 text nodes.
    expect(addsAfterBatch.length).toBe(3500);

    // Every emitted add must reference a parent that was itself serialised
    // earlier in the same emission (or already in the mirror). parentId
    // -1 or an unseen parentId would signal that pushAdd silently dropped
    // a resolvable node.
    const seen = new Set<number>();
    for (const add of addsAfterBatch) {
      expect(add.parentId).not.toBe(-1);
      // The destination (<aside id="destination">) was in the mirror
      // before the batch, so its id is a valid parentId that doesn't
      // appear in the adds. Only check parent-before-child for ids that
      // are themselves added in this batch.
      const addedParent = addsAfterBatch.some((a) => a.id === add.parentId);
      if (addedParent) {
        expect(seen.has(add.parentId)).toBe(true);
      }
      seen.add(add.id);
    }
  });
});
