// @vitest-environment jsdom
import MutationBuffer from '../../src/record/mutation';

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

  it('does not write to a frozen non-stateful regexp', () => {
    const root = document.createElement('div');
    root.className = 'ph-no-capture';
    document.body.append(root);
    const blockClass = Object.freeze(/ph-no-capture/);
    expect(createProbe(blockClass).isBlockedAtEmission(root)).toBe(true);
  });

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
