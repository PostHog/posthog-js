import { isNull, isUndefined } from '@posthog/core'
import { COOKIELESS_SENTINEL_VALUE } from '../constants'
import patchFns from '../entrypoints/tracing-headers'
import { TracingHeaders } from '../extensions/tracing-headers'

class TestRequest {
    body?: BodyInit | null
    bodyUsed = false
    headers: Headers
    method: string
    url: string

    constructor(input: string | URL | TestRequest, init?: RequestInit) {
        const inputRequest = input instanceof TestRequest ? input : undefined
        if (inputRequest?.bodyUsed && isUndefined(init?.body)) {
            throw new TypeError('Cannot construct a Request with a Request object that has already been used.')
        }

        this.url = inputRequest ? inputRequest.url : input.toString()
        this.headers = new Headers(init?.headers ?? inputRequest?.headers)
        this.method = init?.method ?? inputRequest?.method ?? 'GET'
        this.body = init?.body ?? inputRequest?.body ?? null

        if (inputRequest && isUndefined(init?.body) && !isNull(inputRequest.body) && !isUndefined(inputRequest.body)) {
            inputRequest.bodyUsed = true
        }
    }

    clone(): TestRequest {
        return new TestRequest(this.url, { body: this.body, headers: this.headers, method: this.method })
    }

