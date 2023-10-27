import { _HTTPBuildQuery, _isUrlMatchingRegex } from '../utils/request-utils'

describe('request utils', () => {
    describe('_HTTPBuildQuery', () => {
        test.each([
            ['builds query string', { x: 'y', a: 'b' }, 'x=y&a=b'],
            ['skips undefined values', { x: 'y', a: undefined }, 'x=y'],
            ['skips undefined keys', { x: 'y', a: 'b', undefined: 'c' }, 'x=y&a=b'],
        ])('%s', (_name, formData, expected) => {
            expect(_HTTPBuildQuery(formData)).toEqual(expected)
        })
    })
    describe('_isUrlMatchingRegex', () => {
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
            expect(_isUrlMatchingRegex(url, regex)).toEqual(expected)
        })
    })
})
