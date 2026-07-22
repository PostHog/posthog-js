import { TOOLBAR_CONTAINER_CLASS, TOOLBAR_ID } from '../constants'

// Node.nodeType integer constants. We use the integers directly rather than
// `Node.ELEMENT_NODE` etc. for browser portability (IE11) and to avoid a
// runtime reference to the global `Node` in environments where it isn't defined.
const NODE_TYPE_ELEMENT = 1
const NODE_TYPE_TEXT = 3
const NODE_TYPE_DOCUMENT_FRAGMENT = 11

export function isElementInToolbar(el: EventTarget | null): boolean {
    if (el instanceof Element) {
        // closest isn't available in IE11, but we'll polyfill when bundling
        return el.id === TOOLBAR_ID || !!el.closest?.('.' + TOOLBAR_CONTAINER_CLASS)
    }
    return false
}

/*
 * Check whether an element has nodeType Node.ELEMENT_NODE
 * @param {Element} el - element to check
 * @returns {boolean} whether el is of the correct nodeType
 */
export function isElementNode(el: Node | Element | undefined | null): el is Element {
    return !!el && el.nodeType === NODE_TYPE_ELEMENT
}

/*
 * Check whether an element is of a given tag type.
 * Due to potential reference discrepancies (such as the webcomponents.js polyfill),
 * we want to match tagNames instead of specific references because something like
 * element === document.body won't always work because element might not be a native
 * element.
 * @param {Element} el - element to check
 * @param {string} tag - tag name (e.g., "div")
 * @returns {boolean} whether el is of the given tag type
 */
export function isTag(el: Element | undefined | null, tag: string): el is HTMLElement {
    return !!el && !!el.tagName && el.tagName.toLowerCase() === tag.toLowerCase()
}

/*
 * Check whether an element has nodeType Node.TEXT_NODE
 * @param {Element} el - element to check
 * @returns {boolean} whether el is of the correct nodeType
 */
export function isTextNode(el: Element | undefined | null): el is HTMLElement {
    return !!el && el.nodeType === NODE_TYPE_TEXT
}

/*
 * Check whether a node is a ShadowRoot — a DocumentFragment whose `host` is
 * a real Element. Plain DocumentFragments (e.g. <template> content) share
 * the same nodeType but have no `host`, so they are not ShadowRoots.
 * @param {Node|undefined|null} el - node to check
 * @returns {boolean} whether el is a ShadowRoot we can hop through to its host
 */
export function isShadowRoot(el: Node | ParentNode | undefined | null): el is ShadowRoot {
    return !!el && el.nodeType === NODE_TYPE_DOCUMENT_FRAGMENT && isElementNode((el as ShadowRoot).host)
}