    text(): Promise<string> {
        if (this.bodyUsed) {
            return Promise.reject(new TypeError('Body has already been used.'))
        }
        this.bodyUsed = true
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
        checkAndGetSessionAndWindowId: vi.fn(() => ({ sessionId: 'session-id', windowId: 'window-id' })),
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
        vi.restoreAllMocks()
        sessionManager.checkAndGetSessionAndWindowId.mockClear()
    })

    describe('config aliases', () => {
        const getConfiguredHostnames = (config: Record<string, unknown>): string[] | boolean | undefined => {
            const tracingHeaders = new TracingHeaders({ config } as any)
            return (tracingHeaders as any)._getConfiguredHostnames()
        }

        it.each([
            {
                name: 'uses the public tracing_headers option',
                config: { tracing_headers: ['example.com'] },
                expected: ['example.com'],
            },
            {
                name: 'falls back to deprecated addTracingHeaders',
                config: { addTracingHeaders: ['camel.example'] },
                expected: ['camel.example'],
            },
            {
                name: 'falls back to deprecated __add_tracing_headers',
                config: { __add_tracing_headers: ['legacy.example'] },
                expected: ['legacy.example'],
            },
            {
                name: 'prefers tracing_headers over deprecated addTracingHeaders',
                config: {
                    tracing_headers: ['public.example'],
                    addTracingHeaders: ['camel.example'],
                },
                expected: ['public.example'],
            },
            {
                name: 'prefers addTracingHeaders over deprecated __add_tracing_headers',
                config: {
                    addTracingHeaders: ['camel.example'],
                    __add_tracing_headers: ['legacy.example'],
                },
                expected: ['camel.example'],
            },
            {
                name: 'prefers tracing_headers over deprecated __add_tracing_headers',
                config: {
                    tracing_headers: ['public.example'],
                    __add_tracing_headers: ['legacy.example'],
                },
                expected: ['public.example'],
            },
            {
                name: 'allows an empty tracing_headers list to override deprecated aliases',
                config: {
                    tracing_headers: [],
                    addTracingHeaders: ['camel.example'],
                    __add_tracing_headers: ['legacy.example'],
                },
                expected: [],
            },
        ])('$name', ({ config, expected }) => {
            expect(getConfiguredHostnames(config)).toEqual(expected)
        })

        it('mutates the installed hostname list when tracing_headers changes', () => {
            const config = { tracing_headers: ['example.com'] }
            const tracingHeaders = new TracingHeaders({ config } as any)
            const hostnames = (tracingHeaders as any)._syncHostnamesForPatch()

            expect(hostnames).toEqual(['example.com'])

            config.tracing_headers = []

            expect((tracingHeaders as any)._syncHostnamesForPatch()).toBeUndefined()
            expect(hostnames).toEqual([])
        })
    })

    describe('fetch', () => {
        it('adds tracing headers without spreading init or mutating caller headers', async () => {
            const originalFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(() =>
                Promise.resolve(new Response())
            )
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
            const originalFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(() =>
                Promise.resolve(new Response())
            )
            setWindowFetch(originalFetch)
            restoreFetchPatch = patchFns._patchFetch(['example.com'], 'distinct-id', sessionManager as any)

            const init = { method: 'POST', headers: { 'x-original': 'value' }, body: 'request-body' }
            await window.fetch('https://other.example/path', init)

            expect(originalFetch).toHaveBeenCalledWith('https://other.example/path', init)
            expect(sessionManager.checkAndGetSessionAndWindowId).not.toHaveBeenCalled()
        })

        it('uses the latest configured hostnames from a mutated hostname list without re-patching', async () => {
            const originalFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(() =>
                Promise.resolve(new Response())
            )
            setWindowFetch(originalFetch)
            const hostnames = ['example.com']
            restoreFetchPatch = patchFns._patchFetch(hostnames, 'distinct-id', sessionManager as any)

            await window.fetch('https://example.com/path')
            expect(new Headers(originalFetch.mock.calls[0][1]?.headers).get('X-POSTHOG-DISTINCT-ID')).toBe(
                'distinct-id'
            )

            originalFetch.mockClear()
            sessionManager.checkAndGetSessionAndWindowId.mockClear()
            hostnames.splice(0)

            await window.fetch('https://example.com/path')

            expect(originalFetch).toHaveBeenCalledWith('https://example.com/path')
            expect(sessionManager.checkAndGetSessionAndWindowId).not.toHaveBeenCalled()
        })

        it('uses the latest distinct ID from a provider without re-patching', async () => {
            const originalFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(() =>
                Promise.resolve(new Response())
            )
            setWindowFetch(originalFetch)
            let distinctId = 'first-distinct-id'
            restoreFetchPatch = patchFns._patchFetch(['example.com'], () => distinctId, sessionManager as any)

            await window.fetch('https://example.com/path')
            expect(new Headers(originalFetch.mock.calls[0][1]?.headers).get('X-POSTHOG-DISTINCT-ID')).toBe(
                'first-distinct-id'
            )

            originalFetch.mockClear()
            distinctId = 'second-distinct-id'

            await window.fetch('https://example.com/path')
            expect(new Headers(originalFetch.mock.calls[0][1]?.headers).get('X-POSTHOG-DISTINCT-ID')).toBe(
                'second-distinct-id'
            )
        })

        it('passes the cloned Request downstream when a Request input hostname does not match', async () => {
            let downstreamRequest: Request | undefined
            const originalFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
                downstreamRequest = new Request(input, init)
                return {} as Response
            })
            setWindowFetch(originalFetch)
            restoreFetchPatch = patchFns._patchFetch(['example.com'], 'distinct-id', sessionManager as any)

            const request = new Request('https://other.example/path', {
                body: 'request-body',
                headers: { 'x-request': 'request-header' },
                method: 'POST',
            })

            await expect(window.fetch(request)).resolves.toBeDefined()

            expect(originalFetch).toHaveBeenCalledTimes(1)
            const [input, init] = originalFetch.mock.calls[0]
            expect(input).toBeInstanceOf(Request)
            expect(input).not.toBe(request)
            expect(init).toBeUndefined()
            expect(downstreamRequest?.url).toBe('https://other.example/path')
            expect(downstreamRequest?.method).toBe('POST')
            expect(downstreamRequest?.headers.get('x-request')).toBe('request-header')
            expect(downstreamRequest?.headers.get('X-POSTHOG-SESSION-ID')).toBeNull()
            expect(downstreamRequest?.headers.get('X-POSTHOG-WINDOW-ID')).toBeNull()
            expect(downstreamRequest?.headers.get('X-POSTHOG-DISTINCT-ID')).toBeNull()
            await expect(downstreamRequest?.clone().text()).resolves.toBe('request-body')
            expect(sessionManager.checkAndGetSessionAndWindowId).not.toHaveBeenCalled()
        })

        it('preserves Request input semantics and init overrides', async () => {
            const originalFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(() =>
                Promise.resolve(new Response())
            )
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
            const originalFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(() => {
                throw error
            })
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
            const setRequestHeaderSpy = vi
                .spyOn(XMLHttpRequest.prototype, 'setRequestHeader')
                .mockImplementation(() => {})
            restoreXHRPatch = patchFns._patchXHR(['example.com'], distinctId, sessionManager as any)

            const xhr = new XMLHttpRequest()
            xhr.open('GET', url)

            expectedHeaders.forEach(([header, value]) => {
                expect(setRequestHeaderSpy).toHaveBeenCalledWith(header, value)
            })
            absentHeaders.forEach(([header]) => {
                expect(
                    setRequestHeaderSpy.mock.calls.some(([name]) => name.toLowerCase() === header.toLowerCase())
                ).toBe(false)
            })
        })
    })

    describe('traceparent', () => {
        const TRACEPARENT_PATTERN = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/

        const mockFetch = () => {
            const originalFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(() =>
                Promise.resolve(new Response())
            )
            setWindowFetch(originalFetch)
            return originalFetch
        }

        const downstreamHeaders = (originalFetch: ReturnType<typeof mockFetch>, call = 0): Headers => {
            const [input, init] = originalFetch.mock.calls[call]
            return input instanceof Request ? input.headers : new Headers(init?.headers)
        }

        it('adds a fresh sampled traceparent per fetch to listed hostnames only', async () => {
            const originalFetch = mockFetch()
            restoreFetchPatch = patchFns._patchFetch([], 'distinct-id', sessionManager as any, ['api.example.com'])

            await window.fetch('https://api.example.com/a')
            await window.fetch('https://api.example.com/b', { method: 'POST', body: 'x' })
            await window.fetch('https://other.example/c')

            const first = downstreamHeaders(originalFetch, 0).get('traceparent')
            const second = downstreamHeaders(originalFetch, 1).get('traceparent')
            expect(first).toMatch(TRACEPARENT_PATTERN)
            expect(second).toMatch(TRACEPARENT_PATTERN)
            expect(first!.split('-')[1]).not.toEqual(second!.split('-')[1])
            expect(first!.split('-')[2]).not.toEqual(second!.split('-')[2])
            expect((originalFetch.mock.calls[1][1] as RequestInit).body).toBe('x')
            expect(originalFetch.mock.calls[2]).toEqual(['https://other.example/c'])
            // tracing_headers is empty, so the PostHog headers are not added alongside
            expect(downstreamHeaders(originalFetch, 0).get('X-POSTHOG-SESSION-ID')).toBeNull()
        })

        it.each([
            { target: 'https://api.example.com', url: 'https://api.example.com/path', expected: true },
            { target: 'https://api.example.com/', url: 'https://api.example.com/path', expected: true },
            { target: 'https://api.example.com', url: 'http://api.example.com/path', expected: false },
            { target: 'https://api.example.com', url: 'https://api.example.com:8443/path', expected: false },
            { target: 'http://localhost:8000', url: 'http://localhost:8000/path', expected: true },
            { target: 'https://api.example.com:443', url: 'https://api.example.com/path', expected: true },
            { target: 'http://API.example.com:80', url: 'http://api.example.com/path', expected: true },
            { target: 'API.example.com', url: 'https://api.example.com:8443/path', expected: true },
            { target: 'example.com', url: 'https://api.example.com/path', expected: false },
            { target: 'api.example.com', url: 'https://api.example.com.evil.test/path', expected: false },
        ])('matches $target against $url: $expected', async ({ target, url, expected }) => {
            const originalFetch = mockFetch()
            restoreFetchPatch = patchFns._patchFetch(undefined, 'distinct-id', sessionManager as any, [target])

            await window.fetch(url)

            expect(downstreamHeaders(originalFetch).has('traceparent')).toBe(expected)
        })

        it('does not overwrite a traceparent set by the app', async () => {
            const originalFetch = mockFetch()
            restoreFetchPatch = patchFns._patchFetch(['api.example.com'], 'distinct-id', sessionManager as any, [
                'api.example.com',
            ])
            const appTraceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'

            await window.fetch('https://api.example.com/a', { headers: { TraceParent: appTraceparent } })
            await window.fetch(new Request('https://api.example.com/b', { headers: { traceparent: appTraceparent } }))

            expect(downstreamHeaders(originalFetch, 0).get('traceparent')).toBe(appTraceparent)
            expect(downstreamHeaders(originalFetch, 0).get('X-POSTHOG-SESSION-ID')).toBe('session-id')
            expect(downstreamHeaders(originalFetch, 1).get('traceparent')).toBe(appTraceparent)
        })

        it('adds traceparent to Request inputs', async () => {
            const originalFetch = mockFetch()
            restoreFetchPatch = patchFns._patchFetch(undefined, 'distinct-id', sessionManager as any, [
                'api.example.com',
            ])

            await window.fetch(new Request('https://api.example.com/a'))

            expect(downstreamHeaders(originalFetch).get('traceparent')).toMatch(TRACEPARENT_PATTERN)
        })

        it('reads the live target list without re-patching', async () => {
            const originalFetch = mockFetch()
            const targets: string[] = []
            restoreFetchPatch = patchFns._patchFetch(undefined, 'distinct-id', sessionManager as any, targets)

            await window.fetch('https://api.example.com/a')
            targets.push('api.example.com')
            await window.fetch('https://api.example.com/b')

            expect(originalFetch.mock.calls[0]).toEqual(['https://api.example.com/a'])
            expect(downstreamHeaders(originalFetch, 1).get('traceparent')).toMatch(TRACEPARENT_PATTERN)
        })

        describe('xhr', () => {
            const sentTraceparents = (spy: { mock: { calls: unknown[][] } }): string[] =>
                spy.mock.calls
                    .filter(([name]) => String(name).toLowerCase() === 'traceparent')
                    .map(([, value]) => String(value))

            const setUpXHR = (targets: string[]) => {
                const setRequestHeaderSpy = vi
                    .spyOn(XMLHttpRequest.prototype, 'setRequestHeader')
                    .mockImplementation(() => {})
                vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(() => {})
                restoreXHRPatch = patchFns._patchXHR(undefined, 'distinct-id', sessionManager as any, targets)
                return setRequestHeaderSpy
            }

            it('sets traceparent on send for listed hosts', () => {
                const setRequestHeaderSpy = setUpXHR(['api.example.com'])

                const xhr = new XMLHttpRequest()
                xhr.open('GET', 'https://api.example.com/path')
                expect(sentTraceparents(setRequestHeaderSpy)).toEqual([])
                xhr.send()

                const sent = sentTraceparents(setRequestHeaderSpy)
                expect(sent).toHaveLength(1)
                expect(sent[0]).toMatch(TRACEPARENT_PATTERN)
            })

            it('does not set traceparent for unlisted hosts', () => {
                const setRequestHeaderSpy = setUpXHR(['api.example.com'])

                const xhr = new XMLHttpRequest()
                xhr.open('GET', 'https://other.example/path')
                xhr.send()

                expect(sentTraceparents(setRequestHeaderSpy)).toEqual([])
            })

            it('does not add a second traceparent when the app set one', () => {
                const setRequestHeaderSpy = setUpXHR(['api.example.com'])
                const appTraceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'

                const xhr = new XMLHttpRequest()
                xhr.open('GET', 'https://api.example.com/path')
                xhr.setRequestHeader('Traceparent', appTraceparent)
                xhr.send()

                expect(sentTraceparents(setRequestHeaderSpy)).toEqual([appTraceparent])
            })

            it('treats a String object header name as traceparent', () => {
                const setRequestHeaderSpy = setUpXHR(['api.example.com'])
                const appTraceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'

                const xhr = new XMLHttpRequest()
                xhr.open('GET', 'https://api.example.com/path')
                xhr.setRequestHeader(new String('traceparent') as unknown as string, appTraceparent)
                xhr.send()

                expect(sentTraceparents(setRequestHeaderSpy)).toEqual([appTraceparent])
            })

            it('rechecks the live target list at send', () => {
                const targets = ['api.example.com', 'other.example']
                const setRequestHeaderSpy = setUpXHR(targets)

                const xhr = new XMLHttpRequest()
                xhr.open('GET', 'https://api.example.com/path')
                targets.splice(0, 1)
                xhr.send()

                expect(sentTraceparents(setRequestHeaderSpy)).toEqual([])
            })

            it('sets traceparent when the host is added to the target list between open and send', () => {
                const targets = ['other.example']
                const setRequestHeaderSpy = setUpXHR(targets)

                const xhr = new XMLHttpRequest()
                xhr.open('GET', 'https://api.example.com/path')
                targets.push('api.example.com')
                xhr.send()

                expect(sentTraceparents(setRequestHeaderSpy)).toHaveLength(1)
            })

            describe('with OpenTelemetry XHR instrumentation', () => {
                const otelKey = Symbol.for('opentelemetry.js.api.1')
                const otelTraceparent = '00-11111111111111111111111111111111-2222222222222222-01'

                beforeEach(() => {
                    ;(window as any)[otelKey] = { version: '1.9.0', propagation: {} }
                })

                afterEach(() => {
                    delete (window as any)[otelKey]
                })

                // Shimmer-style wrapper that injects traceparent inside send(), like OpenTelemetry's instrumentation.
                const otelSend = function (this: XMLHttpRequest) {
                    this.setRequestHeader('traceparent', otelTraceparent)
                }
                Object.defineProperty(otelSend, '__wrapped', { value: true })

                const withOtelBelow = (wrapper: typeof otelSend, run: () => void) => {
                    const nativeSend = XMLHttpRequest.prototype.send
                    XMLHttpRequest.prototype.send = wrapper as typeof nativeSend
                    try {
                        restoreXHRPatch = patchFns._patchXHR(undefined, 'distinct-id', sessionManager as any, [
                            window.location.hostname,
                            'api.example.com',
                        ])
                        run()
                    } finally {
                        restoreXHRPatch?.()
                        restoreXHRPatch = undefined
                        XMLHttpRequest.prototype.send = nativeSend
                    }
                }

                it('leaves same-origin requests to it when it wrapped send before PostHog', () => {
                    const setRequestHeaderSpy = vi
                        .spyOn(XMLHttpRequest.prototype, 'setRequestHeader')
                        .mockImplementation(() => {})
                    withOtelBelow(otelSend, () => {
                        const xhr = new XMLHttpRequest()
                        xhr.open('GET', `${window.location.origin}/path`)
                        xhr.send()

                        expect(sentTraceparents(setRequestHeaderSpy)).toEqual([otelTraceparent])
                    })
                })

                it('still sets traceparent on cross-origin targets it skips by default', () => {
                    const setRequestHeaderSpy = vi
                        .spyOn(XMLHttpRequest.prototype, 'setRequestHeader')
                        .mockImplementation(() => {})
                    // OpenTelemetry's default: no propagation to cross-origin URLs.
                    const otelSendSkippingCrossOrigin = function (this: XMLHttpRequest) {}
                    Object.defineProperty(otelSendSkippingCrossOrigin, '__wrapped', { value: true })
                    withOtelBelow(otelSendSkippingCrossOrigin as typeof otelSend, () => {
                        const xhr = new XMLHttpRequest()
                        xhr.open('GET', 'https://api.example.com/path')
                        xhr.send()

                        const sent = sentTraceparents(setRequestHeaderSpy)
                        expect(sent).toHaveLength(1)
                        expect(sent[0]).toMatch(TRACEPARENT_PATTERN)
                    })
                })

                it('still sets traceparent when OpenTelemetry has not wrapped send underneath PostHog', () => {
                    const setRequestHeaderSpy = setUpXHR(['api.example.com'])

                    const xhr = new XMLHttpRequest()
                    xhr.open('GET', 'https://api.example.com/path')
                    xhr.send()

                    expect(sentTraceparents(setRequestHeaderSpy)).toHaveLength(1)
                })

                it('does not add a second value when it wrapped send after PostHog', () => {
                    const setRequestHeaderSpy = setUpXHR(['api.example.com'])
                    const posthogSend = XMLHttpRequest.prototype.send
                    XMLHttpRequest.prototype.send = function (this: XMLHttpRequest) {
                        this.setRequestHeader('traceparent', otelTraceparent)
                        return posthogSend.call(this)
                    }
                    try {
                        const xhr = new XMLHttpRequest()
                        xhr.open('GET', 'https://api.example.com/path')
                        xhr.send()

                        expect(sentTraceparents(setRequestHeaderSpy)).toEqual([otelTraceparent])
                    } finally {
                        XMLHttpRequest.prototype.send = posthogSend
                    }
                })
            })

            it('restores send and setRequestHeader', () => {
                const originalSend = XMLHttpRequest.prototype.send
                const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader
                restoreXHRPatch = patchFns._patchXHR(undefined, 'distinct-id', sessionManager as any, [
                    'api.example.com',
                ])
                expect(XMLHttpRequest.prototype.send).not.toBe(originalSend)
                expect(XMLHttpRequest.prototype.setRequestHeader).not.toBe(originalSetRequestHeader)

                restoreXHRPatch?.()
                restoreXHRPatch = undefined

                expect(XMLHttpRequest.prototype.send).toBe(originalSend)
                expect(XMLHttpRequest.prototype.setRequestHeader).toBe(originalSetRequestHeader)
            })

            it('does not patch send when no traceparent targets are passed (older core)', () => {
                const originalSend = XMLHttpRequest.prototype.send
                restoreXHRPatch = patchFns._patchXHR(['example.com'], 'distinct-id', sessionManager as any)
                expect(XMLHttpRequest.prototype.send).toBe(originalSend)
            })
        })
    })

    describe('trace_propagation_targets config', () => {
        it('enables patching with only trace_propagation_targets and keeps live arrays', () => {
            const config: Record<string, unknown> = { trace_propagation_targets: ['api.example.com', 42, ''] }
            const tracingHeaders = new TracingHeaders({ config } as any)

            const { hostnames, traceparentTargets } = (tracingHeaders as any)._syncForPatch()
            expect(hostnames).toBeUndefined()
            expect(traceparentTargets).toEqual(['api.example.com'])

            config.trace_propagation_targets = undefined
            expect((tracingHeaders as any)._syncForPatch().traceparentTargets).toBeUndefined()
            expect(traceparentTargets).toEqual([])
        })

        it('reinstalls the patches when leaving legacy __add_tracing_headers: true', () => {
            const restore = vi.fn()
            const patchXHR = vi.fn((_hostnames: unknown) => restore)
            const patchFetch = vi.fn((_hostnames: unknown) => restore)
            const extensions = ((window as any).__PosthogExtensions__ = (window as any).__PosthogExtensions__ || {})
            const originalPatchFns = extensions.tracingHeadersPatchFns
            extensions.tracingHeadersPatchFns = { _patchXHR: patchXHR, _patchFetch: patchFetch }
            try {
                const config: Record<string, unknown> = {
                    __add_tracing_headers: true,
                    trace_propagation_targets: ['api.example.com'],
                }
                const tracingHeaders = new TracingHeaders({ config, get_distinct_id: () => 'id' } as any)
                tracingHeaders.startIfEnabledOrStop()
                expect(patchXHR.mock.calls[0][0]).toBe(true)
                expect(patchFetch.mock.calls[0][0]).toBe(true)

                config.tracing_headers = []
                tracingHeaders.startIfEnabledOrStop()

                expect(restore).toHaveBeenCalledTimes(2)
                expect(patchXHR).toHaveBeenCalledTimes(2)
                expect(patchXHR.mock.calls[1][0]).toEqual([])
                expect(patchFetch.mock.calls[1][0]).toEqual([])

                // A later array change reaches the installed patches in place, without re-patching.
                config.tracing_headers = ['example.com']
                tracingHeaders.startIfEnabledOrStop()
                expect(patchXHR).toHaveBeenCalledTimes(2)
                expect(patchXHR.mock.calls[1][0]).toEqual(['example.com'])
            } finally {
                extensions.tracingHeadersPatchFns = originalPatchFns
            }
        })

        it('keeps the hostname array instance when tracing_headers is removed', () => {
            const config: Record<string, unknown> = { tracing_headers: ['example.com'] }
            const tracingHeaders = new TracingHeaders({ config } as any)
            const hostnames = (tracingHeaders as any)._syncHostnamesForPatch()

            config.tracing_headers = undefined
            expect((tracingHeaders as any)._syncHostnamesForPatch()).toBeUndefined()
            config.tracing_headers = ['example.com']
            expect((tracingHeaders as any)._syncHostnamesForPatch()).toBe(hostnames)
        })
    })
})
