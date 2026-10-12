/* oxlint-disable compat/compat -- Tests run in Node with native URL support. */
import { describe, expect, it, vi } from 'vitest'
import { sanitizeUrl } from '../../src/utils/sanitize-url'

const href = 'https://example.com:8080/app/checkout?email=test%40example.com#details'

describe('sanitizeUrl', () => {
    it('defaults to retaining the origin and path', () => {
        expect(sanitizeUrl(href, {})).toBe('https://example.com:8080/app/checkout')
    })

    for (const path of [false, true]) {
        for (const search of [false, true]) {
            for (const hash of [false, true]) {
                it(`selects path=${path}, search=${search}, hash=${hash}`, () => {
                    const input = new URL(href)
                    const expected = `https://example.com:8080${path ? '/app/checkout' : '/'}${search ? '?email=test%40example.com' : ''}${hash ? '#details' : ''}`
                    expect(sanitizeUrl(href, { path, search, hash })).toBe(expected)
                    expect(sanitizeUrl(input, { path, search, hash })).toBe(expected)
                    expect(input.href).toBe(href)
                })
            }
        }
    }

    it('removes embedded credentials without modifying the input URL', () => {
        const input = new URL('https://user:password@example.com/path?query=value#fragment')
        expect(sanitizeUrl(input, { path: true, search: true, hash: true })).toBe(
            'https://example.com/path?query=value#fragment'
        )
        expect(sanitizeUrl(input.href, {})).toBe('https://example.com/path')
        expect(input.username).toBe('user')
        expect(input.password).toBe('password')
    })

    it('uses defaults for omitted fields', () => {
        expect(sanitizeUrl(href, { hash: true })).toBe('https://example.com:8080/app/checkout#details')
    })

    it.each(['', '/relative', 'not a URL', 'https://'])('omits invalid input %j', (input) => {
        expect(sanitizeUrl(input, {})).toBeUndefined()
    })

    it.each(['data:text/plain,secret', 'blob:https://example.test/id', 'about:blank'])(
        'omits URLs whose path cannot be removed: %s',
        (input) => {
            expect(sanitizeUrl(input, { path: false })).toBeUndefined()
        }
    )

    it('omits URLs when native URL support is unavailable', () => {
        vi.stubGlobal('URL', undefined)
        try {
            expect(sanitizeUrl(href, {})).toBeUndefined()
        } finally {
            vi.unstubAllGlobals()
        }
    })

    it('contains string conversion failures', () => {
        const input = new URL(href)
        input.toString = () => {
            throw new Error('unavailable')
        }
        expect(sanitizeUrl(input, {})).toBeUndefined()
    })
})
