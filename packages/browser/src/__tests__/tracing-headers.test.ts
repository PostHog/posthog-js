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

    it('adds tracing headers to matching XHR requests', () => {
        const setRequestHeaderSpy = jest
            .spyOn(XMLHttpRequest.prototype, 'setRequestHeader')
            .mockImplementation(() => {})
        restoreXHRPatch = patchFns._patchXHR(['example.com'], 'distinct-id', sessionManager as any)

        const xhr = new XMLHttpRequest()
        xhr.open('GET', 'https://example.com/path')

        expect(setRequestHeaderSpy).toHaveBeenCalledWith('X-POSTHOG-SESSION-ID', 'session-id')
        expect(setRequestHeaderSpy).toHaveBeenCalledWith('X-POSTHOG-WINDOW-ID', 'window-id')
        expect(setRequestHeaderSpy).toHaveBeenCalledWith('X-POSTHOG-DISTINCT-ID', 'distinct-id')
    })

    it('does not add tracing headers to non-matching XHR requests', () => {
        const setRequestHeaderSpy = jest
            .spyOn(XMLHttpRequest.prototype, 'setRequestHeader')
            .mockImplementation(() => {})
        restoreXHRPatch = patchFns._patchXHR(['example.com'], 'distinct-id', sessionManager as any)

        const xhr = new XMLHttpRequest()
        xhr.open('GET', 'https://other.example/path')

        expect(setRequestHeaderSpy).not.toHaveBeenCalled()
    })

    it('does not add the distinct ID header to XHR requests when cookieless mode is active', () => {
        const setRequestHeaderSpy = jest
            .spyOn(XMLHttpRequest.prototype, 'setRequestHeader')
            .mockImplementation(() => {})
        restoreXHRPatch = patchFns._patchXHR(['example.com'], COOKIELESS_SENTINEL_VALUE, sessionManager as any)

        const xhr = new XMLHttpRequest()
        xhr.open('GET', 'https://example.com/path')

        expect(setRequestHeaderSpy).toHaveBeenCalledWith('X-POSTHOG-SESSION-ID', 'session-id')
        expect(setRequestHeaderSpy).toHaveBeenCalledWith('X-POSTHOG-WINDOW-ID', 'window-id')
        expect(setRequestHeaderSpy).not.toHaveBeenCalledWith('X-POSTHOG-DISTINCT-ID', expect.anything())
    })
})
