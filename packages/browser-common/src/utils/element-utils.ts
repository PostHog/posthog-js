// Node.nodeType integer constants. We use the integers directly rather than
// `Node.ELEMENT_NODE` etc. for browser portability (IE11) and to avoid a
// runtime reference to the global `Node` in environments where it isn't defined.
const NODE_TYPE_ELEMENT = 1
const NODE_TYPE_TEXT = 3
const NODE_TYPE_DOCUMENT_FRAGMENT = 11

/*
 * Check whether an element has nodeType Node.ELEMENT_NODE
 */
export function isElementNode(el: Node | Element | undefined | null): el is Element {
    return !!el && el.nodeType === NODE_TYPE_ELEMENT
}

/*
 * Check whether an element is of a given tag type.
 * Due to potential reference discrepancies (such as the webcomponents.js polyfill),
 * we want to match tagNames instead of specific references.
 */
export function isTag(el: Element | undefined | null, tag: string): el is HTMLElement {
    return !!el && !!el.tagName && el.tagName.toLowerCase() === tag.toLowerCase()
}

/*
 * Check whether an element has nodeType Node.TEXT_NODE
 */
export function isTextNode(el: Element | Node | undefined | null): el is HTMLElement {
    return !!el && el.nodeType === NODE_TYPE_TEXT
}

/*
 * Check whether a node is a ShadowRoot — a DocumentFragment whose `host` is
 * a real Element. Plain DocumentFragments (e.g. <template> content) share
 * the same nodeType but have no `host`, so they are not ShadowRoots.
 */
export function isShadowRoot(el: Node | ParentNode | undefined | null): el is ShadowRoot {
    return !!el && el.nodeType === NODE_TYPE_DOCUMENT_FRAGMENT && isElementNode((el as ShadowRoot).host)
}
