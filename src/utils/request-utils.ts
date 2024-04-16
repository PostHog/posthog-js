import { each, isValidRegex } from './'

import { isArray, isFile, isUndefined } from './type-utils'
import { logger } from './logger'
import { document } from './globals'

const localDomains = ['localhost', '127.0.0.1']

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

export const isUrlMatchingRegex = function (url: string, pattern: string): boolean {
    if (!isValidRegex(pattern)) return false
    return new RegExp(pattern).test(url)
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
    const queryParams: string = withoutHash.split('?')[1] || ''

    const queryParts = queryParams.split('&')
    let keyValuePair

    for (let i = 0; i < queryParts.length; i++) {
        const parts = queryParts[i].split('=')
        if (parts[0] === param) {
            keyValuePair = parts
            break
        }
    }

    if (!isArray(keyValuePair) || keyValuePair.length < 2) {
        return ''
    } else {
        let result = keyValuePair[1]
        try {
            result = decodeURIComponent(result)
        } catch (err) {
            logger.error('Skipping decoding for malformed query param: ' + result)
        }
        return result.replace(/\+/g, ' ')
    }
}

export const _getHashParam = function (hash: string, param: string): string | null {
    const matches = hash.match(new RegExp(param + '=([^&]*)'))
    return matches ? matches[1] : null
}

export const isLocalhost = (): boolean => {
    return localDomains.includes(location.hostname)
}
