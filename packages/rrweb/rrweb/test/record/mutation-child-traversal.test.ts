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
      '<span>value</span>'.repeat(100) +
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

    expect([...buffer['movedSet']]).toEqual(nodes);
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
    expect(remove.mock.calls.map(([node]) => node)).toEqual([
      root,
      ...Array.from(root.children)
        .reverse()
        .flatMap((span) => [span, span.firstChild]),
    ]);
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
});
