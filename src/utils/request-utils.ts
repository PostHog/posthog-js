import { _each, _isValidRegex } from './'

import { _isArray, _isFunction, _isUndefined } from './type-utils'
import { logger } from './logger'
import { document, fetch, XMLHttpRequest } from './globals'

const localDomains = ['localhost', '127.0.0.1']

export const SUPPORTS_XHR = !!(XMLHttpRequest && 'withCredentials' in new XMLHttpRequest())
// eslint-disable-next-line compat/compat
export const SUPPORTS_REQUEST = SUPPORTS_XHR || !!fetch

/**
 * IE11 doesn't support `new URL`
 * so we can create an anchor element and use that to parse the URL
 * there's a lot of overlap between HTMLHyperlinkElementUtils and URL
 * meaning useful properties like `pathname` are available on both
 */
export const convertToURL = (url: string): HTMLAnchorElement | null => {
    const location = document?.createElement('a')
    if (_isUndefined(location)) {
        return null
    }

    location.href = url
    return location
}

export const _isUrlMatchingRegex = function (url: string, pattern: string): boolean {
    if (!_isValidRegex(pattern)) return false
    return new RegExp(pattern).test(url)
}

export const _HTTPBuildQuery = function (formdata: Record<string, any>, arg_separator = '&'): string {
    let use_val: string
    let use_key: string
    const tph_arr: string[] = []

    _each(formdata, function (val, key) {
        // the key might be literally the string undefined for e.g. if {undefined: 'something'}
        if (_isUndefined(val) || _isUndefined(key) || key === 'undefined') {
            return
        }

        use_val = encodeURIComponent(val.toString())
        use_key = encodeURIComponent(key)
        tph_arr[tph_arr.length] = use_key + '=' + use_val
    })

    return tph_arr.join(arg_separator)
}

export const _getQueryParam = function (url: string, param: string): string {
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

    if (!_isArray(keyValuePair) || keyValuePair.length < 2) {
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
