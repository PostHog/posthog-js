/// <reference lib="dom" />

import { TextDecoder } from 'util'
import * as fflate from 'fflate'
import { extendURLParams, request } from '../request'
import { Compression, RequestWithOptions } from '../types'
import { logger } from '@posthog/browser-common/utils/logger'

jest.mock('@posthog/browser-common/utils/globals', () => ({
    ...jest.requireActual('@posthog/browser-common/utils/globals'),
    fetch: jest.fn(),
    XMLHttpRequest: jest.fn(),
    navigator: {
        sendBeacon: jest.fn(),
    },
}))

import { fetch, XMLHttpRequest, navigator } from '@posthog/browser-common/utils/globals'
import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'

jest.mock('../config', () => ({ DEBUG: false, LIB_VERSION: '1.23.45', LIB_NAME: 'web' }))

const flushPromises = async () => {
    jest.useRealTimers()
    await new Promise((res) => setTimeout(res, 0))
    jest.useRealTimers()
}

const invalidGzipBody = () => new Uint8Array([0, 1, 2]).buffer
const bodyData = () => ({ key: uuidv7() })
const arrayOfBodyData = (n: number) => {
    const arr = []
    for (let i = 0; i < n; i++) {
        arr.push(bodyData())
    }
    return arr
}
const veryLargeBodyData = arrayOfBodyData(8024)

