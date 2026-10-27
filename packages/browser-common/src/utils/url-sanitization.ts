import type { PostHogConfig } from '@posthog/types'
import { stripUrlHash } from '@posthog/core'
import { document, location } from './globals'
import { maskQueryParams } from './request-utils'
import { sanitizeUrl } from './sanitize-url'

// The list of campaign parameters that could be considered personal data under e.g. GDPR.
// These can be masked in URLs and properties before being sent to posthog.
export const PERSONAL_DATA_CAMPAIGN_PARAMS = [
    'gclid', // google ads
    'gclsrc', // google ads 360
    'dclid', // google display ads
    'gbraid', // google ads, web to app
    'wbraid', // google ads, app to web
    'fbclid', // facebook
    'msclkid', // microsoft
    'twclid', // twitter
    'li_fat_id', // linkedin
    'igshid', // instagram
    'ttclid', // tiktok
    'rdt_cid', // reddit
    'epik', // pinterest
    'qclid', // quora
    'sccid', // snapchat
    'oppref', // openai ads
    'bfcid', // freebuff
    'irclid', // impact
    '_kx', // klaviyo
]

export const MASKED = '<masked>'

type UrlConfigFields = Pick<
    PostHogConfig,
    | 'url_sanitization'
    | 'disable_capture_url_hashes'
    | 'mask_personal_data_properties'
    | 'custom_personal_data_properties'
>

export type RecordedUrlConfig = { [K in keyof UrlConfigFields]?: UrlConfigFields[K] | undefined }

/**
 * The common boundary for SDK-recorded URL metadata.
 * Legacy behavior is selected by each producer; opting in applies one policy across producers.
 */
export function getRecordedUrl(
    url: string | undefined,
    config: RecordedUrlConfig,
    legacy: { stripHash?: boolean; maskQuery?: boolean } = {}
): string | undefined {
    if (!url) return url
    const options = config.url_sanitization
    let result = url
    if (options) {
        const sanitized = sanitizeUrl(
            url,
            {
                path: options.path,
                search: options.query ?? true,
                hash: options.hash ?? !config.disable_capture_url_hashes,
                sanitize: options.sanitize,
            },
            document?.baseURI || location?.href
        )
        if (!sanitized) return undefined
        result = sanitized
    } else if (legacy.stripHash ?? config.disable_capture_url_hashes) {
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
