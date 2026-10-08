// @vitest-environment jsdom
import { Mirror } from '@posthog/rrweb-snapshot';
import type { attributeCursor, mutationRecord } from '@posthog/rrweb-types';
import MutationBuffer from '../../src/record/mutation';

type AttributeProbe = {
  attributes: attributeCursor[];
  processMutation: (m: mutationRecord) => void;
};

function createProbe() {
  // Exercise the attributes branch without JSDOM's recorder/observer setup.
  // Built-SDK Playwright tests cover the actual buffered payloads.
  const buffer = new MutationBuffer();
  Object.assign(buffer, {
    blockClass: 'ph-no-capture',
    blockSelector: null,
    doc: document,
    mirror: new Mirror(),
    slimDOMOptions: {},
    maskInputOptions: {},
    dataURLOptions: {},
    keepIframeSrcFn: () => true,
  });
  return buffer as unknown as AttributeProbe;
}

function attributeMutation(
  target: Element,
  attributeName: string,
): mutationRecord {
  return {
    type: 'attributes',
    target,
    attributeName,
    attributeNamespace: null,
    oldValue: null,
  } as unknown as mutationRecord;
}

function recordedNames(buffer: AttributeProbe): string[] {
  return buffer.attributes.flatMap((item) => Object.keys(item.attributes));
}

function mutate(target: Element, name: string, value: string) {
  const buffer = createProbe();
  document.body.append(target);
  target.setAttribute(name, value);
  buffer.processMutation(attributeMutation(target, name));
  return buffer;
}

describe('attribute mutations', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  // `tagName` is uppercase for HTML elements, so the media check has to
  // normalise it before comparing (upstream rrweb #1921).
  it.each(['video', 'audio'])('ignores autoplay mutations on <%s>', (tag) => {
    const buffer = mutate(document.createElement(tag), 'autoplay', '');
    expect(recordedNames(buffer)).toEqual([]);
  });

  it('records other attributes on media elements', () => {
    const buffer = mutate(document.createElement('video'), 'width', '320');
    expect(buffer.attributes[0].attributes).toEqual({ width: '320' });
  });

  it('records autoplay on elements that are not media elements', () => {
    const buffer = mutate(document.createElement('div'), 'autoplay', '');
    expect(buffer.attributes[0].attributes).toEqual({ autoplay: '' });
  });
});
