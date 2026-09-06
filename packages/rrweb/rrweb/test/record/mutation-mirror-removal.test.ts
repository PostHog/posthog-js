// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import record from '../../src/record';
import { mutationBuffers } from '../../src/record/observer';

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('mutation mirror removal queue', () => {
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

  it('traverses a repeatedly moved subtree once per emission, not once per move', async () => {
    stop = record({ emit: () => {} });
    await settle();
    const root = document.getElementById('fixture')!;
    const destination = document.getElementById('destination')!;
    const nodes = [root, ...root.querySelectorAll('span')];
    const ids = nodes.map((node) => record.mirror.getId(node));
    expect(ids.every((id) => id > 0)).toBe(true);
    const remove = vi.spyOn(record.mirror, 'removeNodeFromMap');

    for (let round = 0; round < 5; round++) {
      destination.append(root);
      document.body.insertBefore(root, destination);
    }
    destination.append(root);
    await settle();

    expect(remove.mock.calls.filter(([node]) => node === root)).toHaveLength(1);
    nodes.forEach((node, index) => {
      expect(record.mirror.getId(node)).toBe(ids[index]);
      expect(record.mirror.getNode(ids[index])).toBe(node);
    });

    // Deduplication is only for pending work, not for the lifetime of a node.
    remove.mockClear();
    document.body.insertBefore(root, destination);
    await settle();
    expect(remove.mock.calls.filter(([node]) => node === root)).toHaveLength(1);
    nodes.forEach((node, index) =>
      expect(record.mirror.getNode(ids[index])).toBe(node),
    );
  });

  it('cleans up distinct removed roots and descendants even after repeated moves', async () => {
    stop = record({ emit: () => {} });
    await settle();
    const root = document.getElementById('fixture')!;
    const child = root.firstElementChild!;
    const destination = document.getElementById('destination')!;
    const ids = [root, child, child.firstChild!].map((node) =>
      record.mirror.getId(node),
    );
    destination.append(root);
    document.body.append(root);
    // The child is no longer in root's final subtree. It needs its own cleanup.
    destination.append(child);
    child.remove();
    root.remove();
    await settle();
    ids.forEach((id) => expect(record.mirror.has(id)).toBe(false));
  });

  it('consumes the current root before traversal and leaves later roots queued on error', async () => {
    stop = record({ emit: () => {} });
    await settle();
    const buffer = mutationBuffers.find(
      (buffer) => buffer.bufferDoc() === document,
    )!;
    buffer.lock();
    const a = document.querySelector('#fixture span')!;
    const b = a.nextElementSibling!;
    a.remove();
    b.remove();
    await settle();
    const remove = vi.spyOn(record.mirror, 'removeNodeFromMap');
    remove.mockImplementationOnce(() => {
      throw new Error('cleanup failed');
    });
    expect(() => buffer.destroy()).toThrow('cleanup failed');
    expect(remove.mock.calls[0][0]).toBe(a);
    remove.mockClear();
    buffer.destroy();
    expect(remove.mock.calls[0][0]).toBe(b);
    expect(remove.mock.calls.some(([node]) => node === a)).toBe(false);
    remove.mockClear();
    buffer.destroy();
    expect(remove).not.toHaveBeenCalled();
  });
});
