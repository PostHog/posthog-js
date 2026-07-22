import { isArray, isFile, isUndefined, safeJsonStringify } from '@posthog/core'

import { each } from './general-utils'
import { document, isBrowserOnline, location } from './globals'
import { logger } from './logger'

const localDomains = ['localhost', '127.0.0.1']

export const jsonStringify = (data: any, space?: string | number): string => {
    try {
        // Fast path: convert BigInts to strings, since plain JSON.stringify throws on them.
        // See https://github.com/PostHog/posthog-js/issues/1440.
        return JSON.stringify(data, (_, value) => (typeof value === 'bigint' ? value.toString() : value), space)
    } catch {
        // A self-referential value — most commonly a DOM node that retains a React fiber pointing back
        // at the element — makes JSON.stringify throw "Converting circular structure to JSON". With
        // exception autocapture enabled that throw was recaptured as a new $exception, sometimes in a
        // tight loop. Fall back to the shared circular-safe serializer (which also handles BigInt and
        // Errors); it replaces only true cycles with "[Circular]", leaving shared-but-acyclic
        // references intact. `space` formatting is dropped on this rare path.
        return safeJsonStringify(data)
    }
}

/**
 * IE11 doesn't support `new URL`
 * so we can create an anchor element and use that to parse the URL
 * there's a lot of overlap between HTMLHyperlinkElementUtils and URL
 * meaning useful properties like `pathname` are available on both
 */
export const convertToURL = (url: string): HTMLAnchorElement | null => {
    const location = document?.createElement('a')
    if (isUndefined(location)) {
        return null
    }

    location.href = url
    return location
}

export const formDataToQuery = function (formdata: Record<string, any> | FormData, arg_separator = '&'): string {
    let use_val: string
    let use_key: string
    const tph_arr: string[] = []

    each(formdata, function (val: File | string | undefined, key: string | undefined) {
        // the key might be literally the string undefined for e.g. if {undefined: 'something'}
        if (isUndefined(val) || isUndefined(key) || key === 'undefined') {
            return
        }

        use_val = encodeURIComponent(isFile(val) ? val.name : val.toString())
        use_key = encodeURIComponent(key)
        tph_arr[tph_arr.length] = use_key + '=' + use_val
    })

    return tph_arr.join(arg_separator)
}

export const getQueryParam = function (url: string, param: string): string {
    const withoutHash: string = url.split('#')[0] || ''

    // Split only on the first ? to sort problem out for those with multiple ?s
    // and then remove them
    const queryParams: string = withoutHash.split(/\?(.*)/)[1] || ''
    const cleanedQueryParams = queryParams.replace(/^\?+/g, '')

    const queryParts = cleanedQueryParams.split('&')
    let keyValuePair

    for (let i = 0; i < queryParts.length; i++) {
        const parts = queryParts[i]!.split('=')
        if (parts[0] === param) {
            keyValuePair = parts
            break
        }
    }

    if (!isArray(keyValuePair) || keyValuePair.length < 2) {
        return ''
    } else {
        let result = keyValuePair[1]!
        try {
            result = decodeURIComponent(result)
        } catch {
            logger.error('Skipping decoding for malformed query param: ' + result)
        }
        return result.replace(/\+/g, ' ')
    }
}

// replace any query params in the url with the provided mask value. Tries to keep the URL as instant as possible,
// including preserving malformed text in most cases
export const maskQueryParams = function <T extends string | undefined>(
    url: T,
    maskedParams: string[] | undefined,
    mask: string
): T extends string ? string : undefined {
    if (!url || !maskedParams || !maskedParams.length) {
        return url as any
    }

    const splitHash = url.split('#')
    const withoutHash: string = splitHash[0] || ''
    const hash = splitHash[1]

    const splitQuery: string[] = withoutHash.split('?')
    const queryString: string = splitQuery[1]!
    const urlWithoutQueryAndHash: string = splitQuery[0]!
    const queryParts = (queryString || '').split('&')

    // use an array of strings rather than an object to preserve ordering and duplicates
    const paramStrings: string[] = []

    for (let i = 0; i < queryParts.length; i++) {
        const keyValuePair = queryParts[i]!.split('=')
        if (!isArray(keyValuePair)) {
            continue
        } else if (maskedParams.includes(keyValuePair[0]!)) {
            paramStrings.push(keyValuePair[0] + '=' + mask)
        } else {
            paramStrings.push(queryParts[i]!)
        }
    }

    let result = urlWithoutQueryAndHash
    if (queryString != null) {
        result += '?' + paramStrings.join('&')
    }
    if (hash != null) {
        result += '#' + hash
    }

    return result as any
}

export const _getHashParam = function (hash: string, param: string): string | null {
    const matches = hash.match(new RegExp(param + '=([^&]*)'))
    return matches ? matches[1]! : null
}

export const isLocalhost = (): boolean => {
    return localDomains.includes(location!.hostname)
}

export const isStatusZeroFailureCircuitBreakerTripped = (
    consecutiveStatusZeroFailures: number,
    maxConsecutiveStatusZeroFailures: number
): boolean => {
    return consecutiveStatusZeroFailures >= maxConsecutiveStatusZeroFailures && isBrowserOnline()
}

export const updateStatusZeroFailureCount = (
    statusCode: number,
    consecutiveStatusZeroFailures: number,
    maxConsecutiveStatusZeroFailures: number,
    onCircuitBreakerTripped: () => void
): number => {
    if (statusCode === 0) {
        if (isBrowserOnline()) {
            const updatedConsecutiveStatusZeroFailures = consecutiveStatusZeroFailures + 1
            if (updatedConsecutiveStatusZeroFailures === maxConsecutiveStatusZeroFailures) {
                onCircuitBreakerTripped()
            }
            return updatedConsecutiveStatusZeroFailures
        }
        return consecutiveStatusZeroFailures
    }

    return 0
}
