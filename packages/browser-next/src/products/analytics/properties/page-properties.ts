import type { UrlSanitizationOptions } from '../../../core/types'

/**
 * Shapes a page URL by the client's `urlSanitization`, as events, logs and web vitals record it. Returns undefined
 * when there is no URL or it can't be recorded, such as when `sanitize` fails.
 */
export const recordedUrl = (href: string | undefined, options: UrlSanitizationOptions): URL | undefined => {
    if (!href) return undefined
    try {
        // `String` turns a returned `URL` into its href and anything else into an invalid URL, which throws.
        const url = new URL(String(options.sanitize ? options.sanitize(new URL(href)) : href))
        url.username = url.password = ''
        if (options.path === false) {
            url.pathname = '/'
            // Opaque URLs such as `about:srcdoc` ignore the change, so omit them rather than record their path.
            if (url.pathname !== '/') return undefined
        }
        if (options.query === false) url.search = ''
        if (options.hash !== true) url.hash = ''
        return url
    } catch {
        return undefined
    }
}

/** The page context read at capture time: the sanitized URL on every event, and the title on `$pageview`. */
export const pageProperties = (event: string, options: UrlSanitizationOptions): Record<string, unknown> => {
    const properties: Record<string, unknown> = {}
    try {
        // A worker's `location` is its script URL, not a page.
        const url = recordedUrl(globalThis.window?.location?.href, options)
        if (url) {
            properties.$current_url = url.href
            properties.$host = url.host
            properties.$pathname = url.pathname
        }
        if (event === '$pageview') {
            const title = globalThis.document?.title
            if (typeof title === 'string') properties.title = title
        }
    } catch {
        // A page that can't be read leaves its properties off; the event is still captured.
    }
    return properties
}
