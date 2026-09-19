// @vitest-environment jsdom
import type { eventWithTime } from '@posthog/rrweb-types';
import MutationBuffer from '../../src/record/mutation';
import record from '../../src/record';
import { mutationBuffers } from '../../src/record/observer';

type BlockingProbe = {
  blockClass: string | RegExp;
  blockSelector: string | null;
  isBlockedAtEmission: (node: Node | null) => boolean;
};

function createProbe(blockClass: string | RegExp = 'ph-no-capture') {
  // Exercise the emission predicate without JSDOM's recorder/observer setup.
  // Built-SDK Playwright tests cover the actual buffered payloads.
  const buffer = new MutationBuffer() as unknown as BlockingProbe;
  buffer.blockClass = blockClass;
  buffer.blockSelector = null;
  return buffer;
}

describe('mutation emission blocking', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('reads current light-DOM ancestors instead of caching eligibility', () => {
    const root = document.createElement('div');
    const span = document.createElement('span');
    const text = document.createTextNode('content');
    span.append(text);
    root.append(span);
    document.body.append(root);
    const buffer = createProbe();
    expect(buffer.isBlockedAtEmission(text)).toBe(false);
    root.classList.add('ph-no-capture');
    expect(buffer.isBlockedAtEmission(text)).toBe(true);
    root.classList.remove('ph-no-capture');
    expect(buffer.isBlockedAtEmission(text)).toBe(false);
    expect(buffer.isBlockedAtEmission(null)).toBe(false);
  });

  it.each(['open', 'closed'] as const)(
    'checks every host boundary, including a %s shadow-root target',
    (mode) => {
      const root = document.createElement('div');
      const outerHost = document.createElement('div');
      const outerShadow = outerHost.attachShadow({ mode: 'open' });
      const innerHost = document.createElement('div');
      const innerShadow = innerHost.attachShadow({ mode });
      const span = document.createElement('span');
      span.textContent = 'content';
      innerShadow.append(span);
      outerShadow.append(innerHost);
      root.append(outerHost);
      document.body.append(root);
      const buffer = createProbe();

      innerHost.classList.add('ph-no-capture');
      expect(buffer.isBlockedAtEmission(span.firstChild)).toBe(true);
      expect(buffer.isBlockedAtEmission(innerShadow)).toBe(true);
      innerHost.classList.remove('ph-no-capture');
      root.classList.add('ph-no-capture');
      expect(buffer.isBlockedAtEmission(span.firstChild)).toBe(true);
      root.classList.remove('ph-no-capture');
      buffer.blockSelector = '.secret';
      outerHost.classList.add('secret');
      expect(buffer.isBlockedAtEmission(span.firstChild)).toBe(true);
      outerHost.classList.remove('secret');
      expect(buffer.isBlockedAtEmission(span.firstChild)).toBe(false);
    },
  );

  it.each([null, undefined])(
    'tolerates runtime blockClass %s while retaining selector blocking',
    (blockClass) => {
      const root = document.createElement('div');
      root.className = 'public';
      const host = document.createElement('div');
      const span = document.createElement('span');
      host.attachShadow({ mode: 'open' }).append(span);
      root.append(host);
      document.body.append(root);
      const buffer = createProbe();
      // Untyped callers can supply nullish values despite the declared type.
      Object.assign(buffer, { blockClass });
      expect(buffer.isBlockedAtEmission(span)).toBe(false);
      buffer.blockSelector = '.secret';
      root.classList.add('secret');
      expect(buffer.isBlockedAtEmission(span)).toBe(true);
      root.classList.remove('secret');
      expect(buffer.isBlockedAtEmission(span)).toBe(false);
    },
  );

  it.each(['g', 'y'])(
    'retains cross-frame stateful regexps with flag %s',
    (flag) => {
      const iframe = document.createElement('iframe');
      document.body.append(iframe);
      const blockClass = new (iframe.contentWindow as typeof window).RegExp(
        'ph-no-capture',
        flag,
      );
      expect(blockClass).not.toBeInstanceOf(RegExp);
      blockClass.lastIndex = 4;
      Object.freeze(blockClass);
      const root = document.createElement('div');
      root.className = 'ph-no-capture';
      document.body.append(root);
      expect(createProbe(blockClass).isBlockedAtEmission(root)).toBe(true);
      expect(blockClass.lastIndex).toBe(4);
    },
  );

  it('does not write to a frozen non-stateful regexp', () => {
    const root = document.createElement('div');
    root.className = 'ph-no-capture';
    document.body.append(root);
    const blockClass = Object.freeze(/ph-no-capture/);
    expect(createProbe(blockClass).isBlockedAtEmission(root)).toBe(true);
  });

  it.each([
    /ph-no-capture/g,
    /ph-no-capture/gi,
    /ph-no-capture/y,
    /ph-no-capture/iy,
  ])(
    'supports frozen stateful blockClass %s without changing its flags',
    (blockClass) => {
      blockClass.lastIndex = 4;
      Object.freeze(blockClass);
      const root = document.createElement('div');
      const host = document.createElement('div');
      const span = document.createElement('span');
      host.attachShadow({ mode: 'open' }).append(span);
      root.append(host);
      document.body.append(root);
      const buffer = createProbe(blockClass);
      root.className = 'ph-no-capture';
      for (let i = 0; i < 3; i++) {
        expect(buffer.isBlockedAtEmission(span)).toBe(true);
        expect(blockClass.lastIndex).toBe(4);
      }
      root.className = 'PH-NO-CAPTURE';
      expect(buffer.isBlockedAtEmission(span)).toBe(blockClass.ignoreCase);
      root.className = 'prefix-ph-no-capture';
      expect(buffer.isBlockedAtEmission(span)).toBe(!blockClass.sticky);
      root.className = 'public';
      expect(buffer.isBlockedAtEmission(span)).toBe(false);
      expect(blockClass.lastIndex).toBe(4);
      expect(Object.isFrozen(blockClass)).toBe(true);
    },
  );

  it.each([/ph-no-capture/g, /ph-no-capture/y])(
    'does not depend on or advance stateful blockClass %s',
    (blockClass) => {
      const root = document.createElement('div');
      const span = document.createElement('span');
      root.append(span);
      document.body.append(root);
      const buffer = createProbe(blockClass);
      blockClass.lastIndex = 4;
      root.classList.add('ph-no-capture');
      for (let i = 0; i < 3; i++) {
        expect(buffer.isBlockedAtEmission(span)).toBe(true);
        expect(blockClass.lastIndex).toBe(4);
      }
      root.classList.remove('ph-no-capture');
      expect(buffer.isBlockedAtEmission(span)).toBe(false);
      expect(blockClass.lastIndex).toBe(4);
    },
  );
});

describe('mutation emission blocking in the buffered payload', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  let stop: (() => void) | undefined;

  afterEach(() => {
    stop?.();
    stop = undefined;
    document.body.innerHTML = '';
  });

  // The queue is built while the node is still recordable, so only the
  // emission-time check can keep its descendants out of the payload.
  it('drops descendants of a node blocked after it was queued', async () => {
    const events: eventWithTime[] = [];
    stop = record({ emit: (event) => events.push(event) });
    await settle();
    const buffer = mutationBuffers.find((b) => b.bufferDoc() === document)!;
    buffer.lock();

    const host = document.createElement('div');
    const child = document.createElement('span');
    child.id = 'child-of-blocked';
    host.append(child);
    document.body.append(host);
    await settle();

    host.classList.add('rr-block');
    buffer.unlock();
    await settle();

    const adds = events
      .filter((event) => event.type === 3 && event.data.source === 0)
      .flatMap((event) => (event.data as { adds: { node: unknown }[] }).adds)
      .map((add) => add.node as { type: number; attributes?: { id?: string } });
    expect(adds.length).toBeGreaterThan(0);
    expect(adds.some((node) => node.attributes?.id === 'child-of-blocked')).toBe(
      false,
    );
  });
});
