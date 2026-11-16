import { isUndefined } from '@posthog/core'

/**
 * IE11 doesn't support `new URL`
 * so we can create an anchor element and use that to parse the URL
 * there's a lot of overlap between HTMLHyperlinkElementUtils and URL
 * meaning useful properties like `pathname` are available on both
 */
export const convertToURL = (url: string): HTMLAnchorElement | null => {
    const doc = typeof document === 'undefined' ? undefined : document
    const location = doc?.createElement('a')
    if (isUndefined(location)) {
        return null
    }

    location.href = url
    return location
}
