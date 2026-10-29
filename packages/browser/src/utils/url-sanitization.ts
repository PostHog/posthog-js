import type { PostHogConfig, UrlSanitizationOptions } from '../types'
import { isString, stripUrlHash } from '@posthog/core'
import { document, location } from '@posthog/browser-common/utils/globals'
import { maskQueryParams } from '@posthog/browser-common/utils/request-utils'
import { PERSONAL_DATA_CAMPAIGN_PARAMS, MASKED } from '@posthog/browser-common/utils/event-utils'
import { sanitizeUrl as filterUrlComponents } from '@posthog/browser-common/utils/sanitize-url'

type UrlConfigFields = Pick<
    PostHogConfig,
    | 'url_sanitization'
    | 'disable_capture_url_hashes'
    | 'mask_personal_data_properties'
    | 'custom_personal_data_properties'
>

type RecordedUrlConfig = { [K in keyof UrlConfigFields]?: UrlConfigFields[K] | undefined }

function sanitizeUrl(url: string, options: UrlSanitizationOptions): string | undefined {
    try {
        // oxlint-disable-next-line compat/compat
        const parsed = new URL(url, document?.baseURI || location?.href)
        const result = options.sanitize ? options.sanitize(parsed) : parsed
        // Reject invalid callback values without coercing objects or promises to strings.
        if (!isString(result) && !(result instanceof URL)) return undefined
        return filterUrlComponents(result, {
            path: options.path ?? true,
            search: options.query ?? true,
            hash: options.hash ?? true,
        })
    } catch {
        return undefined
    }
}

/** Apply the browser SDK's configured policy, preserving each producer's legacy defaults. */
export function getRecordedUrl(
    url: string | undefined,
    config: RecordedUrlConfig,
    legacy: { maskQuery?: boolean } = {}
): string | undefined {
    if (!url) return url
    const options = config.url_sanitization
    let result = url
    if (options) {
        const sanitized = sanitizeUrl(url, {
            ...options,
            hash: options.hash ?? !config.disable_capture_url_hashes,
        })
        if (!sanitized) return undefined
        result = sanitized
    } else if (config.disable_capture_url_hashes) {
        result = stripUrlHash(result)
    }

    if ((options || legacy.maskQuery) && config.mask_personal_data_properties) {
        result = maskQueryParams(
            result,
            [...PERSONAL_DATA_CAMPAIGN_PARAMS, ...(config.custom_personal_data_properties || [])],
            MASKED
        )
    }
    return result
}

/** Pass an optional URL transformer to shared producers without exposing SDK configuration. */
export function getUrlSanitizer(config: RecordedUrlConfig): ((url: string) => string | undefined) | undefined {
    return config.url_sanitization ? (url) => getRecordedUrl(url, config) : undefined
}
