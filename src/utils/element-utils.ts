import { TOOLBAR_ID } from '../constants'
import { window } from './globals'

export function isElementInToolbar(el: Element): boolean {
    // NOTE: .closest is not supported in IE11 hence the operator check
    return el.id === TOOLBAR_ID || !!el.closest?.('#' + TOOLBAR_ID)
}

/**
 * checks if the element or one of its ancestors is disabled
 * has the aria-disabled attribute set to true
 * is a fieldset with disabled set
 * or has pointer-events set to none
 */
export function isDisabledElement(el: Element): boolean {
    if (!isElementNode(el)) {
        // if not an element, it can't be disabled
        return false
    }
    const disabledByStyle = window?.getComputedStyle(el).pointerEvents === 'none'
    return !!el.closest?.('[disabled],[aria-disabled="true"],fieldset[disabled]') || disabledByStyle
}

/*
 * Check whether an element has nodeType Node.ELEMENT_NODE
 * @param {Element} el - element to check
 * @returns {boolean} whether el is of the correct nodeType
 */
export function isElementNode(el: Node | Element | undefined | null): el is Element {
    return !!el && el.nodeType === 1 // Node.ELEMENT_NODE - use integer constant for browser portability
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
    return !!el && el.nodeType === 3 // Node.TEXT_NODE - use integer constant for browser portability
}

/*
 * Check whether an element has nodeType Node.DOCUMENT_FRAGMENT_NODE
 * @param {Element} el - element to check
 * @returns {boolean} whether el is of the correct nodeType
 */
export function isDocumentFragment(el: Element | ParentNode | undefined | null): el is DocumentFragment {
    return !!el && el.nodeType === 11 // Node.DOCUMENT_FRAGMENT_NODE - use integer constant for browser portability
}
