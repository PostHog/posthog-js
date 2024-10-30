import { TOOLBAR_ID } from '../constants'

export function isElementInToolbar(el: Element): boolean {
    // NOTE: .closest is not supported in IE11 hence the operator check
    return el.id === TOOLBAR_ID || !!el.closest?.('#' + TOOLBAR_ID)
}
