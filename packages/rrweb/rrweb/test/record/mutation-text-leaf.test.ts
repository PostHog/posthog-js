// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import dom from '@posthog/rrweb-utils';
import record from '../../src/record';
import { mutationBuffers } from '../../src/record/observer';
import type { eventWithTime } from '@posthog/rrweb-types';

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
let stop: (() => void) | undefined;
afterEach(() => {
  vi.restoreAllMocks();
  stop?.();
  document.body.innerHTML = '';
});

it.each([
  { blockClass: /blocked/g, initialIndex: 2, blocked: false },
  { blockClass: /isibl/g, initialIndex: 1, blocked: true },
])(
  'filters text-leaf additions without advancing $blockClass',
  async ({ blockClass, initialIndex, blocked }) => {
    // Record the text before adding a class that the matching case would block.
    document.body.innerHTML = '<span>value</span>';
    const span = document.querySelector('span')!;
    const text = span.firstChild!;
    const events: eventWithTime[] = [];
    stop = record({ emit: (event) => events.push(event), blockClass });
    await settle();
    const buffer = mutationBuffers.find((b) => b.bufferDoc() === document)!;
    expect(buffer['mirror'].hasNode(text)).toBe(true);
    buffer.lock();
    span.className = 'visible';
    events.length = 0;
    blockClass.lastIndex = initialIndex;
    buffer['genAdds'](text);
    expect(blockClass.lastIndex).toBe(initialIndex);
    expect(buffer['movedSet'].has(text)).toBe(true);
    buffer.unlock();
    await settle();
    const additions = events.flatMap((event) =>
      event.type === 3 && event.data.source === 0 ? event.data.adds : [],
    );
    expect(
      additions.some(
        ({ node }) => node.type === 3 && node.textContent === 'value',
      ),
    ).toBe(!blocked);
  },
);

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
