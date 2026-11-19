import type { UrlSanitizationOptions } from '../../../core/types'

const pageUrl = (options: UrlSanitizationOptions): URL | undefined => {
    // A worker's `location` is its script URL, not a page.
    const href = globalThis.window?.location?.href
    if (!href) return undefined
    // `String` turns a returned `URL` into its href and anything else into an invalid URL, which throws.
    const url = new URL(String(options.sanitize ? options.sanitize(new URL(href)) : href))
    url.username = url.password = ''
    if (options.path === false) {
        url.pathname = '/'
        // Opaque URLs such as `about:srcdoc` ignore the change, so omit them rather than record their path.
        if (url.pathname !== '/') return undefined
    }
    if (options.query === false) url.search = ''
    if (options.hash === false) url.hash = ''
    return url
}

/** The page context read at capture time: the sanitized URL on every event, and the title on `$pageview`. */
export const pageProperties = (event: string, options: UrlSanitizationOptions): Record<string, unknown> => {
    const properties: Record<string, unknown> = {}
    try {
        if (event === '$pageview') {
            const title = globalThis.document?.title
            if (typeof title === 'string') properties.title = title
        }
        const url = pageUrl(options)
        if (url) {
            properties.$current_url = url.href
            properties.$host = url.host
            properties.$pathname = url.pathname
        }
    } catch {
        // A page that can't be read or a failing `sanitize` leaves the URL off; the event is still captured.
    }
    return properties
}
