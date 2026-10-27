import { isString } from '@posthog/core'
import type { UrlSanitizationOptions } from '@posthog/types'

/** Selects the URL components retained for capture. */
export interface UrlCaptureOptions {
    /** Retain the pathname. Defaults to true. */
    path?: boolean | undefined
    /** Retain query parameters. Defaults to false. */
    search?: boolean | undefined
    /** Retain the fragment. Defaults to false. */
    hash?: boolean | undefined
    sanitize?: UrlSanitizationOptions['sanitize']
}

/** Shape an absolute URL for capture without modifying the input. Invalid URLs are omitted. */
export function sanitizeUrl(url: URL | string, options: UrlCaptureOptions, baseUrl?: string): string | undefined {
    try {
        // Missing URL support is handled by the catch below: omit the URL rather than capture it unsanitized.
        // oxlint-disable-next-line compat/compat
        let result = new URL(String(url), baseUrl)
        if (options.sanitize) {
            const sanitized = options.sanitize(result)
            // Do not coerce arbitrary objects (or promises) into URLs.
            if (!isString(sanitized) && !(sanitized instanceof URL)) return undefined
            // Callback string results must be absolute URLs, not relative to the original document.
            result = new URL(String(sanitized))
        }
        result.username = ''
        result.password = ''
        if (options.path === false) {
            result.pathname = '/'
            // Opaque URLs can silently ignore pathname changes.
            if (result.pathname !== '/') return undefined
        }
        if (!options.search) result.search = ''
        if (!options.hash) result.hash = ''
        return result.toString()
    } catch {
        return undefined
    }
}
