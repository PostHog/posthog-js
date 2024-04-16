import { getQueryParam, formDataToQuery, isUrlMatchingRegex } from '../utils/request-utils'

describe('request utils', () => {
    describe('_HTTPBuildQuery', () => {
        const exampleFormData = new FormData()
        exampleFormData.append('x', 'y')
        exampleFormData.append('a', 'b')
        exampleFormData.append('undefined', 'c')
        exampleFormData.append('undefined', undefined)
        test.each([
            ['builds query string', { x: 'y', a: 'b' }, 'x=y&a=b'],
            ['skips undefined values', { x: 'y', a: undefined }, 'x=y'],
            ['skips undefined keys', { x: 'y', a: 'b', undefined: 'c' }, 'x=y&a=b'],
            ['handles empty form data', new FormData(), ''],
            ['handles form data', exampleFormData, 'x=y&a=b'],
        ])('%s', (_name, formData, expected) => {
            expect(formDataToQuery(formData)).toEqual(expected)
        })
    })

    describe('getQueryParam', () => {
        test.each([
            ['gets query param', '?name=something', 'name', 'something'],
            [
                'gets first query param when multiple matches',
                '?name=something&name=another&name=third',
                'name',
                'something',
            ],
            ['gets query param where there is no key in the URL', '?=something', 'name', ''],
            ['gets query param where there is no value in the URL', '?name=', 'name', ''],
            ['gets query param where there is no value or = in the URL', '?name', 'name', ''],
            ['ignores params after the hash', '?name=something#hash?invalid=here', 'invalid', ''],
            ['ignores params after the hash even with no valid query params', '#hash?invalid=here', 'invalid', ''],
            ['decodes query param spaces', '?name=something%20encoded', 'name', 'something encoded'],
            ['decodes query param ampersand', '?name=something%26encoded', 'name', 'something&encoded'],
            ['decodes query param with +', '?name=something+encoded', 'name', 'something encoded'],
            ['ignores invalid encoding', '?name=something%2Gencoded', 'name', 'something%2Gencoded'],
            ['gets query param with trailing slash', '/?name=something', 'name', 'something'],
            ['gets first query param with multiple params', '/?name=something&test=123', 'name', 'something'],
            ['gets second query param with multiple params', '/?name=something&test=123', 'test', '123'],
            ['gets param when no match', '', 'name', ''],
            ['gets param when no match with trailing slash', '/', 'name', ''],
            ['gets param when no match and there are params', '/?test=123', 'name', ''],
            ['gets param when no match and there are params with trailing slash', '/?test=123', 'name', ''],
        ])('%s', (_name, url, param, expected) => {
            expect(getQueryParam(`https://example.com${url}`, param)).toEqual(expected)
        })
    })

    describe('isUrlMatchingRegex', () => {
        test.each([
            ['match query params', 'https://example.com?name=something', '(\\?|\\&)(name.*)\\=([^&]+)', true],
            [
                'match query params with trailing slash',
                'https://example.com/?name=something',
                '(\\?|\\&)(name.*)\\=([^&]+)',
                true,
            ],
            ['match subdomain wildcard', 'https://app.example.com', '(.*.)?example.com', true],
            ['match route wildcard', 'https://example.com/something/test', 'example.com/(.*.)/test', true],
            ['match domain', 'https://example.com', 'example.com', true],
            ['match domain with protocol', 'https://example.com', 'https://example.com', true],
            ['match domain with protocol and wildcard', 'https://example.com', 'https://(.*.)?example.com', true],
            ['does not match query params', 'https://example.com', '(\\?|\\&)(name.*)\\=([^&]+)', false],
            ['does not match route', 'https://example.com', 'example.com/test', false],
            ['does not match domain', 'https://example.com', 'anotherone.com', false],
        ])('%s', (_name, url, regex, expected) => {
            expect(isUrlMatchingRegex(url, regex)).toEqual(expected)
        })
    })
})
