/**
 * @vitest-environment jsdom
 */
import { createMirror, IGNORED_NODE } from '@posthog/rrweb-snapshot';
import { NodeType, type mutationCallbackParam } from '@posthog/rrweb-types';
import { describe, expect, it, vi } from 'vitest';
import MutationBuffer from '../../src/record/mutation';

function poisonScriptElementIdentity(script: HTMLScriptElement) {
  Object.defineProperty(script, 'tagName', {
    configurable: true,
    value: 'DIV',
  });
  Object.defineProperty(script, 'nodeName', {
    configurable: true,
    value: 'DIV',
  });
  Object.defineProperty(script, 'nodeType', {
    configurable: true,
    value: Node.TEXT_NODE,
  });
  Object.defineProperties(script, {
    ELEMENT_NODE: { configurable: true, value: Node.TEXT_NODE },
    TEXT_NODE: { configurable: true, value: Node.ELEMENT_NODE },
  });
}

function recordCharacterDataMutation(
  type: string,
  text: string | string[],
  targetIndex = 0,
  maskScript = false,
) {
  const script = document.createElement('script');
  script.type = type;
  if (maskScript) {
    const maskedParent = document.createElement('div');
    maskedParent.className = 'rr-mask';
    maskedParent.append(script);
  }
  poisonScriptElementIdentity(script);
  Object.defineProperty(script, 'getAttribute', {
    configurable: true,
    value: () => 'application/ld+json',
  });
  const textNodes = (Array.isArray(text) ? text : [text]).map((part) => {
    const textNode = document.createTextNode(part);
    script.append(textNode);
    return textNode;
  });
  const mirror = createMirror();
  mirror.add(script, {
    id: 1,
    type: NodeType.Element,
    tagName: 'script',
    attributes: { type },
    childNodes: [],
  });
  textNodes.forEach((textNode, index) => {
    mirror.add(textNode, {
      id: index === 0 ? 2 : IGNORED_NODE,
      type: NodeType.Text,
      textContent: '',
    });
  });

  const mutationCb = vi.fn<(mutation: mutationCallbackParam) => void>();
  const buffer = new MutationBuffer();
  buffer.init({
    mutationCb,
    mirror,
    blockClass: 'rr-block',
    blockSelector: null,
    maskTextClass: 'rr-mask',
    maskTextSelector: null,
    maskTextFn: undefined,
    slimDOMOptions: { script: true, jsonLd: true },
    canvasManager: { acquire: vi.fn(), reset: vi.fn() },
    shadowDomManager: { reset: vi.fn() },
  } as never);
  buffer.processMutations([
    {
      type: 'characterData',
      target: textNodes[targetIndex],
      oldValue: 'old value',
    } as MutationRecord,
  ]);

  return mutationCb.mock.calls[0]?.[0].texts || [];
}

function recordScriptAttributeMutation(
  attributeName: string,
  type = 'application/ld+json',
  removeScripts = true,
) {
  const script = document.createElement('script');
  script.type = type;
  poisonScriptElementIdentity(script);
  script.setAttribute(attributeName, 'private-value');
  const mirror = createMirror();
  mirror.add(script, {
    id: 1,
    type: NodeType.Element,
    tagName: 'script',
    attributes: { type },
    childNodes: [],
  });

  const mutationCb = vi.fn<(mutation: mutationCallbackParam) => void>();
  const buffer = new MutationBuffer();
  buffer.init({
    mutationCb,
    mirror,
    blockClass: 'rr-block',
    blockSelector: null,
    maskTextClass: 'rr-mask',
    maskTextSelector: null,
    maskTextFn: undefined,
    slimDOMOptions: { script: removeScripts, jsonLd: true },
    canvasManager: { acquire: vi.fn(), reset: vi.fn() },
    shadowDomManager: { reset: vi.fn() },
  } as never);
  buffer.processMutations([
    {
      type: 'attributes',
      target: script,
      attributeName,
      oldValue: null,
    } as MutationRecord,
  ]);

  return mutationCb;
}

function recordChildListAddition(
  child: Node,
  parent: Element = document.createElement('div'),
  recordedParentAttributes: Record<string, string> = {},
  removeScripts = true,
  captureJsonLd = true,
) {
  if (child.parentNode !== parent) {
    parent.append(child);
  }
  document.body.append(parent);
  const mirror = createMirror();
  mirror.add(parent, {
    id: 100,
    type: NodeType.Element,
    tagName: parent.tagName.toLowerCase(),
    attributes: recordedParentAttributes,
    childNodes: [],
  });
  Array.from(parent.childNodes)
    .filter((node) => node !== child)
    .forEach((node, index) => {
      mirror.add(node, {
        id: index + 101,
        type: NodeType.Text,
        textContent: node.textContent || '',
      });
    });

  const mutationCb = vi.fn<(mutation: mutationCallbackParam) => void>();
  const buffer = new MutationBuffer();
  buffer.init({
    mutationCb,
    mirror,
    blockClass: 'rr-block',
    blockSelector: null,
    maskTextClass: 'rr-mask',
    maskTextSelector: null,
    maskTextFn: undefined,
    maskInputOptions: { password: true },
    maskInputFn: undefined,
    maskAllElementAttributes: false,
    maskAttributeFn: undefined,
    slimDOMOptions: { script: removeScripts, jsonLd: captureJsonLd },
    inlineStylesheet: true,
    dataURLOptions: {},
    inlineImages: false,
    recordCanvas: false,
    canvasMaskingConfigured: false,
    keepIframeSrcFn: () => false,
    doc: document,
    iframeManager: {
      addIframe: vi.fn(),
      attachIframe: vi.fn(),
      registerLoadListenerDisposer: vi.fn(),
    },
    stylesheetManager: {
      trackLinkElement: vi.fn(),
      attachLinkElement: vi.fn(),
    },
    canvasManager: { acquire: vi.fn(), reset: vi.fn() },
    shadowDomManager: {
      reset: vi.fn(),
      addShadowRoot: vi.fn(),
      observeAttachShadow: vi.fn(),
    },
    processedNodeManager: {
      inOtherBuffer: vi.fn().mockReturnValue(false),
      add: vi.fn(),
    },
  } as never);
  buffer.processMutations([
    {
      type: 'childList',
      target: parent,
      addedNodes: [child],
      removedNodes: [],
      previousSibling: null,
      nextSibling: null,
    } as unknown as MutationRecord,
  ]);

  parent.remove();
  return mutationCb.mock.calls[0]?.[0];
}

