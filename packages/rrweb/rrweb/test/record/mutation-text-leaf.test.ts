// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import dom from '@posthog/rrweb-utils';
import record from '../../src/record';
import { mutationBuffers } from '../../src/record/observer';

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
let stop: (() => void) | undefined;
afterEach(() => {
  vi.restoreAllMocks();
  stop?.();
  document.body.innerHTML = '';
});

it('still evaluates the blocking regexp for a text leaf', async () => {
  document.body.innerHTML = '<span class="visible">value</span>';
  const text = document.querySelector('span')!.firstChild!;
  const blockClass = /blocked/g;
  stop = record({ emit: () => {}, blockClass });
  await settle();
  const buffer = mutationBuffers.find((b) => b.bufferDoc() === document)!;
  buffer.lock();
  const test = vi.spyOn(blockClass, 'test');
  blockClass.lastIndex = 2;
  buffer['genAdds'](text);
  expect(test).toHaveBeenCalledWith('visible');
  expect(blockClass.lastIndex).toBe(0);
  expect(buffer['movedSet'].has(text)).toBe(true);
});

it('does not fetch empty text child lists during repeated add/delete walks', async () => {
  document.body.innerHTML =
    '<main>' + '<span>value</span>'.repeat(100) + '</main><aside></aside>';
  const root = document.querySelector('main')!;
  const destination = document.querySelector('aside')!;
  const texts = new Set<Node>(
    Array.from(root.children, (node) => node.firstChild!),
  );
  stop = record({ emit: () => {} });
  await settle();
  const buffer = mutationBuffers.find((b) => b.bufferDoc() === document)!;
  buffer.lock();
  const children = vi.spyOn(dom, 'childNodes');
  for (let round = 0; round < 5; round++) {
    destination.append(root);
    document.body.insertBefore(root, destination);
  }
  destination.append(root);
  await settle();
  expect(texts.size).toBe(100);
  for (const text of texts) expect(buffer['movedSet'].has(text)).toBe(true);
  // The unchanged processRemoves walk still reads each text's list once.
  expect(children.mock.calls.filter(([node]) => texts.has(node)).length).toBe(
    100,
  );
  buffer.unlock();
  await settle();
});
