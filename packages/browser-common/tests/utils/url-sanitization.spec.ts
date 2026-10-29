/* oxlint-disable compat/compat -- Tests run in Node with native URL and Promise support. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getRecordedUrl } from '../../src/utils/url-sanitization'
import * as globals from '../../src/utils/globals'
import type { UrlSanitizationOptions } from '@posthog/types'

const url = 'https://example.com/private?token=secret&gclid=ad#section'

describe('recorded URL policy', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it('resolves relative URLs against the document base, falling back to the page URL', () => {
        const page = 'https://example.com/pages/start'
        const document = vi.spyOn(globals, 'document', 'get')
        vi.spyOn(globals, 'location', 'get').mockReturnValue(new URL(page) as unknown as Location)
        document.mockReturnValue({ baseURI: 'https://cdn.example.com/assets/' } as Document)
        expect(getRecordedUrl('next?token=secret', { url_sanitization: { query: false } })).toBe(
            'https://cdn.example.com/assets/next'
        )
        document.mockReturnValue(undefined)
        expect(getRecordedUrl('next?token=secret', { url_sanitization: { query: false } })).toBe(
            'https://example.com/pages/next'
        )
    })

    it.each([undefined, ''])('preserves an empty URL (%s) without calling the sanitizer', (url) => {
        const sanitize = vi.fn()
        expect(getRecordedUrl(url, { url_sanitization: { sanitize } })).toBe(url)
        expect(sanitize).not.toHaveBeenCalled()
    })

    it('preserves legacy URL bytes and producer-specific masking', () => {
        const unusual = 'https://EXAMPLE.com:443/path?x=%2b#part'
        expect(getRecordedUrl(unusual, {})).toBe(unusual)
        expect(getRecordedUrl(url, { disable_capture_url_hashes: true })).toBe(url.split('#')[0])
        expect(getRecordedUrl(url, { disable_capture_url_hashes: true }, { stripHash: false })).toBe(url)
        expect(getRecordedUrl(url, { mask_personal_data_properties: true }, { maskQuery: true })).toBe(
            'https://example.com/private?token=secret&gclid=<masked>#section'
        )
    })

    it('retains path and query by default and inherits the legacy hash setting', () => {
        expect(getRecordedUrl(url, { url_sanitization: {} })).toBe(url)
        expect(getRecordedUrl(url, { url_sanitization: {}, disable_capture_url_hashes: true })).toBe(url.split('#')[0])
    })

    for (const path of [true, false]) {
        for (const query of [true, false]) {
            for (const hash of [true, false]) {
                it(`selects path=${path}, query=${query}, hash=${hash}`, () => {
                    expect(getRecordedUrl(url, { url_sanitization: { path, query, hash } })).toBe(
                        'https://example.com/' +
                            (path ? 'private' : '') +
                            (query ? '?token=secret&gclid=ad' : '') +
                            (hash ? '#section' : '')
                    )
                })
            }
        }
    }

    it('explicitly retaining hashes overrides legacy stripping', () => {
        expect(getRecordedUrl(url, { disable_capture_url_hashes: true, url_sanitization: { hash: true } })).toBe(url)
    })

    it.each(['url', 'string'])('runs a %s-returning callback before component and query masking', (resultType) => {
        const original = new URL(url)
        const sanitize = vi.fn((value: URL) => {
            expect(value.href).toBe(url)
            value.pathname = '/public'
            value.searchParams.set('token', 'rewritten')
            value.hash = 'restored'
            return resultType === 'url' ? value : value.href
        })
        expect(
            getRecordedUrl(original.href, {
                url_sanitization: { sanitize, hash: false },
                mask_personal_data_properties: true,
                custom_personal_data_properties: ['token'],
            })
        ).toBe('https://example.com/public?token=<masked>&gclid=<masked>')
        expect(original.href).toBe(url)
        expect(sanitize).toHaveBeenCalledTimes(1)
    })

    it.each([null, undefined, 42, {}, '', '/relative', 'not a URL', Promise.resolve(url)])(
        'omits invalid callback result %s',
        (result) => {
            expect(
                getRecordedUrl(url, {
                    url_sanitization: { sanitize: (() => result) as UrlSanitizationOptions['sanitize'] },
                })
            ).toBeUndefined()
        }
    )

    it('omits a URL when its callback throws or URL support is unavailable', () => {
        expect(
            getRecordedUrl(url, {
                url_sanitization: {
                    sanitize: () => {
                        throw new Error('failure')
                    },
                },
            })
        ).toBeUndefined()
        vi.stubGlobal('URL', undefined)
        expect(getRecordedUrl(url, { url_sanitization: {} })).toBeUndefined()
        expect(getRecordedUrl(url, {})).toBe(url)
    })
})
