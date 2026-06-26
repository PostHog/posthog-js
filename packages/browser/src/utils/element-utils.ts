import { TOOLBAR_CONTAINER_CLASS, TOOLBAR_ID } from '../constants'

export { isElementNode, isTag, isTextNode, isShadowRoot } from '@posthog/browser-common/utils/element-utils'

export function isElementInToolbar(el: EventTarget | null): boolean {
    if (el instanceof Element) {
        // closest isn't available in IE11, but we'll polyfill when bundling
        return el.id === TOOLBAR_ID || !!el.closest?.('.' + TOOLBAR_CONTAINER_CLASS)
    }
    return false
}
