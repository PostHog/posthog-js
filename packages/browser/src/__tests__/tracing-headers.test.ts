import { COOKIELESS_SENTINEL_VALUE } from '../constants'
import patchFns from '../entrypoints/tracing-headers'

class TestHeaders {
    private _headers: Record<string, string> = {}

    set(name: string, value: string): void {
        this._headers[name.toLowerCase()] = value
    }

    get(name: string): string | null {
        return this._headers[name.toLowerCase()] ?? null
    }
}

class TestRequest {
    url: string
    headers = new TestHeaders()

    constructor(url: string | URL) {
        this.url = url.toString()
    }
}

describe('tracing headers', () => {
    const originalRequest = globalThis.Request
    let restoreXHRPatch: (() => void) | undefined

    beforeAll(() => {
        const globalAny = globalThis as any
        globalAny.Request = TestRequest
    })

    afterAll(() => {
        const globalAny = globalThis as any
        globalAny.Request = originalRequest
    })

    afterEach(() => {
        restoreXHRPatch?.()
        restoreXHRPatch = undefined
        jest.restoreAllMocks()
    })

    const sessionManager = {
        checkAndGetSessionAndWindowId: jest.fn(() => ({ sessionId: 'session-id', windowId: 'window-id' })),
    }

    test.each([
        {
            name: 'adds tracing headers to matching XHR requests',
            url: 'https://example.com/path',
            distinctId: 'distinct-id',
            expectedHeaders: [
                ['X-POSTHOG-SESSION-ID', 'session-id'],
                ['X-POSTHOG-WINDOW-ID', 'window-id'],
                ['X-POSTHOG-DISTINCT-ID', 'distinct-id'],
            ],
            absentHeaders: [],
        },
        {
            name: 'does not add tracing headers to non-matching XHR requests',
            url: 'https://other.example/path',
            distinctId: 'distinct-id',
            expectedHeaders: [],
            absentHeaders: [
                ['X-POSTHOG-SESSION-ID', 'session-id'],
                ['X-POSTHOG-WINDOW-ID', 'window-id'],
                ['X-POSTHOG-DISTINCT-ID', 'distinct-id'],
            ],
        },
        {
            name: 'does not add the distinct ID header to XHR requests when cookieless mode is active',
            url: 'https://example.com/path',
            distinctId: COOKIELESS_SENTINEL_VALUE,
            expectedHeaders: [
                ['X-POSTHOG-SESSION-ID', 'session-id'],
                ['X-POSTHOG-WINDOW-ID', 'window-id'],
            ],
            absentHeaders: [['X-POSTHOG-DISTINCT-ID', 'distinct-id']],
        },
    ])('$name', ({ url, distinctId, expectedHeaders, absentHeaders }) => {
        const setRequestHeaderSpy = jest
            .spyOn(XMLHttpRequest.prototype, 'setRequestHeader')
            .mockImplementation(() => {})
        restoreXHRPatch = patchFns._patchXHR(['example.com'], distinctId, sessionManager as any)

        const xhr = new XMLHttpRequest()
        xhr.open('GET', url)

        expectedHeaders.forEach(([header, value]) => {
            expect(setRequestHeaderSpy).toHaveBeenCalledWith(header, value)
        })
        absentHeaders.forEach(([header, value]) => {
            expect(setRequestHeaderSpy).not.toHaveBeenCalledWith(header, value)
        })
    })

    describe('fetch error propagation', () => {
        let restoreFetchPatch: (() => void) | undefined
        const originalFetch = (globalThis as any).fetch

        afterEach(() => {
            restoreFetchPatch?.()
            restoreFetchPatch = undefined
            ;(globalThis as any).fetch = originalFetch
        })

        it('forwards the original rejection verbatim when the underlying fetch rejects', async () => {
            const networkError = new TypeError('Failed to fetch')
            ;(globalThis as any).fetch = jest.fn(() => Promise.reject(networkError))

            restoreFetchPatch = patchFns._patchFetch(['example.com'], 'distinct-id', sessionManager as any)

            await expect((globalThis as any).fetch('https://example.com/path')).rejects.toBe(networkError)
        })

        it('still returns the response when the underlying fetch resolves', async () => {
            const response = { ok: true } as Response
            ;(globalThis as any).fetch = jest.fn(() => Promise.resolve(response))

            restoreFetchPatch = patchFns._patchFetch(['example.com'], 'distinct-id', sessionManager as any)

            await expect((globalThis as any).fetch('https://example.com/path')).resolves.toBe(response)
        })
    })
})
