/**
 * @jest-environment node
 */

import { getRecordNetworkPlugin } from '../../../../extensions/replay/external/network-plugin'
import { NetworkRecordOptions } from '../../../../types'

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
})
