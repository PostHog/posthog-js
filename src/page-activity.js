/**
 *
 * The Page Visibility API provides events you can watch for to know when a document becomes visible or hidden,
 * as well as features to look at the current visibility state of the page.
 *
 * When the user minimizes the window or switches to another tab, the API sends a visibilitychange event
 * to let listeners know the state of the page has changed.
 *
 * see https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
 *
 * @param callback when page visibility changes this is called with true if the page is visible and false otherwise
 */
export function onPageVisibility(callback) {
    // adapted from https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API#example
    // Opera 12.10 and Firefox 18 and later support
    let hidden = 'hidden'
    let visibilityChange = 'visibilitychange'
    if (typeof document.msHidden !== 'undefined') {
        hidden = 'msHidden'
        visibilityChange = 'msvisibilitychange'
    } else if (typeof document.webkitHidden !== 'undefined') {
        hidden = 'webkitHidden'
        visibilityChange = 'webkitvisibilitychange'
    }

    const onVisibilityChange = () => {
        callback(!document[hidden])
    }

    document.addEventListener(visibilityChange, onVisibilityChange)

    return function cleanUp() {
        document.removeEventListener(visibilityChange, onVisibilityChange)
    }
}
