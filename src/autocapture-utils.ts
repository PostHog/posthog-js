import { trim } from './utils'

import { isNullish, isString, isUndefined } from './utils/type-utils'

export function getEventTarget(e: Event): Element | null {
    // https://developer.mozilla.org/en-US/docs/Web/API/Event/target#Compatibility_notes
    if (isUndefined(e.target)) {
        return (e.srcElement as Element) || null
    } else {
        if ((e.target as HTMLElement)?.shadowRoot) {
            return (e.composedPath()[0] as Element) || null
        }
        return (e.target as Element) || null
    }
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

export const autocaptureCompatibleElements = ['a', 'button', 'form', 'input', 'select', 'textarea', 'label']

export function getParentElement(curEl: Element): Element | false {
    const parentNode = curEl.parentNode
    if (!parentNode || !isElementNode(parentNode)) return false
    return parentNode
}

// Define the core pattern for matching credit card numbers
const coreCCPattern = `(4[0-9]{12}(?:[0-9]{3})?)|(5[1-5][0-9]{14})|(6(?:011|5[0-9]{2})[0-9]{12})|(3[47][0-9]{13})|(3(?:0[0-5]|[68][0-9])[0-9]{11})|((?:2131|1800|35[0-9]{3})[0-9]{11})`
// Create the Anchored version of the regex by adding '^' at the start and '$' at the end
const anchoredCCRegex = new RegExp(`^(?:${coreCCPattern})$`)
// The Unanchored version is essentially the core pattern, usable as is for partial matches
const unanchoredCCRegex = new RegExp(coreCCPattern)

// Define the core pattern for matching SSNs with optional dashes
const coreSSNPattern = `\\d{3}-?\\d{2}-?\\d{4}`
// Create the Anchored version of the regex by adding '^' at the start and '$' at the end
const anchoredSSNRegex = new RegExp(`^(${coreSSNPattern})$`)
// The Unanchored version is essentially the core pattern itself, usable for partial matches
const unanchoredSSNRegex = new RegExp(`(${coreSSNPattern})`)

/*
 * Check whether a string value should be "captured" or if it may contain sensitive data
 * using a variety of heuristics.
 * @param {string} value - string value to check
 * @param {boolean} anchorRegexes - whether to anchor the regexes to the start and end of the string
 * @returns {boolean} whether the element should be captured
 */
export function shouldCaptureValue(value: string, anchorRegexes = true): boolean {
    if (isNullish(value)) {
        return false
    }

    if (isString(value)) {
        value = trim(value)

        // check to see if input value looks like a credit card number
        // see: https://www.safaribooksonline.com/library/view/regular-expressions-cookbook/9781449327453/ch04s20.html
        const ccRegex = anchorRegexes ? anchoredCCRegex : unanchoredCCRegex
        if (ccRegex.test((value || '').replace(/[- ]/g, ''))) {
            return false
        }

        // check to see if input value looks like a social security number
        const ssnRegex = anchorRegexes ? anchoredSSNRegex : unanchoredSSNRegex
        if (ssnRegex.test(value)) {
            return false
        }
    }

    return true
}
