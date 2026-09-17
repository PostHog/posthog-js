import { startNetworkMetrics } from '../../extensions/network-metrics'
import { PostHog } from '../../posthog-core'
import { isPostHogXHR } from '../../request'
import type { NetworkMetricsConfig } from '../../types'

vi.mock('../../request', () => ({ isPostHogXHR: vi.fn(() => false) }))

vi.mock('@posthog/browser-common/utils/logger', () => ({
    createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}))

class FakeXHR extends EventTarget {
    status = 0
    open(..._args: unknown[]): void {}
    send(_body?: unknown): void {}

    respond(status: number): void {
        this.status = status
        this.dispatchEvent(new Event('loadend'))
    }
}

describe('network metrics', () => {
    const originalFetch = window.fetch
    const originalXHR = window.XMLHttpRequest
    let fetchMock: vi.Mock
    let openSpy: vi.SpyInstance
    let sendSpy: vi.SpyInstance
    let histogram: vi.Mock
    let mockPostHog: PostHog
    let stop: (() => void) | undefined

    const setWindowFetch = (fetchImpl: unknown): void => {
        Object.defineProperty(window, 'fetch', { configurable: true, value: fetchImpl, writable: true })
    }

    const start = (network: NetworkMetricsConfig | boolean = true): void => {
        mockPostHog.config.metrics = { network }
        stop = startNetworkMetrics(mockPostHog)
    }

    const recorded = (): any[] => histogram.mock.calls

    const sendXHR = (method: string, url: string, status: number): void => {
        const xhr = new window.XMLHttpRequest() as unknown as FakeXHR
        xhr.open(method, url)
        xhr.send()
        xhr.respond(status)
    }

    beforeEach(() => {
        fetchMock = vi.fn(() => Promise.resolve({ status: 200 }))
        setWindowFetch(fetchMock)
        window.XMLHttpRequest = FakeXHR as any
        openSpy = vi.spyOn(FakeXHR.prototype, 'open')
        sendSpy = vi.spyOn(FakeXHR.prototype, 'send')
        histogram = vi.fn()
        mockPostHog = {
            config: { metrics: {} },
            metrics: { histogram },
        } as unknown as PostHog
    })

    afterEach(() => {
        stop?.()
        stop = undefined
        setWindowFetch(originalFetch)
        window.XMLHttpRequest = originalXHR
        vi.restoreAllMocks()
    })

    it.each(['fetch', 'XMLHttpRequest'] as const)(
        'resolves a relative %s URL when the request begins',
        async (transport) => {
            const originalUrl = window.location.href
            window.history.replaceState(null, '', '/original/page/')
            start()

            try {
                if (transport === 'fetch') {
                    const request = window.fetch('orders')
                    window.history.replaceState(null, '', '/other/')
                    await request
                } else {
                    const xhr = new window.XMLHttpRequest() as unknown as FakeXHR
                    xhr.open('GET', 'orders')
                    window.history.replaceState(null, '', '/other/')
                    xhr.send()
                    xhr.respond(200)
                }

                expect(recorded()[0][2].attributes['url.template']).toBe('/original/page/orders')
            } finally {
                window.history.replaceState(null, '', originalUrl)
            }
        }
    )

    describe('fetch', () => {
        it('returns a promise that mirrors the original fetch result', async () => {
            const original = Promise.resolve({ status: 200 })
            const calls: unknown[][] = []
            setWindowFetch((...args: unknown[]) => {
                calls.push(args)
                return original
            })
            start()

            await expect(window.fetch('https://api.example.com/things')).resolves.toEqual({ status: 200 })
            await original
            expect(calls).toEqual([['https://api.example.com/things']])
        })

        it.each([
            ['a string url', ['https://api.example.com/things'], 'GET'],
            ['a URL object', [new URL('https://api.example.com/things')], 'GET'],
            ['a relative url', ['/things'], 'GET'],
            ['an init method', ['https://api.example.com/things', { method: 'post' }], 'POST'],
            ['a Request', [{ url: 'https://api.example.com/things', method: 'PUT' }], 'PUT'],
            [
                'a Request and an init method',
                [{ url: 'https://api.example.com/things', method: 'PUT' }, { method: 'DELETE' }],
                'DELETE',
            ],
        ])('records the request duration for %s', async (_, args, method) => {
            start()

            await window.fetch(...(args as [string]))

            expect(recorded()).toEqual([
                [
                    'http.client.request.duration',
                    expect.any(Number),
                    {
                        unit: 'ms',
                        attributes: {
                            'http.request.method': method,
                            'server.address': args[0] === '/things' ? 'localhost' : 'api.example.com',
                            'server.port': args[0] === '/things' ? 80 : 443,
                            'url.scheme': args[0] === '/things' ? 'http' : 'https',
                            'url.template': '/things',
                            'http.response.status_code': 200,
                        },
                    },
                ],
            ])
        })

        it.each([
            ['inline data', 'data:text/plain,inline-content'],
            ['blob', 'blob:https://example.com/8a0c1f98-f708-4f6b-b70c-4293cb88b97b'],
            ['local file', 'file:///tmp/example.txt'],
            ['custom protocol', 'app://renderer/orders'],
        ])('does not record %s URLs', async (_, url) => {
            start()

            await window.fetch(url)

            expect(recorded()).toEqual([])
        })

        it.each([
            ['/api/projects/123/tasks/550e8400-e29b-41d4-a716-446655440000/', '/api/projects/:id/tasks/:id/'],
            ['/api/things?limit=10&offset=20', '/api/things'],
            ['/api/things#section', '/api/things'],
            ['/api/keys/5f3a9c2e1b4d', '/api/keys/:id'],
            ['/api/skills/short-name/files/config.ts', '/api/skills/short-name/files/config.ts'],
            ['/invoices/38217.pdf', '/invoices/38217.pdf'],
            ['/customers/cus_a1b2c3d4e5', '/customers/cus_a1b2c3d4e5'],
            ['/api/v2/things', '/api/v2/things'],
            ['/', '/'],
        ])('replaces bare ids in the path and keeps other segments: %s -> %s', async (url, path) => {
            start()

            await window.fetch(url)

            expect(recorded()[0][2].attributes['url.template']).toBe(path)
        })

        it.each([
            ['https://api.example.com/things', 'https', 443],
            ['http://api.example.com/things', 'http', 80],
            ['https://api.example.com:8443/things', 'https', 8443],
            ['http://localhost:3000/things', 'http', 3000],
        ])('records the scheme and port of %s', async (url, scheme, port) => {
            start()

            await window.fetch(url)

            expect(recorded()[0][2].attributes).toMatchObject({ 'url.scheme': scheme, 'server.port': port })
        })

        it.each([
            [200, { 'http.response.status_code': 200 }],
            [302, { 'http.response.status_code': 302 }],
            [404, { 'http.response.status_code': 404, 'error.type': '404' }],
            [503, { 'http.response.status_code': 503, 'error.type': '503' }],
            [0, { 'error.type': '_OTHER' }],
        ])('records status %s as %o', async (status, expected) => {
            fetchMock.mockResolvedValue({ status })
            start()

            await window.fetch('https://api.example.com/things')

            const attributes = recorded()[0][2].attributes
            expect(attributes).toMatchObject(expected)
            expect('http.response.status_code' in attributes).toBe(status !== 0)
            expect('error.type' in attributes).toBe('error.type' in expected)
        })

        it.each([
            ['a TypeError', new TypeError('Failed to fetch'), 'TypeError'],
            ['an AbortError', new DOMException('Aborted', 'AbortError'), 'AbortError'],
            ['a non-error value', 'offline', '_OTHER'],
        ])(
            'records a fetch rejected with %s as the error type and leaves the rejection for the caller',
            async (_, failure, errorType) => {
                fetchMock.mockRejectedValue(failure)
                start()

                await expect(window.fetch('https://api.example.com/things')).rejects.toBe(failure)

                const attributes = recorded()[0][2].attributes
                expect(attributes['error.type']).toBe(errorType)
                expect('http.response.status_code' in attributes).toBe(false)
            }
        )

        it('records a request to a PostHog host when the page itself makes it', async () => {
            start()

            await window.fetch('https://us.i.posthog.com/api/projects/1/insights')

            expect(recorded()).toHaveLength(1)
        })

        it('normalizes an opaque fetch response status to undefined for callbacks', async () => {
            fetchMock.mockResolvedValue({ status: 0 })
            const attributes = vi.fn(() => ({}))
            start({ attributes })

            await window.fetch('https://api.example.com/things')

            expect(attributes).toHaveBeenCalledWith(expect.anything(), {
                status: undefined,
                durationMs: expect.any(Number),
            })
        })

        it('records once per instance when two instances enable network metrics', async () => {
            const otherHistogram = vi.fn()
            const other = {
                config: { metrics: { network: true } },
                metrics: { histogram: otherHistogram },
            } as unknown as PostHog

            start()
            const stopOther = startNetworkMetrics(other)
            try {
                await window.fetch('https://api.example.com/customer')

                expect(recorded()).toHaveLength(1)
                expect(otherHistogram).toHaveBeenCalledTimes(1)
            } finally {
                stopOther()
            }
        })

        it('records nothing after stop even when a third-party wrapper keeps it in place', async () => {
            start()
            const downstream = window.fetch
            setWindowFetch(function (...args: unknown[]) {
                return downstream(...args)
            })

            stop?.()
            stop = undefined

            await window.fetch('https://api.example.com/customer')

            expect(recorded()).toEqual([])
        })
    })

    describe('XMLHttpRequest', () => {
        it.each([
            ['get', 200, 'GET', { 'http.response.status_code': 200 }],
            ['POST', 500, 'POST', { 'http.response.status_code': 500, 'error.type': '500' }],
            ['delete', 0, 'DELETE', { 'error.type': '_OTHER' }],
        ])('records %s with status %s', (method, status, expectedMethod, outcome) => {
            start()

            sendXHR(method, 'https://api.example.com/things/42', status)

            expect(recorded()).toEqual([
                [
                    'http.client.request.duration',
                    expect.any(Number),
                    {
                        unit: 'ms',
                        attributes: {
                            'http.request.method': expectedMethod,
                            'server.address': 'api.example.com',
                            'server.port': 443,
                            'url.scheme': 'https',
                            'url.template': '/things/:id',
                            ...outcome,
                        },
                    },
                ],
            ])
        })

        it('still calls the original open and send', () => {
            start()
            const xhr = new window.XMLHttpRequest() as unknown as FakeXHR

            xhr.open('GET', 'https://api.example.com/things', true, 'user', 'pass')
            xhr.send('body')

            expect(openSpy).toHaveBeenCalledWith('GET', 'https://api.example.com/things', true, 'user', 'pass')
            expect(sendSpy).toHaveBeenCalledWith('body')
        })

        it("does not record the SDK's own XHRs", () => {
            start()
            const xhr = new window.XMLHttpRequest() as unknown as FakeXHR
            ;(isPostHogXHR as vi.Mock).mockImplementation((candidate: unknown) => candidate === xhr)

            xhr.open('POST', 'https://us.i.posthog.com/e/')
            xhr.send()
            xhr.respond(200)

            expect(recorded()).toEqual([])
        })

        it('records histogram exactly once per response when an XHR instance is reused', () => {
            start()
            const xhr = new window.XMLHttpRequest() as unknown as FakeXHR

            xhr.open('GET', 'https://api.example.com/things/1')
            xhr.send()
            xhr.respond(200)

            expect(recorded()).toHaveLength(1)
            expect(recorded()[0][2].attributes['url.template']).toBe('/things/:id')

            xhr.open('GET', 'https://api.example.com/things/2')
            xhr.send()
            xhr.respond(201)

            expect(recorded()).toHaveLength(2)
            expect(recorded()[1][2].attributes['url.template']).toBe('/things/:id')
        })

        it('handles send() with no prior open()', () => {
            start()
            const xhr = new window.XMLHttpRequest() as unknown as FakeXHR

            expect(() => xhr.send()).not.toThrow()
            expect(recorded()).toEqual([])
        })

        it('passes through a synchronous throw from the original send', () => {
            start()
            const xhr = new window.XMLHttpRequest() as unknown as FakeXHR
            const error = new Error('InvalidStateError')

            sendSpy.mockImplementationOnce(() => {
                throw error
            })

            xhr.open('GET', 'https://api.example.com/things')
            expect(() => xhr.send()).toThrow(error)

            xhr.send()
            xhr.respond(200)

            expect(recorded()).toHaveLength(1)
        })

        it('does not record an in-flight request after stop', () => {
            start()
            const xhr = new window.XMLHttpRequest() as unknown as FakeXHR

            xhr.open('GET', 'https://api.example.com/things')
            xhr.send()
            stop?.()
            stop = undefined
            xhr.respond(200)

            expect(recorded()).toEqual([])
        })
    })

    describe('config', () => {
        it('uses a string name as the metric name', async () => {
            start({ name: 'storefront.api.duration' })

            await window.fetch('https://api.example.com/things')

            expect(recorded()[0][0]).toBe('storefront.api.duration')
        })

        it('calls a name function with the request', async () => {
            const name = vi.fn(() => 'named.by.function')
            start({ name })

            await window.fetch('https://api.example.com/things?x=1', { method: 'POST' })

            expect(name).toHaveBeenCalledWith({ url: 'https://api.example.com/things?x=1', method: 'POST' })
            expect(recorded()[0][0]).toBe('named.by.function')
        })

        it.each([undefined, null, ''])('skips the request when the name function returns %s', async (name) => {
            start({ name: () => name as any })

            await window.fetch('https://api.example.com/things')

            expect(recorded()).toEqual([])
        })

        it('merges attributes from the attributes function over the defaults', async () => {
            fetchMock.mockResolvedValue({ status: 404 })
            const attributes = vi.fn(() => ({ route: '/tasks/$taskId', 'url.template': '/api/things/{id}' }))
            start({ attributes })

            await window.fetch('https://api.example.com/things/1')

            expect(attributes).toHaveBeenCalledWith(
                { url: 'https://api.example.com/things/1', method: 'GET' },
                { status: 404, durationMs: expect.any(Number) }
            )
            expect(recorded()[0][2].attributes).toEqual({
                'http.request.method': 'GET',
                'server.address': 'api.example.com',
                'server.port': 443,
                'url.scheme': 'https',
                'url.template': '/api/things/{id}',
                'http.response.status_code': 404,
                'error.type': '404',
                route: '/tasks/$taskId',
            })
        })

        it('normalises a fetch status of 0 to undefined for the attributes function', async () => {
            fetchMock.mockResolvedValue({ status: 0 })
            const attributes = vi.fn(() => ({}))
            start({ attributes })

            await window.fetch('https://api.example.com/things')

            expect(attributes).toHaveBeenCalledWith(expect.anything(), {
                status: undefined,
                durationMs: expect.any(Number),
            })
        })

        it('passes an undefined status to the attributes function when the fetch rejects', async () => {
            fetchMock.mockRejectedValue(new Error('offline'))
            const attributes = vi.fn(() => ({}))
            start({ attributes })

            await window.fetch('https://api.example.com/things').catch(() => {})

            expect(attributes).toHaveBeenCalledWith(expect.anything(), {
                status: undefined,
                durationMs: expect.any(Number),
            })
        })

        it('passes an undefined status to the attributes function when the XHR reports no response', () => {
            const attributes = vi.fn(() => ({}))
            start({ attributes })

            sendXHR('get', 'https://api.example.com/things', 0)

            expect(attributes).toHaveBeenCalledWith(expect.anything(), {
                status: undefined,
                durationMs: expect.any(Number),
            })
        })

        it('passes fetch through untouched when network metrics are turned off after start', async () => {
            const original = Promise.resolve({ status: 200 })
            setWindowFetch(() => original)
            start()
            mockPostHog.config.metrics = { network: false }

            const result = window.fetch('https://api.example.com/things')

            expect(result).toBe(original)
            await result
            expect(recorded()).toEqual([])
        })

        it('adds no XHR listener when network metrics are turned off after start', () => {
            start()
            mockPostHog.config.metrics = { network: false }
            const xhr = new window.XMLHttpRequest() as unknown as FakeXHR
            const addListener = vi.spyOn(xhr, 'addEventListener')

            xhr.open('GET', 'https://api.example.com/things')
            xhr.send()
            xhr.respond(200)

            expect(addListener).not.toHaveBeenCalled()
            expect(recorded()).toEqual([])
        })

        it('records nothing after stop', async () => {
            start()
            stop?.()
            stop = undefined

            await window.fetch('https://api.example.com/things')
            sendXHR('GET', 'https://api.example.com/things', 200)

            expect(recorded()).toEqual([])
            expect(fetchMock).toHaveBeenCalledTimes(1)
        })
    })

    describe('fails open', () => {
        it.each([
            [
                'the name function throws',
                {
                    name: () => {
                        throw new Error('boom')
                    },
                },
            ],
            [
                'the attributes function throws',
                {
                    attributes: () => {
                        throw new Error('boom')
                    },
                },
            ],
        ])('when %s the fetch result is unchanged', async (_, network) => {
            const original = Promise.resolve({ status: 200 })
            setWindowFetch(() => original)
            start(network as NetworkMetricsConfig)

            const result = window.fetch('https://api.example.com/things')

            await expect(result).resolves.toEqual({ status: 200 })
            expect(recorded()).toEqual([])
        })

        it('when histogram throws the fetch result is unchanged', async () => {
            histogram.mockImplementation(() => {
                throw new Error('boom')
            })
            start()

            await expect(window.fetch('https://api.example.com/things')).resolves.toEqual({ status: 200 })
        })

        it('when the request URL cannot be parsed the fetch still runs but is not recorded', async () => {
            start()

            await window.fetch('http://[')

            expect(fetchMock).toHaveBeenCalledTimes(1)
            expect(recorded()).toEqual([])
        })

        it('when the original fetch returns a non-promise it is passed through', () => {
            fetchMock.mockReturnValue('not a promise')
            start()

            expect(window.fetch('https://api.example.com/things')).toBe('not a promise')
        })

        it('when XHR open is given no url, the original open still runs', () => {
            start()
            const xhr = new window.XMLHttpRequest() as unknown as FakeXHR

            expect(() => (xhr.open as any)()).not.toThrow()
            expect(openSpy).toHaveBeenCalledTimes(1)
        })

        it('when fetch is missing, start does not throw', () => {
            setWindowFetch(undefined)

            expect(() => start()).not.toThrow()
        })
    })
})
