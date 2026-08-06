import {
    _getHashParam,
    formDataToQuery,
    getQueryParam,
    jsonStringify,
    maskQueryParams,
} from '../../src/utils/request-utils'

describe('request utils', () => {
    describe('jsonStringify', () => {
        it('serializes bigint values as strings', () => {
            expect(jsonStringify({ count: BigInt(42) })).toBe('{"count":"42"}')
        })

        it('falls back to circular-safe serialization', () => {
            const value: Record<string, any> = { name: 'root' }
            value.self = value

            expect(jsonStringify(value)).toBe('{"name":"root","self":"[Circular]"}')
        })
    })

    describe('formDataToQuery', () => {
        it('builds a query string from an object', () => {
            expect(formDataToQuery({ x: 'y', a: 'b' })).toBe('x=y&a=b')
        })

        it('skips undefined values and undefined keys', () => {
            expect(formDataToQuery({ x: 'y', a: undefined, undefined: 'c' })).toBe('x=y')
        })

        it('handles FormData', () => {
            const formData = new FormData()
            formData.append('x', 'y')
            formData.append('a', 'b')

            expect(formDataToQuery(formData)).toBe('x=y&a=b')
        })
    })

    describe('getQueryParam', () => {
        it('gets and decodes a query param', () => {
            expect(getQueryParam('https://example.com/?q=hello%20world&x=y', 'q')).toBe('hello world')
        })

        it('handles plus as spaces and ignores hash params', () => {
            expect(getQueryParam('https://example.com/?q=hello+world#q=ignored', 'q')).toBe('hello world')
        })

        it('returns empty string for missing params', () => {
            expect(getQueryParam('https://example.com/?x=y', 'q')).toBe('')
        })
    })

    describe('maskQueryParams', () => {
        it('masks selected query params while preserving order and hash', () => {
            expect(
                maskQueryParams('https://example.com/?token=secret&x=y&token=again#section', ['token'], '<redacted>')
            ).toBe('https://example.com/?token=<redacted>&x=y&token=<redacted>#section')
        })

        it('returns the original value when there is nothing to mask', () => {
            expect(maskQueryParams('https://example.com/?token=secret', [], '<redacted>')).toBe(
                'https://example.com/?token=secret'
            )
            expect(maskQueryParams(undefined, ['token'], '<redacted>')).toBeUndefined()
        })
    })

    describe('_getHashParam', () => {
        it('extracts hash params', () => {
            expect(_getHashParam('#access_token=abc&state=xyz', 'access_token')).toBe('abc')
        })
    })
})