describe('request', () => {
    const mockedFetch: jest.MockedFunction<any> = fetch as jest.MockedFunction<any>
    const mockedXMLHttpRequest: jest.MockedFunction<any> = XMLHttpRequest as jest.MockedFunction<any>
    const mockedNavigator: jest.Mocked<typeof navigator> = navigator as jest.Mocked<typeof navigator>
    let mockedXHR = {
        open: jest.fn(),
        setRequestHeader: jest.fn(),
        onreadystatechange: jest.fn(),
        send: jest.fn(),
        readyState: 4,
        responseText: JSON.stringify('something here'),
        status: 200,
        withCredentials: false,
    }

    const now = 1700000000000

    const mockCallback = jest.fn()
    let createRequest: (overrides?: Partial<RequestWithOptions>) => RequestWithOptions
    let transport: RequestWithOptions['transport']

    beforeEach(() => {
        mockedXHR = {
            open: jest.fn(),
            setRequestHeader: jest.fn(),
            onreadystatechange: jest.fn(),
            send: jest.fn(),
            readyState: 4,
            responseText: JSON.stringify('something here'),
            status: 200,
            withCredentials: false,
        }
        mockedXMLHttpRequest.mockImplementation(() => mockedXHR)

        jest.useFakeTimers()
        jest.setSystemTime(now)

        createRequest = (overrides) => ({
            url: 'https://any.posthog-instance.com',
            data: undefined,
            headers: {},
            callback: mockCallback,
            transport,
            ...overrides,
        })
    })

    describe('xhr', () => {
        beforeEach(() => {
            transport = 'XHR'
        })
        it('performs the request with default params', () => {
            request(
                createRequest({
                    url: 'https://any.posthog-instance.com/',
                    headers: {
                        'x-header': 'value',
                    },
                })
            )
            expect(mockedXHR.open).toHaveBeenCalledWith('GET', 'https://any.posthog-instance.com/', true)

            expect(mockedXHR.setRequestHeader).toHaveBeenCalledWith('x-header', 'value')
        })

        it('calls the on callback handler when successful', async () => {
            mockedXHR.status = 200
            request(createRequest())
            mockedXHR.onreadystatechange?.({} as Event)
            expect(mockCallback).toHaveBeenCalledWith({
                statusCode: 200,
                json: 'something here',
                text: '"something here"',
            })
        })

        it('calls the callback even if json parsing fails', () => {
            //cannot use an auto-mock from jest as the code checks if onError is a Function
            request(createRequest())
            mockedXHR.status = 502
            mockedXHR.responseText = '{wat'
            mockedXHR.onreadystatechange?.({} as Event)
            expect(mockCallback).toHaveBeenCalledWith({
                statusCode: 502,
                json: undefined,
                text: '{wat',
            })
        })

        it('does not set XHR credentials', () => {
            request(createRequest())
            expect(mockedXHR.withCredentials).toBe(false)
        })

        it('reports JSON serialization failures through the callback instead of throwing', () => {
            const error = new RangeError('Invalid string length')
            const callback = jest.fn()
            const stringifySpy = jest.spyOn(JSON, 'stringify').mockImplementation(() => {
                throw error
            })

            try {
                expect(() =>
                    request(
                        createRequest({
                            method: 'POST',
                            data: { event: 'too-large' },
                            callback,
                        })
                    )
                ).not.toThrow()

                expect(callback).toHaveBeenCalledWith({ statusCode: 0, error })
                expect(mockedXMLHttpRequest).not.toHaveBeenCalled()
            } finally {
                stringifySpy.mockRestore()
            }
        })
    })

    describe('fetch', () => {
        beforeEach(() => {
            transport = 'fetch'
            mockedFetch.mockImplementation(() => {
                return Promise.resolve({
                    status: 200,
                    text: () => Promise.resolve('{ "a": 1 }'),
                }) as any
            })
        })

        it('performs the request with default params', () => {
            request(
                createRequest({
                    headers: {
                        'x-header': 'value',
                    },
                })
            )

            const headers = mockedFetch.mock.calls[0][1].headers as Headers
            expect(headers.get('x-header')).toEqual('value')
            expect(mockedFetch).toHaveBeenCalledWith(
                `https://any.posthog-instance.com`,
                expect.objectContaining({
                    body: undefined,
                    headers: new Headers(),
                    keepalive: false,
                    method: 'GET',
                })
            )
        })

        it('adds the cache-busting parameter only when requested', () => {
            request(
                createRequest({
                    url: 'https://any.posthog-instance.com/api/surveys/',
                    method: 'GET',
                    timestampMode: 'query',
                })
            )

            expect(mockedFetch.mock.calls[0][0]).toBe('https://any.posthog-instance.com/api/surveys/?_=1700000000000')
        })

        it.each([
            ['/e/', 'https://any.posthog-instance.com/e/'],
            ['/i/v0/e/', 'https://any.posthog-instance.com/i/v0/e/'],
            ['/batch/', 'https://any.posthog-instance.com/batch/'],
            ['/capture/', 'https://any.posthog-instance.com/capture/'],
            ['/track/', 'https://any.posthog-instance.com/track/'],
            ['/engage/', 'https://any.posthog-instance.com/engage/'],
        ])('adds sent_at to the capture body for analytics endpoint %s', (path, expectedUrl) => {
            const event = { event: 'test event', properties: { token: 'testtoken' } }
            request(
                createRequest({
                    url: `https://any.posthog-instance.com${path}`,
                    method: 'POST',
                    data: event,
                    timestampMode: 'capture-body',
                })
            )

            const [requestedUrl, requestOptions] = mockedFetch.mock.calls[0]
            expect(requestedUrl).toBe(expectedUrl)
            expect(requestedUrl).not.toContain('sent_at=')
            expect(requestedUrl).not.toContain('_=')
            expect(JSON.parse(requestOptions.body)).toEqual({
                api_key: 'testtoken',
                batch: [event],
                sent_at: '2023-11-14T22:13:20.000Z',
            })
        })

        it('puts batched analytics events in one sent_at body envelope', () => {
            const events = [
                { event: 'first event', properties: { token: 'testtoken' } },
                { event: 'second event', properties: { token: 'testtoken' } },
            ]
            request(
                createRequest({
                    url: 'https://any.posthog-instance.com/e/',
                    method: 'POST',
                    data: events,
                    timestampMode: 'capture-body',
                })
            )

            expect(JSON.parse(mockedFetch.mock.calls[0][1].body)).toEqual({
                api_key: 'testtoken',
                batch: events,
                sent_at: '2023-11-14T22:13:20.000Z',
            })
        })

        it('uses a top-level event token in the capture body envelope', () => {
            const event = { event: 'test event', token: 'testtoken' }
            request(
                createRequest({
                    url: 'https://any.posthog-instance.com/e/',
                    method: 'POST',
                    data: event,
                    timestampMode: 'capture-body',
                })
            )

            expect(JSON.parse(mockedFetch.mock.calls[0][1].body)).toEqual({
                api_key: 'testtoken',
                batch: [event],
                sent_at: '2023-11-14T22:13:20.000Z',
            })
        })

        it('keeps session recording bodies unchanged and adds sent_at to the query', () => {
            const recording = { event: '$snapshot' }
            request(
                createRequest({
                    url: 'https://any.posthog-instance.com/ingest/s/',
                    method: 'POST',
                    data: recording,
                    timestampMode: 'query',
                })
            )

            const [requestedUrl, requestOptions] = mockedFetch.mock.calls[0]
            expect(requestedUrl).toBe('https://any.posthog-instance.com/ingest/s/?sent_at=1700000000000')
            expect(JSON.parse(requestOptions.body)).toEqual(recording)
        })

        it('preserves caller-provided query parameters', () => {
            request(
                createRequest({
                    url: 'https://any.posthog-instance.com/e/?ver=1.23.45&foo=bar',
                    method: 'POST',
                    data: { event: 'test event', properties: { token: 'testtoken' } },
                    timestampMode: 'capture-body',
                })
            )

            const requestedUrl = mockedFetch.mock.calls[0][0]
            expect(requestedUrl).toBe('https://any.posthog-instance.com/e/?ver=1.23.45&foo=bar')
        })

        it('adds sent_at to the body of POST feature flag requests', () => {
            request(
                createRequest({
                    url: 'https://any.posthog-instance.com/flags/?v=2',
                    method: 'POST',
                    data: { token: 'testtoken', distinct_id: 'user-1' },
                    timestampMode: 'body',
                })
            )

            const [requestedUrl, requestOptions] = mockedFetch.mock.calls[0]
            expect(requestedUrl).toBe('https://any.posthog-instance.com/flags/?v=2')
            expect(JSON.parse(requestOptions.body)).toEqual({
                token: 'testtoken',
                distinct_id: 'user-1',
                sent_at: '2023-11-14T22:13:20.000Z',
            })
        })

        it('does not add sent_at to GET feature flag requests', () => {
            request(
                createRequest({
                    url: 'https://any.posthog-instance.com/flags/?v=2',
                    method: 'GET',
                })
            )

            expect(mockedFetch.mock.calls[0][0]).toBe('https://any.posthog-instance.com/flags/?v=2')
        })

        it.each([
            [
                'does not add a compression query param for gzip requests',
                'https://any.posthog-instance.com',
                'https://any.posthog-instance.com',
            ],
            [
                'removes an existing compression query param for gzip requests',
                'https://any.posthog-instance.com?compression=gzip-js',
                'https://any.posthog-instance.com',
            ],
        ])('%s', (_label, url, expectedUrl) => {
            request(
                createRequest({
                    url,
                    method: 'POST',
                    compression: Compression.GZipJS,
                    data: { foo: 'bar' },
                })
            )

            expect(mockedFetch.mock.calls[0][0]).toBe(expectedUrl)
        })

        it('calls the callback handler when successful', async () => {
            request(createRequest())
            await flushPromises()

            expect(mockedFetch).toHaveBeenCalledTimes(1)
            expect(mockCallback).toHaveBeenCalledWith({
                statusCode: 200,
                json: { a: 1 },
                text: '{ "a": 1 }',
            })
        })

        it('calls the callback even if json parsing fails', async () => {
            mockedFetch.mockImplementation(
                () =>
                    Promise.resolve({
                        status: 502,
                        text: () => Promise.resolve('oh no!'),
                    }) as any
            )

            request(createRequest())
            await flushPromises()

            //cannot use an auto-mock from jest as the code checks if onError is a Function
            expect(mockedFetch).toHaveBeenCalledTimes(1)

            expect(mockCallback).toHaveBeenCalledWith({
                statusCode: 502,
                json: undefined,
                text: 'oh no!',
            })
        })

        const invalidPreEncodedGzipRequest = (overrides?: Partial<RequestWithOptions>) =>
            createRequest({
                method: 'POST',
                compression: Compression.GZipJS,
                data: { foo: 'bar' },
                _encodedBody: {
                    contentType: 'text/plain',
                    body: invalidGzipBody(),
                    estimatedSize: 3,
                },
                ...overrides,
            } as any)

        it('falls back to JSON if gzip encoding throws before fetch send', async () => {
            const error = new Error('gzip failed')
            const gzipSpy = jest.spyOn(fflate, 'gzipSync').mockImplementation(() => {
                throw error
            })

            try {
                request(
                    createRequest({
                        method: 'POST',
                        compression: Compression.GZipJS,
                        data: { foo: 'bar' },
                    })
                )

                expect(mockedFetch).toHaveBeenCalledWith(
                    expect.not.stringContaining('compression=gzip-js'),
                    expect.objectContaining({
                        body: '{"foo":"bar"}',
                    })
                )
                expect((mockedFetch.mock.calls[0][1].headers as Headers).get('Content-Type')).toBe('application/json')
                expect(mockCallback).not.toHaveBeenCalledWith({ statusCode: 0, error })
            } finally {
                gzipSpy.mockRestore()
            }
        })

        it.each([
            [
                'fetch',
                { transport: 'fetch' as const },
                () => {
                    expect(mockedFetch.mock.calls[0][0]).not.toContain('compression=gzip-js')
                    expect(mockedFetch.mock.calls[0][1].body).toBe('{"foo":"bar"}')
                    expect((mockedFetch.mock.calls[0][1].headers as Headers).get('Content-Type')).toBe(
                        'application/json'
                    )
                },
            ],
            [
                'XHR',
                { transport: 'XHR' as const, url: 'https://any.posthog-instance.com/' },
                () => {
                    expect(mockedXHR.open.mock.calls[0][1]).not.toContain('compression=gzip-js')
                    expect(mockedXHR.send.mock.calls[0][0]).toBe('{"foo":"bar"}')
                    expect(mockedXHR.setRequestHeader).toHaveBeenCalledWith('Content-Type', 'application/json')
                },
            ],
            [
                // beacons cannot fall back to JSON: application/json requires a CORS
                // preflight, which never completes during page unload
                'sendBeacon',
                { transport: 'sendBeacon' as const, url: 'https://any.posthog-instance.com/' },
                async () => {
                    expect(mockedNavigator?.sendBeacon.mock.calls[0][0]).not.toContain('compression=gzip-js')
                    expect(mockedNavigator?.sendBeacon.mock.calls[0][0]).toContain('compression=base64')
                    const blob = mockedNavigator?.sendBeacon.mock.calls[0][1] as Blob
                    expect(blob.type).toBe('application/x-www-form-urlencoded')
                    const result = await new Promise<string>((resolve) => {
                        const reader = new FileReader()
                        reader.onload = () => resolve(reader.result as string)
                        reader.readAsText(blob)
                    })
                    expect(result).toBe('data=eyJmb28iOiJiYXIifQ%3D%3D')
                },
            ],
        ])(
            'falls back to a non-gzip encoding if a pre-encoded gzip body is not actually gzip before %s send',
            async (_name, overrides, assertTransport) => {
                request(invalidPreEncodedGzipRequest(overrides))
                await assertTransport()
            }
        )

        it('aborts with an identifiable reason on timeout and reports it via the callback', async () => {
            let capturedSignal: AbortSignal | undefined
            mockedFetch.mockImplementation((_url: string, opts: any) => {
                capturedSignal = opts.signal
                return new Promise((_resolve, reject) => {
                    // eslint-disable-next-line posthog-js/no-add-event-listener
                    opts.signal?.addEventListener('abort', () => reject(opts.signal.reason))
                })
            })

            const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {})
            const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {})

            const callback = jest.fn()
            request(createRequest({ callback, timeout: 8000 }))

            jest.advanceTimersByTime(8000)
            await flushPromises()

            expect(capturedSignal?.aborted).toBe(true)

            const reason = capturedSignal?.reason
            // keeps name AbortError so existing timeout handling (e.g. feature flag timeout detection) keeps working
            expect(reason.name).toBe('AbortError')
            // ...but with a descriptive message so it is never a reason-less "signal is aborted without reason"
            expect(reason.message).toBe('PostHog request timed out after 8000ms')
            expect(callback).toHaveBeenCalledTimes(1)
            const response = callback.mock.calls[0][0]
            expect(response.statusCode).toBe(0)
            expect(response.error.name).toBe('AbortError')
            expect(response.error.message).toBe('PostHog request timed out after 8000ms')

            // Our own timeout is expected (the queue retries), so it is logged at warn, not error -
            // which also keeps it out of error tracking's console-error capture.
            expect(warnSpy).toHaveBeenCalledWith(reason)
            expect(errorSpy).not.toHaveBeenCalled()

            warnSpy.mockRestore()
            errorSpy.mockRestore()
        })

        it('logs our own timeout at warn even when the browser does not propagate the abort reason', async () => {
            // Some browsers reject the fetch with a generic native `AbortError` DOMException instead
            // of the reason we passed to `controller.abort(...)`, so detection must not rely on the
            // reason reaching the rejection - only on `timedOut` + `name === 'AbortError'`.
            const nativeAbortError = new Error('The operation was aborted.')
            nativeAbortError.name = 'AbortError'
            mockedFetch.mockImplementation((_url: string, opts: any) => {
                return new Promise((_resolve, reject) => {
                    // eslint-disable-next-line posthog-js/no-add-event-listener
                    opts.signal?.addEventListener('abort', () => reject(nativeAbortError))
                })
            })

            const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {})
            const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {})

            const callback = jest.fn()
            request(createRequest({ callback, timeout: 8000 }))

            jest.advanceTimersByTime(8000)
            await flushPromises()

            expect(warnSpy).toHaveBeenCalledWith(nativeAbortError)
            expect(errorSpy).not.toHaveBeenCalled()
            expect(callback).toHaveBeenCalledWith({ statusCode: 0, error: nativeAbortError })

            warnSpy.mockRestore()
            errorSpy.mockRestore()
        })

        it('logs a genuine abort/network error at error, not warn, when we did not time out', async () => {
            // An `AbortError` we did not cause (e.g. the host app aborted, or the page unloaded)
            // must still be logged at error - `timedOut` is false so it is not treated as our timeout.
            const foreignAbortError = new Error('The operation was aborted.')
            foreignAbortError.name = 'AbortError'
            mockedFetch.mockImplementation(() => Promise.reject(foreignAbortError))

            const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {})
            const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {})

            const callback = jest.fn()
            request(createRequest({ callback, timeout: 8000 }))

            await flushPromises()

            expect(errorSpy).toHaveBeenCalledWith(foreignAbortError)
            expect(warnSpy).not.toHaveBeenCalled()
            expect(callback).toHaveBeenCalledWith({ statusCode: 0, error: foreignAbortError })

            warnSpy.mockRestore()
            errorSpy.mockRestore()
        })

        it.each([
            ['Failed to fetch', 'Failed to fetch'],
            ['Firefox NetworkError', 'NetworkError when attempting to fetch resource.'],
            ['Safari Load failed', 'Load failed'],
        ])('logs a benign network-level TypeError (%s) at warn, not error', async (_label, message) => {
            // A network-layer failure (ad blocker, dropped connection, CORS, page teardown)
            // rejects with a generic `TypeError`. The request queue retries it, so it is
            // expected noise and logs at `warn`, not `error`.
            const networkError = new TypeError(message)
            mockedFetch.mockImplementation(() => Promise.reject(networkError))

            const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {})
            const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {})

            const callback = jest.fn()
            request(createRequest({ callback }))

            await flushPromises()

            expect(warnSpy).toHaveBeenCalledWith(networkError)
            expect(errorSpy).not.toHaveBeenCalled()
            expect(callback).toHaveBeenCalledWith({ statusCode: 0, error: networkError })

            warnSpy.mockRestore()
            errorSpy.mockRestore()
        })

        it('logs a genuine unexpected error at error, not warn', async () => {
            // A `TypeError` whose message is not a known network-failure phrase, or any other
            // unexpected error, is a real bug and must stay on the error path.
            const genuineError = new TypeError("Cannot read properties of undefined (reading 'x')")
            mockedFetch.mockImplementation(() => Promise.reject(genuineError))

            const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {})
            const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {})

            const callback = jest.fn()
            request(createRequest({ callback }))

            await flushPromises()

            expect(errorSpy).toHaveBeenCalledWith(genuineError)
            expect(warnSpy).not.toHaveBeenCalled()
            expect(callback).toHaveBeenCalledWith({ statusCode: 0, error: genuineError })

            warnSpy.mockRestore()
            errorSpy.mockRestore()
        })

        it('does not let a synchronously-throwing monkey-patched fetch escape as an unhandled exception', () => {
            // Some third-party scripts (e.g. a Shopify storefront listener) wrap `window.fetch` in a
            // shim that throws *synchronously* instead of returning a rejected promise. Because we can
            // call `_fetch` synchronously inside the host app's stack (web experiments via
            // `onFeatureFlags`), that throw would otherwise propagate out of `request(...)` and get
            // captured by error tracking. It must be routed through the same handling as an async
            // rejection: classified as a benign network error, logged at warn, and reported via the
            // callback so the queue retries.
            const networkError = new TypeError('Failed to fetch')
            mockedFetch.mockImplementation(() => {
                throw networkError
            })

            const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {})
            const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {})

            const callback = jest.fn()
            expect(() => request(createRequest({ callback }))).not.toThrow()

            expect(warnSpy).toHaveBeenCalledWith(networkError)
            expect(errorSpy).not.toHaveBeenCalled()
            expect(callback).toHaveBeenCalledWith({ statusCode: 0, error: networkError })

            warnSpy.mockRestore()
            errorSpy.mockRestore()
        })

        it('routes a synchronous non-network throw through the error path without escaping', () => {
            const genuineError = new TypeError("Cannot read properties of undefined (reading 'x')")
            mockedFetch.mockImplementation(() => {
                throw genuineError
            })

            const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {})
            const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {})

            const callback = jest.fn()
            expect(() => request(createRequest({ callback }))).not.toThrow()

            expect(errorSpy).toHaveBeenCalledWith(genuineError)
            expect(warnSpy).not.toHaveBeenCalled()
            expect(callback).toHaveBeenCalledWith({ statusCode: 0, error: genuineError })

            warnSpy.mockRestore()
            errorSpy.mockRestore()
        })

        it('supports nextOptions parameter', async () => {
            request(
                createRequest({
                    fetchOptions: { cache: 'force-cache', next: { revalidate: 0, tags: ['test'] } },
                })
            )
            await flushPromises()

            expect(mockedFetch).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    cache: 'force-cache',
                    next: { revalidate: 0, tags: ['test'] },
                })
            )
        })

        describe('keepalive with fetch and large bodies can cause some browsers to reject network calls', () => {
            it.each([
                ['always keepalive with small json POST', 'POST', 'small', undefined, true, ''],
                ['always keepalive with small gzip POST', 'POST', 'small', Compression.GZipJS, true, ''],
                [
                    'always keepalive with small base64 POST',
                    'POST',
                    'small',
                    Compression.Base64,
                    true,
                    '?compression=base64',
                ],
                ['never keepalive with GET', 'GET', undefined, Compression.GZipJS, false, ''],
                ['never keepalive with large JSON POST', 'POST', veryLargeBodyData, undefined, false, ''],
                ['never keepalive with large GZIP POST', 'POST', veryLargeBodyData, Compression.GZipJS, false, ''],
                [
                    'never keepalive with large base64 POST',
                    'POST',
                    veryLargeBodyData,
                    Compression.Base64,
                    false,
                    '?compression=base64',
                ],
            ])(
                `uses keep alive: %s`,
                (
                    _name: string,
                    method: 'POST' | 'GET',
                    body: any,
                    compression: Compression | undefined,
                    expectedKeepAlive: boolean,
                    expectedURLParams: string
                ) => {
                    request(
                        createRequest({
                            headers: {
                                'x-header': 'value',
                            },
                            method,
                            compression,
                            data: body,
                        })
                    )
                    expect(mockedFetch).toHaveBeenCalledWith(
                        `https://any.posthog-instance.com${expectedURLParams}`,
                        expect.objectContaining({
                            headers: new Headers(),
                            keepalive: expectedKeepAlive,
                            method,
                        })
                    )
                }
            )

            it('is used as a fallback when the requested transport is disabled', async () => {
                request(
                    createRequest({
                        transport: 'sendBeacon',
                        disableTransport: ['sendBeacon'],
                    })
                )
                expect(mockedFetch).toHaveBeenCalled()
            })
        })

        describe('adding query params to posthog API calls', () => {
            const posthogURL = 'https://any.posthog-instance.com/my-url'

            it('extends params in a url', () => {
                const newUrl = extendURLParams(posthogURL, {
                    a: true,
                    b: 1,
                    c: 'encoded string 😘',
                })
                expect(newUrl).toEqual(posthogURL + '?a=true&b=1&c=encoded%20string%20%F0%9F%98%98')
            })

            it.each([
                [
                    'replaces existing params when replace=true (default)',
                    posthogURL + '?a=old&b=2',
                    { a: 'new', c: 3 },
                    true,
                    posthogURL + '?a=new&b=2&c=3',
                ],
                [
                    'preserves existing params when replace=false',
                    posthogURL + '?a=old&b=2',
                    { a: 'new', c: 'encoded string 😘' },
                    false,
                    posthogURL + '?a=old&b=2&c=encoded%20string%20%F0%9F%98%98',
                ],
                [
                    'replaces multiple existing params when replace=true',
                    posthogURL + '?retry_count=1&ver=old',
                    { retry_count: 2, ver: 'new' },
                    true,
                    posthogURL + '?retry_count=2&ver=new',
                ],
                [
                    'preserves multiple existing params when replace=false',
                    posthogURL + '?retry_count=1&ver=old',
                    { retry_count: 2, ver: 'new' },
                    false,
                    posthogURL + '?retry_count=1&ver=old',
                ],
                [
                    'does not re-encode already encoded params',
                    posthogURL + '?a=false&b=1&c=encoded%20string%20%F0%9F%98%98',
                    { retry_count: 2, ver: 'new' },
                    true,
                    posthogURL + '?a=false&b=1&c=encoded%20string%20%F0%9F%98%98&retry_count=2&ver=new',
                ],
            ])(
                '%s',
                (_name: string, url: string, params: Record<string, any>, replace: boolean, expectedUrl: string) => {
                    const newUrl = extendURLParams(url, params, replace)
                    expect(newUrl).toEqual(expectedUrl)
                }
            )
        })

        describe('body encoding', () => {
            beforeEach(() => {
                transport = 'XHR'
            })

            it('should send application/json if no compression is set', () => {
                request(
                    createRequest({
                        url: 'https://any.posthog-instance.com/',
                        method: 'POST',
                        data: { foo: 'bar' },
                    })
                )
                expect(mockedXHR.send.mock.calls[0][0]).toMatchInlineSnapshot(`"{"foo":"bar"}"`)
                expect(mockedXHR.setRequestHeader).toHaveBeenCalledWith('Content-Type', 'application/json')
            })

            it('should base64 compress data if set', () => {
                request(
                    createRequest({
                        url: 'https://any.posthog-instance.com/',
                        method: 'POST',
                        compression: Compression.Base64,
                        data: { foo: 'bar' },
                    })
                )
                expect(mockedXHR.send.mock.calls[0][0]).toMatchInlineSnapshot(`"data=eyJmb28iOiJiYXIifQ%3D%3D"`)
                expect(mockedXHR.setRequestHeader).toHaveBeenCalledWith(
                    'Content-Type',
                    'application/x-www-form-urlencoded'
                )
            })

            it('should gzip compress data if set', async () => {
                request(
                    createRequest({
                        url: 'https://any.posthog-instance.com/',
                        method: 'POST',
                        compression: Compression.GZipJS,
                        data: { foo: 'bar' },
                    })
                )
                expect(mockedXHR.send).toHaveBeenCalledTimes(1)
                expect(mockedXHR.send.mock.calls[0][0]).toBeInstanceOf(ArrayBuffer)
                // Decode and check the ArrayBuffer content

                const res = new TextDecoder().decode(mockedXHR.send.mock.calls[0][0] as ArrayBuffer)

                expect(res).toMatchInlineSnapshot(`
                "�      �VJ��W�RJJ,R� ��+�
                   "
            `)

                expect(mockedXHR.setRequestHeader).not.toHaveBeenCalledWith(
                    'Content-Type',
                    'application/x-www-form-urlencoded'
                )
            })

            it('converts bigint properties to string without throwing', () => {
                request(
                    createRequest({
                        url: 'https://any.posthog-instance.com/',
                        method: 'POST',
                        compression: Compression.Base64,
                        data: { foo: BigInt('999999999999999999999') },
                    })
                )
                expect(mockedXHR.send.mock.calls[0][0]).toMatchInlineSnapshot(
                    `"data=eyJmb28iOiI5OTk5OTk5OTk5OTk5OTk5OTk5OTkifQ%3D%3D"`
                )
                expect(mockedXHR.setRequestHeader).toHaveBeenCalledWith(
                    'Content-Type',
                    'application/x-www-form-urlencoded'
                )
            })

            it('does not throw on circular references and serializes them as [Circular]', () => {
                const circular: any = { foo: 'bar' }
                circular.self = circular
                request(
                    createRequest({
                        url: 'https://any.posthog-instance.com/',
                        method: 'POST',
                        data: circular,
                    })
                )
                expect(mockedXHR.send.mock.calls[0][0]).toMatchInlineSnapshot(`"{"foo":"bar","self":"[Circular]"}"`)
            })

            it('does not throw when a property is a circular DOM node (e.g. a React fiber back-reference)', () => {
                // Mimics a DOM element that retains a React fiber which points back at the element —
                // exactly what makes plain JSON.stringify throw "Converting circular structure to JSON".
                const el: any = { tagName: 'A', nodeType: 1 }
                el.__reactFiber = { stateNode: el }
                expect(() =>
                    request(
                        createRequest({
                            url: 'https://any.posthog-instance.com/',
                            method: 'POST',
                            data: { $el: el },
                        })
                    )
                ).not.toThrow()
                expect(mockedXHR.send).toHaveBeenCalledTimes(1)
            })

            it('keeps shared-but-acyclic references while replacing only true cycles', () => {
                const shared = { n: 1 }
                const data: any = { a: shared, b: shared }
                data.self = data // the only real cycle
                request(
                    createRequest({
                        url: 'https://any.posthog-instance.com/',
                        method: 'POST',
                        data,
                    })
                )
                const body = JSON.parse(mockedXHR.send.mock.calls[0][0] as string)
                expect(body.a).toEqual({ n: 1 })
                expect(body.b).toEqual({ n: 1 })
                expect(body.self).toBe('[Circular]')
            })
        })

        describe('sendBeacon', () => {
            beforeEach(() => {
                transport = 'sendBeacon'
            })

            it('base64-encodes uncompressed POST data so the content type stays CORS-simple', async () => {
                request(
                    createRequest({
                        url: 'https://any.posthog-instance.com/',
                        method: 'POST',
                        data: { foo: 'bar' },
                    })
                )

                expect(mockedNavigator?.sendBeacon).toHaveBeenCalledWith(
                    'https://any.posthog-instance.com/?compression=base64',
                    expect.any(Blob)
                )
                const blob = mockedNavigator?.sendBeacon.mock.calls[0][1] as Blob
                expect(blob.type).toBe('application/x-www-form-urlencoded')

                const reader = new FileReader()
                const result = await new Promise((resolve) => {
                    reader.onload = () => resolve(reader.result)
                    reader.readAsText(blob)
                })

                expect(result).toMatchInlineSnapshot(`"data=eyJmb28iOiJiYXIifQ%3D%3D"`)
            })

            it('should respect base64 compression', async () => {
                request(
                    createRequest({
                        url: 'https://any.posthog-instance.com/',
                        method: 'POST',
                        compression: Compression.Base64,
                        data: { foo: 'bar' },
                    })
                )

                expect(mockedNavigator?.sendBeacon).toHaveBeenCalledWith(
                    'https://any.posthog-instance.com/?compression=base64',
                    expect.any(Blob)
                )
                const blob = mockedNavigator?.sendBeacon.mock.calls[0][1] as Blob
                expect(blob.type).toBe('application/x-www-form-urlencoded')

                const reader = new FileReader()
                const result = await new Promise((resolve) => {
                    reader.onload = () => resolve(reader.result)
                    reader.readAsText(blob)
                })

                expect(result).toMatchInlineSnapshot(`"data=eyJmb28iOiJiYXIifQ%3D%3D"`)
            })

            it('should respect gzip compression', async () => {
                request(
                    createRequest({
                        url: 'https://any.posthog-instance.com/',
                        method: 'POST',
                        compression: Compression.GZipJS,
                        data: { foo: 'bar' },
                    })
                )

                expect(mockedNavigator?.sendBeacon).toHaveBeenCalledWith(
                    'https://any.posthog-instance.com/',
                    expect.any(Blob)
                )
                const blob = mockedNavigator?.sendBeacon.mock.calls[0][1] as Blob
                expect(blob.type).toBe('text/plain')
                const result = await new Promise<string>((resolve) => {
                    const reader = new FileReader()
                    reader.onload = () => resolve(reader.result as string)
                    reader.readAsText(blob)
                })

                expect(result).toMatchInlineSnapshot(`
                "�      �VJ��W�RJJ,R� ��+�
                   "
            `)
            })

            it('falls back to base64 if gzip encoding throws before the beacon send', () => {
                const gzipSpy = jest.spyOn(fflate, 'gzipSync').mockImplementation(() => {
                    throw new Error('gzip failed')
                })

                try {
                    request(
                        createRequest({
                            url: 'https://any.posthog-instance.com/',
                            method: 'POST',
                            compression: Compression.GZipJS,
                            data: { foo: 'bar' },
                        })
                    )

                    expect(mockedNavigator?.sendBeacon).toHaveBeenCalledTimes(1)
                    expect(mockedNavigator?.sendBeacon.mock.calls[0][0]).toContain('compression=base64')
                    const blob = mockedNavigator?.sendBeacon.mock.calls[0][1] as Blob
                    expect(blob.type).toBe('application/x-www-form-urlencoded')
                } finally {
                    gzipSpy.mockRestore()
                }
            })

            describe('quota rejection (sendBeacon returns false)', () => {
                const bigEvent = (i: number) => ({
                    event: 'big',
                    i,
                    payload: 'x'.repeat(8 * 1024),
                    properties: { token: 'testtoken' },
                })
                let warnSpy: jest.SpyInstance

                beforeEach(() => {
                    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {})
                    mockedFetch.mockImplementation(() =>
                        Promise.resolve({ status: 200, text: () => Promise.resolve('{}') })
                    )
                })

                afterEach(() => {
                    warnSpy.mockRestore()
                })

                it('splits a rejected sent_at body envelope in half and re-sends each piece', async () => {
                    mockedNavigator!.sendBeacon.mockReturnValueOnce(false).mockReturnValue(true)

                    request(
                        createRequest({
                            method: 'POST',
                            data: [bigEvent(1), bigEvent(2), bigEvent(3), bigEvent(4)],
                            timestampMode: 'capture-body',
                        })
                    )

                    expect(mockedNavigator?.sendBeacon).toHaveBeenCalledTimes(3)
                    const [full, firstHalf, secondHalf] = mockedNavigator!.sendBeacon.mock.calls.map(
                        (c) => (c[1] as Blob).size
                    )
                    expect(firstHalf).toBeLessThan(full)
                    expect(secondHalf).toBeLessThan(full)

                    const splitBodies = await Promise.all(
                        mockedNavigator!.sendBeacon.mock.calls.slice(1).map(async (call) => {
                            const text = await new Promise<string>((resolve) => {
                                const reader = new FileReader()
                                reader.onload = () => resolve(reader.result as string)
                                reader.readAsText(call[1] as Blob)
                            })
                            return JSON.parse(
                                Buffer.from(decodeURIComponent(text.slice('data='.length)), 'base64').toString()
                            )
                        })
                    )
                    expect(splitBodies).toEqual([
                        {
                            api_key: 'testtoken',
                            batch: [bigEvent(1), bigEvent(2)],
                            sent_at: '2023-11-14T22:13:20.000Z',
                        },
                        {
                            api_key: 'testtoken',
                            batch: [bigEvent(3), bigEvent(4)],
                            sent_at: '2023-11-14T22:13:20.000Z',
                        },
                    ])
                    expect(mockedFetch).not.toHaveBeenCalled()
                })

                it('splits recursively and falls back to fetch for single events that still do not fit', () => {
                    mockedNavigator!.sendBeacon.mockReturnValue(false)

                    request(
                        createRequest({
                            method: 'POST',
                            data: [bigEvent(1), bigEvent(2), bigEvent(3), bigEvent(4)],
                        })
                    )

                    // 1 full + 2 halves + 4 singles
                    expect(mockedNavigator?.sendBeacon).toHaveBeenCalledTimes(7)
                    expect(mockedFetch).toHaveBeenCalledTimes(4)
                    expect(warnSpy).toHaveBeenCalledTimes(4)
                    for (const call of mockedFetch.mock.calls) {
                        expect(call[1].keepalive).toBe(false)
                    }
                })

                it('does not split a rejected small batch, the quota is already exhausted', () => {
                    mockedNavigator!.sendBeacon.mockReturnValue(false)

                    request(
                        createRequest({
                            method: 'POST',
                            data: [
                                { event: 'small', i: 1 },
                                { event: 'small', i: 2 },
                            ],
                        })
                    )

                    expect(mockedNavigator?.sendBeacon).toHaveBeenCalledTimes(1)
                    expect(mockedFetch).toHaveBeenCalledTimes(1)
                    expect(mockedFetch.mock.calls[0][1].keepalive).toBe(false)
                })
            })

            it('warns instead of throwing when the beacon call itself throws', () => {
                const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {})
                mockedNavigator!.sendBeacon.mockImplementation(() => {
                    throw new Error('boom')
                })

                try {
                    expect(() => request(createRequest({ method: 'POST', data: { foo: 'bar' } }))).not.toThrow()
                    expect(warnSpy).toHaveBeenCalledWith('Beacon send failed', expect.any(Error))
                } finally {
                    warnSpy.mockRestore()
                }
            })

            it('should not call sendBeacon when body is undefined', () => {
                request(
                    createRequest({
                        url: 'https://any.posthog-instance.com/',
                        method: 'POST',
                        data: undefined,
                    })
                )

                expect(mockedNavigator?.sendBeacon).not.toHaveBeenCalled()
            })

            it.each([
                // Every content type here must be CORS-simple: a preflight cannot complete while
                // the page unloads, so a preflighted beacon (e.g. application/json) is silently
                // dropped by the browser on cross-origin hosts and its events are lost.
                ['no compression', undefined, 'application/x-www-form-urlencoded'],
                ['base64 compression', Compression.Base64, 'application/x-www-form-urlencoded'],
                ['gzip compression', Compression.GZipJS, 'text/plain'],
            ])(
                'always sends a Blob with correct Content-Type for %s',
                (_name: string, compression: Compression | undefined, expectedContentType: string) => {
                    request(
                        createRequest({
                            url: 'https://any.posthog-instance.com/',
                            method: 'POST',
                            compression,
                            data: { event: 'test' },
                        })
                    )

                    expect(mockedNavigator?.sendBeacon).toHaveBeenCalledTimes(1)
                    const body = mockedNavigator?.sendBeacon.mock.calls[0][1]

                    // The body must always be a Blob so the browser sets the Content-Type header.
                    // Sending a raw ArrayBuffer (as happened before the fix in #3297) causes the
                    // browser to omit Content-Type, which breaks proxies/WAFs/CDNs that require it.
                    expect(body).toBeInstanceOf(Blob)
                    expect((body as Blob).type).toBe(expectedContentType)
                }
            )
        })
    })

    describe('native async gzip retry flow', () => {
        let isolatedRequestModule: any
        let isolatedCompression: typeof Compression
        let mockedIsolatedFetch: jest.Mock
        let mockedIsolatedGzipCompress: jest.Mock

        beforeEach(async () => {
            jest.resetModules()
            jest.clearAllMocks()
            jest.useFakeTimers()
            jest.setSystemTime(now)

            mockedIsolatedFetch = jest.fn(() =>
                Promise.resolve({
                    status: 200,
                    text: () => Promise.resolve('{ "a": 1 }'),
                })
            )
            mockedIsolatedGzipCompress = jest.fn()

            jest.doMock('@posthog/browser-common/utils/globals', () => ({
                ...jest.requireActual('@posthog/browser-common/utils/globals'),
                fetch: mockedIsolatedFetch,
                XMLHttpRequest: jest.fn(),
                navigator: {
                    sendBeacon: jest.fn(),
                },
                CompressionStream: jest.fn(),
            }))

            jest.doMock('@posthog/core', () => ({
                ...jest.requireActual('@posthog/core'),
                gzipCompress: mockedIsolatedGzipCompress,
                isNativeAsyncGzipError: (error: unknown) =>
                    error &&
                    typeof error === 'object' &&
                    'name' in error &&
                    (error.name === 'NotReadableError' || error.name === 'NativeGzipValidationError'),
            }))

            isolatedRequestModule = await import('../request')
            isolatedCompression = (await import('../types')).Compression
        })

        it('retries uncompressed without dropping the capture envelope after NotReadableError', async () => {
            mockedIsolatedGzipCompress.mockRejectedValueOnce({ name: 'NotReadableError' })
            const event = { event: 'test event', properties: { token: 'testtoken' } }

            isolatedRequestModule.request({
                url: 'https://any.posthog-instance.com/e/',
                data: event,
                headers: {},
                callback: jest.fn(),
                transport: 'fetch',
                method: 'POST',
                compression: isolatedCompression.GZipJS,
                timestampMode: 'capture-body',
            })

            await flushPromises()

            expect(mockedIsolatedGzipCompress).toHaveBeenCalledTimes(1)
            expect(mockedIsolatedFetch).toHaveBeenCalledTimes(1)
            expect(mockedIsolatedFetch.mock.calls[0][0]).toBe('https://any.posthog-instance.com/e/')
            expect(JSON.parse(mockedIsolatedFetch.mock.calls[0][1].body)).toEqual({
                api_key: 'testtoken',
                batch: [event],
                sent_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
            })

            mockedIsolatedFetch.mockClear()

            isolatedRequestModule.request({
                url: 'https://any.posthog-instance.com',
                data: { foo: 'baz' },
                headers: {},
                callback: jest.fn(),
                transport: 'fetch',
                method: 'POST',
                compression: isolatedCompression.GZipJS,
            })

            await flushPromises()

            expect(mockedIsolatedGzipCompress).toHaveBeenCalledTimes(1)
            expect(mockedIsolatedFetch).toHaveBeenCalledTimes(1)
            expect(mockedIsolatedFetch.mock.calls[0][0]).not.toContain('&compression=gzip-js')
            expect(mockedIsolatedFetch.mock.calls[0][1].body).toBeInstanceOf(ArrayBuffer)
        })

        it('falls back to fflate and disables native async gzip after invalid native gzip output', async () => {
            mockedIsolatedGzipCompress.mockRejectedValueOnce({ name: 'NativeGzipValidationError' })

            isolatedRequestModule.request({
                url: 'https://any.posthog-instance.com',
                data: { foo: 'bar' },
                headers: {},
                callback: jest.fn(),
                transport: 'fetch',
                method: 'POST',
                compression: isolatedCompression.GZipJS,
            })

            await flushPromises()

            expect(mockedIsolatedGzipCompress).toHaveBeenCalledTimes(1)
            expect(mockedIsolatedFetch).toHaveBeenCalledTimes(1)
            expect(mockedIsolatedFetch.mock.calls[0][0]).not.toContain('&compression=gzip-js')
            expect(mockedIsolatedFetch.mock.calls[0][1].body).toBeInstanceOf(ArrayBuffer)

            mockedIsolatedFetch.mockClear()

            isolatedRequestModule.request({
                url: 'https://any.posthog-instance.com',
                data: { foo: 'baz' },
                headers: {},
                callback: jest.fn(),
                transport: 'fetch',
                method: 'POST',
                compression: isolatedCompression.GZipJS,
            })

            await flushPromises()

            expect(mockedIsolatedGzipCompress).toHaveBeenCalledTimes(1)
            expect(mockedIsolatedFetch).toHaveBeenCalledTimes(1)
            expect(mockedIsolatedFetch.mock.calls[0][0]).not.toContain('&compression=gzip-js')
            expect(mockedIsolatedFetch.mock.calls[0][1].body).toBeInstanceOf(ArrayBuffer)
        })

        it('falls back to JSON if native async gzip resolves a non-gzip body before sending', async () => {
            mockedIsolatedGzipCompress.mockResolvedValueOnce({
                arrayBuffer: () => Promise.resolve(invalidGzipBody()),
            })

            isolatedRequestModule.request({
                url: 'https://any.posthog-instance.com',
                data: { foo: 'bar' },
                headers: {},
                callback: jest.fn(),
                transport: 'fetch',
                method: 'POST',
                compression: isolatedCompression.GZipJS,
            })

            await flushPromises()

            expect(mockedIsolatedGzipCompress).toHaveBeenCalledTimes(1)
            expect(mockedIsolatedFetch).toHaveBeenCalledTimes(1)
            expect(mockedIsolatedFetch.mock.calls[0][0]).not.toContain('&compression=gzip-js')
            expect(mockedIsolatedFetch.mock.calls[0][1].body).toBe('{"foo":"bar"}')
        })

        it('starts with native async gzip enabled in a fresh module instance', async () => {
            mockedIsolatedGzipCompress.mockResolvedValueOnce({
                arrayBuffer: () => Promise.resolve(new Uint8Array([0x1f, 0x8b]).buffer),
            })

            isolatedRequestModule.request({
                url: 'https://any.posthog-instance.com',
                data: { foo: 'baz' },
                headers: {},
                callback: jest.fn(),
                transport: 'fetch',
                method: 'POST',
                compression: isolatedCompression.GZipJS,
            })

            await flushPromises()

            expect(mockedIsolatedGzipCompress).toHaveBeenCalledTimes(1)
            expect(mockedIsolatedFetch).toHaveBeenCalledTimes(1)
            expect(mockedIsolatedFetch.mock.calls[0][0]).not.toContain('&compression=gzip-js')
            expect(mockedIsolatedFetch.mock.calls[0][1].body).toBeInstanceOf(ArrayBuffer)
        })
    })
})
