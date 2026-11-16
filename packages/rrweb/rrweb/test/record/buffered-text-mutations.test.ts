/**
 * @vitest-environment jsdom
 */
import { EventType, IncrementalSource } from '@posthog/rrweb-types';
import type { eventWithTime } from '@posthog/rrweb-types';
import record from '../../src/record';
import { mutationBuffers } from '../../src/record/observer';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('buffered text mutations', () => {
  let stop: (() => void) | undefined;
  let events: eventWithTime[];

  beforeEach(async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36',
    );
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
    document.body.innerHTML =
      '<span id="first">first</span><span id="second">second</span><span class="rr-mask">private</span>';
    events = [];
    stop = record({ emit: (event) => events.push(event) });
    await settle();
    events = [];
  });

  afterEach(() => {
    stop?.();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const texts = () =>
    events.flatMap((event) =>
      event.type === EventType.IncrementalSnapshot &&
      event.data.source === IncrementalSource.Mutation
        ? event.data.texts
        : [],
    );

  it('emits only the final value from a 2,000-mutation flood', async () => {
    const text = document.querySelector('#first')!.firstChild!;
    for (let i = 0; i < 2000; i++) text.textContent = String(i);
    await settle();
    expect(texts()).toEqual([{ id: record.mirror.getId(text), value: '1999' }]);
  });

  it.each(['freeze', 'lock'] as const)(
    'collapses changes across callbacks during %s and clears after emission',
    async (mode) => {
      const text = document.querySelector('#first')!.firstChild!;
      const buffer = mutationBuffers.find(
        (buffer) => buffer.bufferDoc() === document,
      )!;
      buffer[mode]();
      for (let i = 0; i < 4; i++) {
        text.textContent = String(i);
        await settle();
      }
      expect(texts()).toEqual([]);
      if (mode === 'freeze') buffer.unfreeze();
      else buffer.unlock();
      expect(texts()).toEqual([{ id: record.mirror.getId(text), value: '3' }]);
      events = [];
      text.textContent = 'next batch';
      await settle();
      expect(texts()).toEqual([
        { id: record.mirror.getId(text), value: 'next batch' },
      ]);
    },
  );

  it('keeps the final value for every distinct node in first-seen order', async () => {
    const first = document.querySelector('#first')!.firstChild!;
    const second = document.querySelector('#second')!.firstChild!;
    first.textContent = 'intermediate';
    second.textContent = 'final second';
    first.textContent = 'final first';
    await settle();
    expect(texts()).toEqual([
      { id: record.mirror.getId(first), value: 'final first' },
      { id: record.mirror.getId(second), value: 'final second' },
    ]);
  });

  it('retains text masking when collapsing repeated changes', async () => {
    const text = document.querySelector('.rr-mask')!.firstChild!;
    text.textContent = 'intermediate secret';
    text.textContent = 'hidden';
    await settle();
    expect(texts()).toEqual([
      { id: record.mirror.getId(text), value: '******' },
    ]);
  });
});
