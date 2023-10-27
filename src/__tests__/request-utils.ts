import { _isUrlMatchingRegex } from '../request-utils'

describe('_isUrlMatchingRegex', () => {
    test.each([
        ['match query params', 'https://example.com?name=something', '(\\?|\\&)(name.*)\\=([^&]+)', true],
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
