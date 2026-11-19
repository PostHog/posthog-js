import dom from '@posthog/rrweb-utils';
import type { MaskInputOptions, SelectMaskingFn } from './types';
import { isElement, isShadowRoot } from './utils';

export function getHtmlTagName(element: Element): string | undefined {
  return element.namespaceURI === 'http://www.w3.org/1999/xhtml'
    ? element.localName
    : undefined;
}

export type SelectMaskingCache = {
  input: WeakMap<Element, MaskInputOptions>;
  content: WeakMap<Node, boolean>;
  owner: WeakMap<Element, Element | null>;
};

export function getOptionOwner(
  option: Element,
  cache?: SelectMaskingCache,
): Element | null {
  let owner: Element | null = dom.parentElement(option);
  const visited: Element[] = [];
  while (owner && getHtmlTagName(owner) !== 'select') {
    const cached = cache?.owner.get(owner);
    if (cached !== undefined) {
      owner = cached;
      break;
    }
    visited.push(owner);
    owner = dom.parentElement(owner);
  }
  for (const parent of visited) cache?.owner.set(parent, owner);
  return owner;
}

export function getInputMaskOptions(
  element: Element,
  options: MaskInputOptions,
  selectMaskingFn?: SelectMaskingFn,
  cache: SelectMaskingCache | undefined = undefined,
): MaskInputOptions {
  if (!selectMaskingFn || getHtmlTagName(element) !== 'select') return options;
  const cached = cache?.input.get(element);
  if (cached) return cached;
  let masked: boolean;
  try {
    masked = selectMaskingFn(element as HTMLSelectElement) !== 'unmasked';
  } catch {
    masked = true;
  }
  const result = { ...options, select: masked };
  cache?.input.set(element, result);
  return result;
}

export function isMaskedSelectedContent(
  node: Node,
  options: MaskInputOptions,
  selectMaskingFn?: SelectMaskingFn,
  cache?: SelectMaskingCache,
): boolean {
  if (!selectMaskingFn) return false;
  // Cache inclusive ancestor context, but query the parent to keep the container.
  let ancestor = dom.parentNode(node);
  const visited: Node[] = [];
  let masked = false;
  while (ancestor) {
    const cached = cache?.content.get(ancestor);
    if (cached !== undefined) {
      masked = cached;
      break;
    }
    visited.push(ancestor);
    if (isElement(ancestor) && getHtmlTagName(ancestor) === 'selectedcontent') {
      let owner = dom.parentElement(ancestor);
      while (owner) {
        const tagName = owner.localName;
        // An authored selectedcontent inside an option is static option content.
        if (tagName === 'option') break;
        if (tagName === 'select') {
          if (
            getHtmlTagName(owner) === 'select' &&
            getInputMaskOptions(owner, options, selectMaskingFn, cache).select
          )
            masked = true;
          break;
        }
        owner = dom.parentElement(owner);
      }
      if (masked) break;
    }
    ancestor = isShadowRoot(ancestor)
      ? dom.host(ancestor)
      : dom.parentNode(ancestor);
  }
  for (const ancestor of visited) cache?.content.set(ancestor, masked);
  return masked;
}
