/* eslint-disable compat/compat */
/// <reference lib="dom" />

import { TextDecoder } from 'util'
import * as fflate from 'fflate'
import { extendURLParams, request } from '../request'
import { Compression, RequestWithOptions } from '../types'
import { logger } from '../utils/logger'

jest.mock('../utils/globals', () => ({
    ...jest.requireActual('../utils/globals'),
    fetch: jest.fn(),
    XMLHttpRequest: jest.fn(),
    navigator: {
        sendBeacon: jest.fn(),
    },
}))

import { fetch, XMLHttpRequest, navigator } from '../utils/globals'
import { uuidv7 } from '../uuidv7'

jest.mock('../config', () => ({ DEBUG: false, LIB_VERSION: '1.23.45', LIB_NAME: 'web', JS_SDK_VERSION: '1.23.45' }))

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
            url: 'https://any.posthog-instance.com?ver=1.23.45',
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
            expect(mockedXHR.open).toHaveBeenCalledWith(
                'GET',
                'https://any.posthog-instance.com/?_=1700000000000&ver=1.23.45',
                true
            )

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
                `https://any.posthog-instance.com?ver=1.23.45&_=1700000000000`,
                expect.objectContaining({
                    body: undefined,
                    headers: new Headers(),
                    keepalive: false,
                    method: 'GET',
                })
            )
        })

        it.each(['/e/', '/s/', '/i/v0/e/', '/i/v0/s/'])('does not add ver to browser capture endpoint %s', (path) => {
            request(
                createRequest({
                    url: `https://any.posthog-instance.com${path}`,
                })
            )

            const requestedUrl = mockedFetch.mock.calls[0][0]
            expect(requestedUrl).toContain('_=1700000000000')
            expect(requestedUrl).not.toContain('ver=')
        })

        it('does not add ver to proxied capture endpoints', () => {
            request(
                createRequest({
                    url: 'https://any.posthog-instance.com/ingest/s/',
                })
            )

            const requestedUrl = mockedFetch.mock.calls[0][0]
            expect(requestedUrl).toBe('https://any.posthog-instance.com/ingest/s/?_=1700000000000')
        })

        it('does not rely on String.prototype.endsWith for capture endpoint matching', () => {
            const originalEndsWith = String.prototype.endsWith
            // Simulate older browsers where String.prototype.endsWith is unavailable.
            delete (String.prototype as any).endsWith

            try {
                request(
                    createRequest({
                        url: 'https://any.posthog-instance.com/e/',
                    })
                )

                const requestedUrl = mockedFetch.mock.calls[0][0]
                expect(requestedUrl).toBe('https://any.posthog-instance.com/e/?_=1700000000000')
            } finally {
                String.prototype.endsWith = originalEndsWith
            }
        })

        it('removes existing ver from capture endpoints', () => {
            request(
                createRequest({
                    url: 'https://any.posthog-instance.com/e/?ver=1.23.45&foo=bar',
                })
            )

            const requestedUrl = mockedFetch.mock.calls[0][0]
            expect(requestedUrl).toBe('https://any.posthog-instance.com/e/?foo=bar&_=1700000000000')
        })

        it('keeps ver on feature flag requests', () => {
            request(
                createRequest({
                    url: 'https://any.posthog-instance.com/flags/?v=2',
                })
            )

            expect(mockedFetch.mock.calls[0][0]).toBe(
                'https://any.posthog-instance.com/flags/?v=2&_=1700000000000&ver=1.23.45'
            )
        })

        it.each([
            [
                'does not add a compression query param for gzip requests',
                'https://any.posthog-instance.com?ver=1.23.45',
                'https://any.posthog-instance.com?ver=1.23.45&_=1700000000000',
            ],
            [
                'removes an existing compression query param for gzip requests',
                'https://any.posthog-instance.com?ver=1.23.45&compression=gzip-js',
                'https://any.posthog-instance.com?ver=1.23.45&_=1700000000000',
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
                'sendBeacon',
                { transport: 'sendBeacon' as const, url: 'https://any.posthog-instance.com/' },
                async () => {
                    expect(mockedNavigator?.sendBeacon.mock.calls[0][0]).not.toContain('compression=gzip-js')
                    const blob = mockedNavigator?.sendBeacon.mock.calls[0][1] as Blob
                    expect(blob.type).toBe('application/json')
                    const result = await new Promise<string>((resolve) => {
                        const reader = new FileReader()
                        reader.onload = () => resolve(reader.result as string)
                        reader.readAsText(blob)
                    })
                    expect(result).toBe('{"foo":"bar"}')
                },
            ],
        ])(
            'falls back to JSON if a pre-encoded gzip body is not actually gzip before %s send',
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
                    '&compression=base64',
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
                    '&compression=base64',
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
                        `https://any.posthog-instance.com?ver=1.23.45&_=1700000000000${expectedURLParams}`,
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
        })

        describe('sendBeacon', () => {
            beforeEach(() => {
                transport = 'sendBeacon'
            })

            it("should encode data to a string and send it as a blob if it's a POST request", async () => {
                request(
                    createRequest({
                        url: 'https://any.posthog-instance.com/',
                        method: 'POST',
                        data: { foo: 'bar' },
                    })
                )

                expect(mockedNavigator?.sendBeacon).toHaveBeenCalledWith(
                    'https://any.posthog-instance.com/?_=1700000000000&ver=1.23.45',
                    expect.any(Blob)
                )
                const blob = mockedNavigator?.sendBeacon.mock.calls[0][1] as Blob
                expect(blob.type).toBe('application/json')

                const reader = new FileReader()
                const result = await new Promise((resolve) => {
                    reader.onload = () => resolve(reader.result)
                    reader.readAsText(blob)
                })

                expect(result).toMatchInlineSnapshot(`"{"foo":"bar"}"`)
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
                    'https://any.posthog-instance.com/?_=1700000000000&ver=1.23.45&compression=base64',
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
                    'https://any.posthog-instance.com/?_=1700000000000&ver=1.23.45',
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
                ['no compression', undefined, 'application/json'],
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

            describe('$sent_send_beacon tagging', () => {
                const readBeaconBlob = async (): Promise<string> => {
                    const blob = mockedNavigator?.sendBeacon.mock.calls[0][1] as Blob
                    return await new Promise((resolve) => {
                        const reader = new FileReader()
                        reader.onload = () => resolve(reader.result as string)
                        reader.readAsText(blob)
                    })
                }

                const decodeBeaconBody = (body: string): any =>
                    body.startsWith('data=')
                        ? JSON.parse(
                              Buffer.from(decodeURIComponent(body.replace('data=', '')), 'base64').toString('utf8')
                          )
                        : JSON.parse(body)

                it.each([
                    ['a single event', undefined, { event: 'test', properties: { foo: 'bar' } }],
                    ['a single base64-compressed event', Compression.Base64, { event: 'test', properties: {} }],
                    [
                        'a batch of events',
                        undefined,
                        [
                            { event: 'one', properties: {} },
                            { event: 'two', properties: { foo: 'bar' } },
                        ],
                    ],
                ])(
                    'tags %s sent to the events endpoint',
                    async (_name: string, compression: Compression | undefined, data: any) => {
                        request(
                            createRequest({
                                url: 'https://any.posthog-instance.com/e/',
                                method: 'POST',
                                compression,
                                data,
                            })
                        )

                        const decoded = decodeBeaconBody(await readBeaconBlob())
                        const events = [].concat(decoded)
                        expect(events.length).toBeGreaterThan(0)
                        for (const event of events) {
                            expect(event.properties.$sent_send_beacon).toBe(true)
                        }
                    }
                )

                it('does not tag snapshot payloads sent to the recordings endpoint', async () => {
                    request(
                        createRequest({
                            url: 'https://any.posthog-instance.com/s/',
                            method: 'POST',
                            data: { event: '$snapshot', properties: { $snapshot_data: [] } },
                        })
                    )

                    const decoded = decodeBeaconBody(await readBeaconBlob())
                    expect(decoded.properties.$sent_send_beacon).toBeUndefined()
                })

                it('leaves events-endpoint payloads without a properties object untouched', async () => {
                    request(
                        createRequest({
                            url: 'https://any.posthog-instance.com/e/',
                            method: 'POST',
                            data: { foo: 'bar' },
                        })
                    )

                    expect(decodeBeaconBody(await readBeaconBlob())).toEqual({ foo: 'bar' })
                })

                it('does not tag events sent over other transports', () => {
                    request(
                        createRequest({
                            url: 'https://any.posthog-instance.com/e/',
                            method: 'POST',
                            transport: 'XHR',
                            data: { event: 'test', properties: { foo: 'bar' } },
                        })
                    )

                    expect(mockedXHR.send.mock.calls[0][0]).not.toContain('$sent_send_beacon')
                })
            })
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

            jest.doMock('../utils/globals', () => ({
                ...jest.requireActual('../utils/globals'),
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

        it('retries uncompressed and disables native async gzip after NotReadableError', async () => {
            mockedIsolatedGzipCompress.mockRejectedValueOnce({ name: 'NotReadableError' })

            isolatedRequestModule.request({
                url: 'https://any.posthog-instance.com?ver=1.23.45',
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

            mockedIsolatedFetch.mockClear()

            isolatedRequestModule.request({
                url: 'https://any.posthog-instance.com?ver=1.23.45',
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
                url: 'https://any.posthog-instance.com?ver=1.23.45',
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
                url: 'https://any.posthog-instance.com?ver=1.23.45',
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
                url: 'https://any.posthog-instance.com?ver=1.23.45',
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
                url: 'https://any.posthog-instance.com?ver=1.23.45',
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
