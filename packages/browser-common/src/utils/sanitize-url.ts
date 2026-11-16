/** Selects the URL components retained for capture. */
export interface UrlCaptureOptions {
    /** Retain the pathname. Defaults to true. */
    path?: boolean
    /** Retain query parameters. Defaults to false. */
    search?: boolean
    /** Retain the fragment. Defaults to false. */
    hash?: boolean
}

/** Shape an absolute URL for capture without modifying the input. Invalid URLs are omitted. */
export function sanitizeUrl(url: URL | string, options: UrlCaptureOptions): string | undefined {
    try {
        // Missing URL support is handled by the catch below: omit the URL rather than capture it unsanitized.
        // oxlint-disable-next-line compat/compat
        const result = new URL(String(url))
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
