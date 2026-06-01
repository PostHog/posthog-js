import { COOKIELESS_SENTINEL_VALUE } from '../constants'
import patchFns from '../entrypoints/tracing-headers'

class TestRequest {
    body?: BodyInit | null
    headers: Headers
    method: string
    url: string

    constructor(input: string | URL | TestRequest, init?: RequestInit) {
        const inputRequest = input instanceof TestRequest ? input : undefined
        this.url = inputRequest ? inputRequest.url : input.toString()
        this.headers = new Headers(init?.headers ?? inputRequest?.headers)
        this.method = init?.method ?? inputRequest?.method ?? 'GET'
        this.body = init?.body ?? inputRequest?.body ?? null
    }

    clone(): TestRequest {
        return new TestRequest(this)
    }

    text(): Promise<string> {
        return Promise.resolve(this.body?.toString() ?? '')
    }

    get [Symbol.toStringTag](): string {
        return 'Request'
    }
}

describe('tracing headers', () => {
    const originalRequest = globalThis.Request
    let restoreXHRPatch: (() => void) | undefined
    let restoreFetchPatch: (() => void) | undefined
    const originalWindowFetch = window.fetch

    const sessionManager = {
        checkAndGetSessionAndWindowId: jest.fn(() => ({ sessionId: 'session-id', windowId: 'window-id' })),
    }

    const setWindowFetch = (fetchImpl: typeof fetch | undefined): void => {
        Object.defineProperty(window, 'fetch', {
            configurable: true,
            value: fetchImpl,
            writable: true,
        })
    }

    beforeAll(() => {
        ;(globalThis as any).Request = TestRequest
    })

    afterAll(() => {
        ;(globalThis as any).Request = originalRequest
    })

    afterEach(() => {
        restoreXHRPatch?.()
        restoreXHRPatch = undefined
        restoreFetchPatch?.()
        restoreFetchPatch = undefined
        setWindowFetch(originalWindowFetch)
        jest.restoreAllMocks()
        sessionManager.checkAndGetSessionAndWindowId.mockClear()
    })

    describe('fetch', () => {
        it('adds tracing headers without spreading init or mutating caller headers', async () => {
            const originalFetch = jest.fn(() => Promise.resolve({} as Response)) as jest.MockedFunction<typeof fetch>
            setWindowFetch(originalFetch)
            restoreFetchPatch = patchFns._patchFetch(['example.com'], 'distinct-id', sessionManager as any)

            const callerHeaders = new Headers({ 'x-original': 'original-header-value' })
            const controller = new AbortController()
            const initPrototype = {}
            Object.defineProperty(initPrototype, 'method', { get: () => 'POST' })
            Object.defineProperty(initPrototype, 'body', { get: () => 'request-body' })
            Object.defineProperty(initPrototype, 'duplex', { get: () => 'half' })

            const init = Object.create(initPrototype)
            Object.defineProperty(init, 'headers', { configurable: true, value: callerHeaders })
            Object.defineProperty(init, 'credentials', { configurable: true, value: 'include' })
            Object.defineProperty(init, 'signal', { configurable: true, value: controller.signal })

            await window.fetch('https://example.com/path', init)

            expect(originalFetch).toHaveBeenCalledTimes(1)
            const [input, downstreamInit] = originalFetch.mock.calls[0]
            expect(input).toBe('https://example.com/path')
            expect(downstreamInit).not.toBe(init)
            expect((downstreamInit as RequestInit).method).toBe('POST')
            expect((downstreamInit as RequestInit).body).toBe('request-body')
            expect((downstreamInit as RequestInit).credentials).toBe('include')
            expect((downstreamInit as RequestInit).signal).toBe(controller.signal)
            expect((downstreamInit as RequestInit & { duplex?: string }).duplex).toBe('half')

            // Downstream wrappers that still spread init should retain the effective RequestInit fields.
            const spreadInit = { ...(downstreamInit as RequestInit & { duplex?: string }) }
            expect(spreadInit.method).toBe('POST')
            expect(spreadInit.body).toBe('request-body')
            expect(spreadInit.credentials).toBe('include')
            expect(spreadInit.signal).toBe(controller.signal)
            expect(spreadInit.duplex).toBe('half')

            const headers = new Headers(downstreamInit?.headers)
            expect(headers.get('x-original')).toBe('original-header-value')
            expect(headers.get('X-POSTHOG-SESSION-ID')).toBe('session-id')
            expect(headers.get('X-POSTHOG-WINDOW-ID')).toBe('window-id')
            expect(headers.get('X-POSTHOG-DISTINCT-ID')).toBe('distinct-id')
            expect(callerHeaders.get('X-POSTHOG-SESSION-ID')).toBeNull()
            expect(callerHeaders.get('X-POSTHOG-WINDOW-ID')).toBeNull()
            expect(callerHeaders.get('X-POSTHOG-DISTINCT-ID')).toBeNull()
        })

        it('delegates unchanged when the hostname does not match', async () => {
            const originalFetch = jest.fn(() => Promise.resolve({} as Response)) as jest.MockedFunction<typeof fetch>
            setWindowFetch(originalFetch)
            restoreFetchPatch = patchFns._patchFetch(['example.com'], 'distinct-id', sessionManager as any)

            const init = { method: 'POST', headers: { 'x-original': 'value' }, body: 'request-body' }
            await window.fetch('https://other.example/path', init)

            expect(originalFetch).toHaveBeenCalledWith('https://other.example/path', init)
            expect(sessionManager.checkAndGetSessionAndWindowId).not.toHaveBeenCalled()
        })

        it('preserves Request input semantics and init overrides', async () => {
            const originalFetch = jest.fn(() => Promise.resolve({} as Response)) as jest.MockedFunction<typeof fetch>
            setWindowFetch(originalFetch)
            restoreFetchPatch = patchFns._patchFetch(['example.com'], 'distinct-id', sessionManager as any)

            const request = new Request('https://example.com/path', {
                body: 'request-body',
                headers: { 'x-request': 'request-header' },
                method: 'POST',
            })
            await window.fetch(request, {
                body: 'override-body',
                headers: { 'x-init': 'init-header' },
                method: 'PUT',
            })

            expect(originalFetch).toHaveBeenCalledTimes(1)
            const [input, init] = originalFetch.mock.calls[0]
            expect(input).toBeInstanceOf(Request)
            expect(init).toBeUndefined()

            const downstreamRequest = input as Request
            expect(downstreamRequest).not.toBe(request)
            expect(downstreamRequest.method).toBe('PUT')
            expect(downstreamRequest.headers.get('x-request')).toBeNull()
            expect(downstreamRequest.headers.get('x-init')).toBe('init-header')
            expect(downstreamRequest.headers.get('X-POSTHOG-SESSION-ID')).toBe('session-id')
            expect(downstreamRequest.headers.get('X-POSTHOG-WINDOW-ID')).toBe('window-id')
            expect(downstreamRequest.headers.get('X-POSTHOG-DISTINCT-ID')).toBe('distinct-id')
            await expect(downstreamRequest.clone().text()).resolves.toBe('override-body')
        })

        it('propagates synchronous downstream fetch errors without retrying', () => {
            const error = new Error('sync fetch failure')
            const originalFetch = jest.fn(() => {
                throw error
            }) as jest.MockedFunction<typeof fetch>
            setWindowFetch(originalFetch)
            restoreFetchPatch = patchFns._patchFetch(['example.com'], 'distinct-id', sessionManager as any)

            expect(() => window.fetch('https://example.com/path')).toThrow(error)
            expect(originalFetch).toHaveBeenCalledTimes(1)
        })
    })

    describe('xhr', () => {
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
    })
})
