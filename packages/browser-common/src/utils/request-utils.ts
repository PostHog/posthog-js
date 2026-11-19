import { isArray, isError, isFile, isUndefined, safeJsonStringify } from '@posthog/core'

import { each, errorToProperties } from './general-utils'
import { location } from './globals'
import { logger } from './logger'

const localDomains = ['localhost', '127.0.0.1']

export const jsonStringify = (data: any, space?: string | number): string => {
    try {
        let errors: WeakMap<Error, Record<string, unknown>> | undefined
        return JSON.stringify(
            data,
            (_, value) => {
                // Native JSON.stringify invokes toJSON before this replacer, so custom serializers win.
                if (isError(value)) {
                    errors ??= new WeakMap()
                    if (!errors.has(value)) {
                        errors.set(value, errorToProperties(value))
                    }
                    // Reuse copies so circular Errors reach the existing fallback instead of
                    // creating a fresh object on every visit and overflowing the stack.
                    return errors.get(value)
                }
                // Plain JSON.stringify throws on BigInts. See issue #1440.
                return typeof value === 'bigint' ? value.toString() : value
            },
            space
        )
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

export { convertToURL } from './convert-to-url'
export { maskQueryParams } from './url-masking'

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
        // Split only on the first = so values that contain = (e.g. base64) are kept whole
        const parts = queryParts[i]!.split(/=(.*)/)
        if (parts[0] === param) {
            keyValuePair = parts
            break
        }
    }

    if (!isArray(keyValuePair) || keyValuePair.length < 2) {
        return ''
    } else {
        // Replace + with a space before decoding, so an encoded plus (%2B) stays a +
        let result = keyValuePair[1]!.replace(/\+/g, ' ')
        try {
            result = decodeURIComponent(result)
        } catch {
            logger.error('Skipping decoding for malformed query param: ' + result)
        }
        return result
    }
}

export const _getHashParam = function (hash: string, param: string): string | null {
    const matches = hash.match(new RegExp(param + '=([^&]*)'))
    return matches ? matches[1]! : null
}

export const isLocalhost = (): boolean => {
    return localDomains.includes(location!.hostname)
}

export { isStatusZeroFailureCircuitBreakerTripped, updateStatusZeroFailureCount } from './request-reachability'
