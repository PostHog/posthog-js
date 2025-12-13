import { isUndefined } from '@posthog/core'
import { isElementNode } from './element-utils'

/**
 * Get the target element from an event, handling shadow DOM and legacy browsers.
 */
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

/**
 * Get the parent element of an element, or false if none exists.
 */
export function getParentElement(curEl: Element): Element | false {
    const parentNode = curEl.parentNode
    if (!parentNode || !isElementNode(parentNode)) return false
    return parentNode
}

/**
 * Elements that are compatible with autocapture click tracking.
 */
export const autocaptureCompatibleElements = ['a', 'button', 'form', 'input', 'select', 'textarea', 'label']