describe('script mutations', () => {
  it('clears JSON-LD content that no longer passes validation', () => {
    expect(recordCharacterDataMutation('application/ld+json', '{')[0].value).toBe('');
  });

  it('does not record masked JSON-LD text mutations', () => {
    expect(
      recordCharacterDataMutation(
        'application/ld+json',
        '{"@context":"https://schema.org","@type":"Product","name":"Private product"}',
        0,
        true,
      ),
    ).toEqual([]);
  });

  it('does not record JavaScript source', () => {
    expect(
      recordCharacterDataMutation(
        'text/javascript',
        'globalThis.customerEmail = "customer@example.com"',
      )[0].value,
    ).toBe('SCRIPT_PLACEHOLDER');
  });

  it('emits one sanitized mutation for a script with multiple text nodes', () => {
    const mutations = recordCharacterDataMutation(
      'application/ld+json',
      [
        '{"@context":"https://schema.org",',
        '"@type":"Product","name":"Canvas shoes","email":"private@example.com"}',
      ],
      1,
    );

    expect(mutations).toHaveLength(1);
    expect(mutations[0].id).toBe(2);
    expect(JSON.parse(mutations[0].value)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Canvas shoes',
    });
  });

  it('does not record script attribute mutations', () => {
    expect(
      recordScriptAttributeMutation('data-customer-email'),
    ).not.toHaveBeenCalled();
  });

  it('records JavaScript attributes when script removal is disabled', () => {
    const mutationCb = recordScriptAttributeMutation(
      'data-public',
      'text/javascript',
      false,
    );

    expect(mutationCb).toHaveBeenCalledWith({
      texts: [],
      attributes: [
        {
          id: 1,
          attributes: { 'data-public': 'private-value' },
        },
      ],
      removes: [],
      adds: [],
    });
  });

  it('sanitizes dynamically added JSON-LD scripts', () => {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.setAttribute('nonce', 'private-nonce');
    script.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Canvas shoes',
      customerEmail: 'private@example.com',
    });
    script.append(document.createComment('private-comment@example.com'));
    const privateElement = document.createElement('span');
    privateElement.setAttribute('data-email', 'private-attribute@example.com');
    script.append(privateElement);

    const eventBytes = JSON.stringify(recordChildListAddition(script));

    expect(eventBytes).toContain('Canvas shoes');
    expect(eventBytes).not.toContain('private@example.com');
    expect(eventBytes).not.toContain('private-nonce');
    expect(eventBytes).not.toContain('private-comment@example.com');
    expect(eventBytes).not.toContain('private-attribute@example.com');
  });

  it('drops dynamically added JSON-LD unless capture is enabled', () => {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent =
      '{"@context":"https://schema.org","@type":"Product","name":"Canvas shoes"}';

    expect(
      recordChildListAddition(script, undefined, {}, true, false),
    ).toBeUndefined();
  });

  it('drops dynamically added JSON-LD under an explicit text mask', () => {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.className = 'rr-mask';
    script.textContent =
      '{"@context":"https://schema.org","@type":"Product","name":"Private product"}';

    expect(recordChildListAddition(script)).toBeUndefined();
  });

  it('drops dynamically added JavaScript', () => {
    const script = document.createElement('script');
    script.textContent = 'globalThis.customerEmail = "private@example.com"';

    expect(recordChildListAddition(script)).toBeUndefined();
  });

  it('uses placeholders for dynamic JavaScript when script removal is disabled', () => {
    const script = document.createElement('script');
    script.textContent = 'globalThis.customerEmail = "private@example.com"';

    const eventBytes = JSON.stringify(
      recordChildListAddition(script, undefined, {}, false),
    );

    expect(eventBytes).toContain('SCRIPT_PLACEHOLDER');
    expect(eventBytes).not.toContain('private@example.com');
  });

  it('drops new children after a recorded script changes type', () => {
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.textContent = 'globalThis.customerEmail = "private@example.com"';
    const privateComment = document.createComment('private-comment@example.com');
    script.append(privateComment);

    expect(
      recordChildListAddition(privateComment, script, {
        type: 'application/ld+json',
      }),
    ).toBeUndefined();
  });
});
