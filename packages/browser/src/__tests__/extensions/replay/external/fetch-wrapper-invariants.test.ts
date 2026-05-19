/**
 * @jest-environment node
 */

import { getRecordNetworkPlugin } from '../../../../extensions/replay/external/network-plugin'
import { NetworkRecordOptions } from '../../../../types'
import { csrfHeaderCases, sensitiveHeaderCases, unaffectedHeaderCases } from './header-cases'

function expectNotToThrow(promise: Promise<Response>) {
    // We're testing that the wrapper doesn't cause body-consumption errors like:
    // TypeError: body stream already read
    // TypeError: Failed to execute 'clone' on 'Request': Request body is already used
    return expect(promise).resolves.toBeInstanceOf(Response)
}

function setupWrappedFetch(downstreamFetch: typeof fetch): { wrappedFetch: typeof fetch; cleanup: () => void } {
    class MockPerformanceObserver {
        static supportedEntryTypes = ['resource']
        observe() {}
        disconnect() {}
    }
    ;(global as any).PerformanceObserver = MockPerformanceObserver

    const mockWindow = {
        fetch: downstreamFetch,
        performance: { now: () => Date.now(), getEntriesByName: () => [] },
        PerformanceObserver: MockPerformanceObserver,
    } as any

    const plugin = getRecordNetworkPlugin({
        recordBody: true,
        recordHeaders: true,
    } as Partial<NetworkRecordOptions> as NetworkRecordOptions)
    const cleanup = plugin.observer(() => {}, mockWindow, {
        recordBody: true,
        recordHeaders: true,
        initiatorTypes: ['fetch'],
    } as any)

    return { wrappedFetch: mockWindow.fetch, cleanup }
}

