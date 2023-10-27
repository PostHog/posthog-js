import { _each, _isValidRegex, logger } from './utils'

import { _isNull, _isString, _isUndefined } from './type-utils'

const localDomains = ['localhost', '127.0.0.1']

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
    // Expects a raw URL

    const cleanParam = param.replace(/[[]/, '\\[').replace(/[\]]/, '\\]')
    const regexS = '[\\?&]' + cleanParam + '=([^&#]*)'
    const regex = new RegExp(regexS)
    const results = regex.exec(url)
    if (_isNull(results) || (results && !_isString(results[1]) && (results[1] as any).length)) {
        return ''
    } else {
        let result = results[1]
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
