// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom's ShadowRoot doesn't pass isNativeShadowDom's toString check.
vi.mock('@posthog/rrweb-snapshot', async () => {
  const actual = await vi.importActual('@posthog/rrweb-snapshot');
  return {
    ...actual,
    isNativeShadowDom: () => true,
  };
});

import { EventType, IncrementalSource } from '@posthog/rrweb-types';
import type { eventWithTime } from '@posthog/rrweb-types';
import record from '../../src/record';
import { mutationBuffers } from '../../src/record/observer';

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

// jsdom also observes rrweb's untainted-prototype helper iframes, so only
// count buffers recording the top-level document (its own and its shadow roots).
const pageBuffers = () =>
  mutationBuffers.filter((buffer) => buffer.bufferDoc() === document);

function createHost(): HTMLElement {
  const host = document.createElement('price-tag');
  host.attachShadow({ mode: 'open' }).innerHTML = '<span>$10</span>';
  return host;
}

describe('releasing removed shadow hosts', () => {
  let stop: (() => void) | undefined;
  let events: eventWithTime[];

  const addedTexts = () =>
    events.flatMap((event) =>
      event.type === EventType.IncrementalSnapshot &&
      event.data.source === IncrementalSource.Mutation
        ? event.data.adds.map((add) =>
            'textContent' in add.node ? add.node.textContent : '',
          )
        : [],
    );

  beforeEach(async () => {
    document.body.innerHTML =
      '<main id="page"></main><aside id="other"></aside>';
    events = [];
    stop = record({ emit: (event) => events.push(event) });
    await settle();
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('releases the shadow observer when a top-level host is removed', async () => {
    const baseline = pageBuffers().length;
    const host = createHost();
    document.getElementById('page')!.appendChild(host);
    await settle();
    expect(pageBuffers().length).toBe(baseline + 1);
    const shadowBuffer = pageBuffers().at(-1);

    host.remove();
    await settle();

    expect(pageBuffers()).not.toContain(shadowBuffer);
    expect(pageBuffers().length).toBe(baseline);
  });

  it('does not grow one observer per removed host across repeated mounts', async () => {
    const baseline = pageBuffers().length;
    const page = document.getElementById('page')!;
    for (let i = 0; i < 10; i++) {
      const host = createHost();
      page.appendChild(host);
      await settle();
      host.remove();
      await settle();
    }
    expect(pageBuffers().length).toBe(baseline);
  });

  it('releases shadow observers nested inside a removed host', async () => {
    const baseline = pageBuffers().length;
    const host = createHost();
    host.shadowRoot!.appendChild(createHost());
    document.getElementById('page')!.appendChild(host);
    await settle();
    expect(pageBuffers().length).toBe(baseline + 2);

    host.remove();
    await settle();

    expect(pageBuffers().length).toBe(baseline);
  });

  it('keeps observing a host moved within the same mutation batch', async () => {
    const baseline = pageBuffers().length;
    const host = createHost();
    document.getElementById('page')!.appendChild(host);
    await settle();
    const shadowBuffer = pageBuffers().at(-1);

    // Removal and insertion land in one MutationObserver callback.
    host.remove();
    document.getElementById('other')!.appendChild(host);
    await settle();

    expect(pageBuffers()).toContain(shadowBuffer);
    expect(pageBuffers().length).toBe(baseline + 1);

    host.shadowRoot!.appendChild(document.createTextNode('after-move'));
    await settle();
    expect(addedTexts()).toContain('after-move');
  });

  it('observes a host again when it is re-inserted after removal', async () => {
    const baseline = pageBuffers().length;
    const host = createHost();
    const page = document.getElementById('page')!;
    page.appendChild(host);
    await settle();

    host.remove();
    await settle();
    expect(pageBuffers().length).toBe(baseline);

    page.appendChild(host);
    await settle();
    expect(pageBuffers().length).toBe(baseline + 1);

    host.shadowRoot!.appendChild(document.createTextNode('after-reinsert'));
    await settle();
    expect(addedTexts()).toContain('after-reinsert');
  });

  it('releases a host removed from inside a blocked container', async () => {
    const baseline = pageBuffers().length;
    const container = document.getElementById('page')!;
    const host = createHost();
    container.appendChild(host);
    await settle();
    expect(pageBuffers().length).toBe(baseline + 1);

    container.classList.add('rr-block');
    await settle();
    host.remove();
    await settle();

    expect(pageBuffers().length).toBe(baseline);
  });

  it('releases a removed host even when it was moved earlier in the same batch', async () => {
    const baseline = pageBuffers().length;
    const host = createHost();
    document.getElementById('page')!.appendChild(host);
    await settle();

    document.getElementById('other')!.appendChild(host);
    host.remove();
    await settle();

    expect(pageBuffers().length).toBe(baseline);
  });
});