describe('fetch wrapper', () => {
    // Use fake timers to prevent getRequestPerformanceEntry retry timeouts
    // from keeping the Jest worker alive after tests complete.
    beforeEach(() => jest.useFakeTimers())
    afterEach(() => jest.useRealTimers())

    describe('does not throw for valid inputs', () => {
        let wrappedFetch: typeof fetch
        let cleanup: () => void

        beforeEach(() => {
            const result = setupWrappedFetch(async (input: RequestInfo | URL, init?: RequestInit) => {
                new Request(input, init)
                return new Response('ok')
            })
            wrappedFetch = result.wrappedFetch
            cleanup = result.cleanup
        })

        afterEach(() => cleanup())

        it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const)(
            'handles %s method',
            async (method) => {
                await expectNotToThrow(wrappedFetch('https://example.com/api', { method }))
            }
        )

        it.each([
            ['JSON string', JSON.stringify({ key: 'value' })],
            ['plain text', 'plain text body'],
            ['empty string', ''],
            ['URL encoded', 'foo=bar&baz=qux'],
        ])('handles %s body', async (_name, body) => {
            await expectNotToThrow(wrappedFetch('https://example.com/api', { method: 'POST', body }))
        })

        it.each([
            ['Blob', () => new Blob(['blob content'], { type: 'text/plain' })],
            ['ArrayBuffer', () => new TextEncoder().encode('buffer content').buffer],
            ['URLSearchParams', () => new URLSearchParams({ foo: 'bar', baz: 'qux' })],
            [
                'FormData',
                () => {
                    const fd = new FormData()
                    fd.append('key', 'value')
                    return fd
                },
            ],
            ['Uint8Array', () => new Uint8Array([1, 2, 3])],
            ['File', () => new File(['content'], 'test.txt', { type: 'text/plain' })],
            ['empty FormData', () => new FormData()],
            [
                'FormData with multiple files',
                () => {
                    const fd = new FormData()
                    fd.append('file1', new Blob(['content1']), 'file1.txt')
                    fd.append('file2', new Blob(['content2']), 'file2.txt')
                    return fd
                },
            ],
            ['null', () => null],
            ['undefined', () => undefined],
        ])('handles %s body', async (_name, createBody) => {
            await expectNotToThrow(wrappedFetch('https://example.com/api', { method: 'POST', body: createBody() }))
        })

        it('handles custom headers', async () => {
            await expectNotToThrow(
                wrappedFetch('https://example.com/api', {
                    method: 'POST',
                    headers: { 'X-Custom-Header': 'custom-value', 'X-Another': 'another-value' },
                    body: '{}',
                })
            )
        })

        it('handles URL object input', async () => {
            await expectNotToThrow(
                wrappedFetch(new URL('https://example.com/api/path'), { method: 'POST', body: 'test' })
            )
        })

        it('handles Request object input', async () => {
            const request = new Request('https://example.com/api', {
                method: 'POST',
                headers: { 'X-Custom': 'value' },
                body: 'request body',
            })
            await expectNotToThrow(wrappedFetch(request))
        })

        it.each([
            ['credentials', { credentials: 'include' as const }],
            ['mode', { mode: 'cors' as const }],
            ['cache', { cache: 'no-cache' as const }],
            ['redirect', { redirect: 'manual' as const }],
        ])('handles %s option', async (_name, options) => {
            await expectNotToThrow(wrappedFetch('https://example.com/api', options))
        })
    })

    describe('response availability', () => {
        it('caller can read response body after wrapper processes it', async () => {
            const { wrappedFetch, cleanup } = setupWrappedFetch(async () => {
                return new Response(JSON.stringify({ data: 'test' }), {
                    headers: { 'Content-Type': 'application/json' },
                })
            })

            const response = await wrappedFetch('https://example.com/api')
            const body = await response.json()
            cleanup()

            expect(body).toEqual({ data: 'test' })
        })

        it('caller can clone response after wrapper processes it', async () => {
            const { wrappedFetch, cleanup } = setupWrappedFetch(async () => {
                return new Response('test body')
            })

            const response = await wrappedFetch('https://example.com/api')
            const clone = response.clone()
            cleanup()

            expect(await response.text()).toBe('test body')
            expect(await clone.text()).toBe('test body')
        })
    })

    describe('downstream wrapper compatibility', () => {
        it('downstream receives Request object as first argument', async () => {
            let receivedInput: RequestInfo | URL | undefined
            const { wrappedFetch, cleanup } = setupWrappedFetch(async (input: RequestInfo | URL) => {
                receivedInput = input
                return new Response('ok')
            })

            await wrappedFetch('https://example.com/api', { method: 'POST' })
            cleanup()

            expect(receivedInput).toBeInstanceOf(Request)
        })

        it('downstream receives undefined as second argument (init not passed)', async () => {
            let receivedInit: RequestInit | undefined
            const { wrappedFetch, cleanup } = setupWrappedFetch(
                async (_input: RequestInfo | URL, init?: RequestInit) => {
                    receivedInit = init
                    return new Response('ok')
                }
            )

            await wrappedFetch('https://example.com/api', { method: 'POST', body: 'test' })
            cleanup()

            expect(receivedInit).toBeUndefined()
        })

        it.each([
            ['method', { method: 'PUT' } as RequestInit, (req: Request) => req.method, 'PUT'],
            ['headers', { headers: { 'X-Custom': 'value' } }, (req: Request) => req.headers.get('X-Custom'), 'value'],
            ['url', {}, (req: Request) => req.url, 'https://example.com/api'],
        ])('downstream can read %s from Request object', async (_name, init, getter, expected) => {
            let captured: string | null | undefined
            const { wrappedFetch, cleanup } = setupWrappedFetch(async (input: RequestInfo | URL) => {
                captured = getter(input as Request)
                return new Response('ok')
            })

            await wrappedFetch('https://example.com/api', init)
            cleanup()

            expect(captured).toBe(expected)
        })
    })

    // Regression test for https://github.com/PostHog/posthog-js/issues/2922
    it('preserves FormData boundary when downstream wrapper recreates Request', async () => {
        let capturedRequest: Request | undefined
        const { wrappedFetch, cleanup } = setupWrappedFetch(async (input: RequestInfo | URL, init?: RequestInit) => {
            capturedRequest = new Request(input, init)
            return new Response('ok')
        })

        const formData = new FormData()
        formData.append('key', 'value')
        formData.append('file', new Blob(['test content']), 'test.txt')

        await wrappedFetch('https://example.com/upload', { method: 'POST', body: formData })
        cleanup()

        const contentType = capturedRequest!.headers.get('content-type')!
        const headerBoundary = contentType.match(/boundary=([^\s;]+)/)?.[1]
        const body = await capturedRequest!.text()
        const bodyBoundary = body.match(/^--+([^\r\n]+)/)?.[1]

        expect(headerBoundary).toContain(bodyBoundary)
    })

    // TODO: Fix https://github.com/PostHog/posthog-js/issues/1326
    it.skip('passes init to downstream wrappers', async () => {
        let capturedInit: RequestInit | undefined
        const { wrappedFetch, cleanup } = setupWrappedFetch(async (_input: RequestInfo | URL, init?: RequestInit) => {
            capturedInit = init
            return new Response('ok')
        })

        await wrappedFetch('https://example.com/api', { method: 'PUT', headers: { 'X-Custom': 'value' } })
        cleanup()

        expect(capturedInit).toBeDefined()
        expect(capturedInit?.method).toBe('PUT')
        expect(capturedInit?.headers).toEqual({ 'X-Custom': 'value' })
    })

    // Reproduces a user report that the wrapper strips deny-listed headers
    // (CSRF tokens, authorization, api keys) from the actual outgoing
    // request. The wrapper redacts them from the *recording* via
    // HEADER_DENY_LIST, but that must never leak back into the live
    // request the browser sends to the server.
    describe('does not strip deny-listed headers from the actual outgoing request', () => {
        it.each(sensitiveHeaderCases)('preserves %s on downstream Request when set via init.headers plain object', async (name, value) => {
            let downstream: Request | undefined
            const { wrappedFetch, cleanup } = setupWrappedFetch(async (input: RequestInfo | URL) => {
                downstream = input as Request
                return new Response('ok')
            })

            await wrappedFetch('https://example.com/api/internal/surveys', {
                method: 'POST',
                headers: { [name]: value, 'content-type': 'application/json' },
                body: '{}',
            })
            cleanup()

            expect(downstream!.headers.get(name)).toBe(value)
        })

        it.each(sensitiveHeaderCases)('preserves %s on downstream Request when set via Headers instance', async (name, value) => {
            let downstream: Request | undefined
            const { wrappedFetch, cleanup } = setupWrappedFetch(async (input: RequestInfo | URL) => {
                downstream = input as Request
                return new Response('ok')
            })

            const headers = new Headers()
            headers.append(name, value)
            headers.append('content-type', 'application/json')

            await wrappedFetch('https://example.com/api/internal/surveys', {
                method: 'POST',
                headers,
                body: '{}',
            })
            cleanup()

            expect(downstream!.headers.get(name)).toBe(value)
        })

        it.each(sensitiveHeaderCases)('preserves %s on downstream Request when set on a Request input', async (name, value) => {
            let downstream: Request | undefined
            const { wrappedFetch, cleanup } = setupWrappedFetch(async (input: RequestInfo | URL) => {
                downstream = input as Request
                return new Response('ok')
            })

            const inputRequest = new Request('https://example.com/api/internal/surveys', {
                method: 'POST',
                headers: { [name]: value, 'content-type': 'application/json' },
                body: '{}',
            })

            await wrappedFetch(inputRequest)
            cleanup()

            expect(downstream!.headers.get(name)).toBe(value)
        })
    })

    // Smoke check that the wrapper doesn't accidentally strip ordinary
    // (non-deny-listed) headers either. NOT load-bearing for the
    // deny-list bug — these are guaranteed to pass for trivial reasons.
    describe('does not strip ordinary headers from the actual outgoing request', () => {
        it.each(unaffectedHeaderCases)('preserves %s on downstream Request', async (name, value) => {
            let downstream: Request | undefined
            const { wrappedFetch, cleanup } = setupWrappedFetch(async (input: RequestInfo | URL) => {
                downstream = input as Request
                return new Response('ok')
            })

            await wrappedFetch('https://example.com/api/internal/surveys', {
                method: 'POST',
                headers: { [name]: value, 'content-type': 'application/json' },
                body: '{}',
            })
            cleanup()

            expect(downstream!.headers.get(name)).toBe(value)
        })
    })

    // The real product applies BOTH the network-plugin wrapper and the
    // tracing-headers wrapper to window.fetch (when __add_tracing_headers
    // is configured). They wrap independently, so whichever loads second
    // ends up calling the other. This block reproduces both orders and
    // asserts that a user-supplied CSRF header still reaches the
    // underlying fetch — and that the tracing headers are also added.
    describe('double wrap (network-plugin + tracing-headers)', () => {
        // Mirrors packages/browser/src/entrypoints/tracing-headers.ts:patchFetch.
        // Inlined because the real function patches the global window.fetch and
        // we need an isolated wrapper around the downstream of our choice.
        function applyTracingHeadersWrapper(
            originalFetch: typeof fetch,
            hostnames: string[],
            distinctId: string,
            sessionId: string,
            windowId: string
        ): typeof fetch {
            return async function (url: URL | RequestInfo, init?: RequestInit | undefined) {
                const req = new Request(url, init)
                let reqHostname: string
                try {
                    reqHostname = new URL(req.url).hostname
                } catch {
                    return originalFetch(req)
                }
                if (hostnames.includes(reqHostname)) {
                    req.headers.set('X-POSTHOG-SESSION-ID', sessionId)
                    req.headers.set('X-POSTHOG-WINDOW-ID', windowId)
                    req.headers.set('X-POSTHOG-DISTINCT-ID', distinctId)
                }
                return originalFetch(req)
            }
        }

        describe('order: network-plugin wraps first, tracing-headers wraps second (outer)', () => {
            it.each(csrfHeaderCases)('preserves %s and adds tracing headers', async (name, value) => {
                let downstream: Request | undefined
                const { wrappedFetch: innerWrapped, cleanup } = setupWrappedFetch(
                    async (input: RequestInfo | URL) => {
                        downstream = input as Request
                        return new Response('ok')
                    }
                )

                const doublyWrapped = applyTracingHeadersWrapper(
                    innerWrapped,
                    ['example.com'],
                    'distinct-abc',
                    'session-abc',
                    'window-abc'
                )

                await doublyWrapped('https://example.com/api/internal/surveys', {
                    method: 'POST',
                    headers: { [name]: value, 'content-type': 'application/json' },
                    body: '{}',
                })
                cleanup()

                expect(downstream!.headers.get(name)).toBe(value)
                expect(downstream!.headers.get('x-posthog-distinct-id')).toBe('distinct-abc')
                expect(downstream!.headers.get('x-posthog-session-id')).toBe('session-abc')
                expect(downstream!.headers.get('x-posthog-window-id')).toBe('window-abc')
            })
        })

        describe('order: tracing-headers wraps first (inner), network-plugin wraps second (outer)', () => {
            it.each(csrfHeaderCases)('preserves %s and adds tracing headers', async (name, value) => {
                let downstream: Request | undefined

                const innerTraced = applyTracingHeadersWrapper(
                    async (input: RequestInfo | URL) => {
                        downstream = input as Request
                        return new Response('ok')
                    },
                    ['example.com'],
                    'distinct-xyz',
                    'session-xyz',
                    'window-xyz'
                )

                const { wrappedFetch: doublyWrapped, cleanup } = setupWrappedFetch(innerTraced)

                await doublyWrapped('https://example.com/api/internal/surveys', {
                    method: 'POST',
                    headers: { [name]: value, 'content-type': 'application/json' },
                    body: '{}',
                })
                cleanup()

                expect(downstream!.headers.get(name)).toBe(value)
                expect(downstream!.headers.get('x-posthog-distinct-id')).toBe('distinct-xyz')
                expect(downstream!.headers.get('x-posthog-session-id')).toBe('session-xyz')
                expect(downstream!.headers.get('x-posthog-window-id')).toBe('window-xyz')
            })
        })
    })
})
