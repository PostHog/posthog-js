/* eslint-disable compat/compat */
/// <reference lib="dom" />

import { addParamsToURL, encodePostData, request } from '../send-request'
import { assert, boolean, property, uint8Array, VerbosityLevel } from 'fast-check'
import { Compression, PostData, XHROptions, RequestData, MinimalHTTPResponse } from '../types'

import { _isUndefined } from '../utils/type-utils'
import { assignableWindow } from '../utils/globals'

jest.mock('../utils/request-utils', () => ({
    ...jest.requireActual('../utils/request-utils'),
    SUPPORTS_XHR: true,
    SUPPORTS_FETCH: true,
    SUPPORTS_REQUEST: true,
}))

jest.mock('../config', () => ({ DEBUG: false, LIB_VERSION: '1.23.45' }))

const flushPromises = () => new Promise((r) => setTimeout(r, 0))

describe('send-request', () => {
    describe('xhr', () => {
        let mockXHR: XMLHttpRequest
        let createRequestData: (overrides?: Partial<RequestData>) => RequestData
        let checkForLimiting: RequestData['onResponse']

        beforeEach(() => {
            mockXHR = {
                open: jest.fn(),
                setRequestHeader: jest.fn,
                onreadystatechange: jest.fn(),
                send: jest.fn(),
                readyState: 4,
                responseText: JSON.stringify('something here'),
                status: 502,
            } as Partial<XMLHttpRequest> as XMLHttpRequest

            checkForLimiting = jest.fn()
            createRequestData = (overrides?: Partial<RequestData>) => {
                return {
                    url: 'https://any.posthog-instance.com?ver=1.23.45',
                    data: {},
                    headers: {},
                    callback: () => {},
                    options: {
                        transport: 'XHR',
                        ...(overrides?.options || {}),
                    },
                    retriesPerformedSoFar: undefined,
                    retryQueue: {
                        enqueue: () => {},
                    } as Partial<RequestData['retryQueue']> as RequestData['retryQueue'],
                    onResponse: checkForLimiting,
                    ...overrides,
                }
            }

            // ignore TS complaining about us cramming a fake in here
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            assignableWindow.XMLHttpRequest = jest.fn(() => mockXHR) as unknown as XMLHttpRequest
        })

        test('performs the request with default params', () => {
            request(
                createRequestData({
                    retriesPerformedSoFar: 0,
                    url: 'https://any.posthog-instance.com/?ver=1.23.45&ip=7&_=1698404857278',
                })
            )
            expect(mockXHR.open).toHaveBeenCalledWith(
                'GET',
                'https://any.posthog-instance.com/?ver=1.23.45&ip=7&_=1698404857278',
                true
            )
        })

        test('it adds the retry count to the URL', () => {
            const retryCount = Math.floor(Math.random() * 100) + 1 // make sure it is never 0
            request(
                createRequestData({
                    retriesPerformedSoFar: retryCount,
                    url: 'https://any.posthog-instance.com/?ver=1.23.45&ip=7&_=1698404857278',
                })
            )
            expect(mockXHR.open).toHaveBeenCalledWith(
                'GET',
                `https://any.posthog-instance.com/?ver=1.23.45&ip=7&_=1698404857278&retry_count=${retryCount}`,
                true
            )
        })

        it('calls the on response handler', async () => {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            // noinspection JSConstantReassignment
            mockXHR.status = 200
            request(createRequestData())
            mockXHR.onreadystatechange?.({} as Event)
            expect(checkForLimiting).toHaveBeenCalledWith({
                statusCode: mockXHR.status,
                responseText: mockXHR.responseText,
            })
        })

        describe('when the requests fail', () => {
            it('does not error if the configured onError is not a function', () => {
                expect(() => {
                    request(
                        createRequestData({
                            onError: 'not a function' as unknown as RequestData['onError'],
                        })
                    )
                    mockXHR.onreadystatechange?.({} as Event)
                }).not.toThrow()
            })

            it('calls the injected XHR error handler', () => {
                //cannot use an auto-mock from jest as the code checks if onError is a Function
                let requestFromError: MinimalHTTPResponse | undefined
                request(
                    createRequestData({
                        onError: (req) => {
                            requestFromError = req
                        },
                    })
                )
                mockXHR.onreadystatechange?.({} as Event)
                expect(requestFromError).toHaveProperty('statusCode', 502)
            })

            it('calls the on response handler - regardless of status', () => {
                // a bunch of comments to suppress a warning
                // we shouldn't really be able to assign to status but JS is weird
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                // noinspection JSConstantReassignment
                mockXHR.status = Math.floor(Math.random() * 100)
                request(createRequestData())
                mockXHR.onreadystatechange?.({} as Event)
                expect(checkForLimiting).toHaveBeenCalledWith({
                    statusCode: mockXHR.status,
                    responseText: mockXHR.responseText,
                })
            })
        })
    })

    describe('fetch', () => {
        let createRequestData: (overrides?: Partial<RequestData>) => RequestData
        let checkForLimiting: RequestData['onResponse']

        beforeEach(() => {
            checkForLimiting = jest.fn()
            createRequestData = (overrides?: Partial<RequestData>) => {
                return {
                    url: 'https://any.posthog-instance.com?ver=1.23.45',
                    data: {},
                    headers: {},
                    callback: () => {},
                    retriesPerformedSoFar: undefined,
                    options: {
                        transport: 'fetch',
                        ...(overrides?.options || {}),
                    },

                    retryQueue: {
                        enqueue: () => {},
                    } as Partial<RequestData['retryQueue']> as RequestData['retryQueue'],
                    onResponse: checkForLimiting,
                    ...overrides,
                }
            }

            assignableWindow.fetch = jest.fn(() => {
                return Promise.resolve({
                    status: 200,
                    json: () => Promise.resolve({}),
                    text: () => Promise.resolve(''),
                }) as any
            })
        })

        test('it performs the request with default params', () => {
            request(
                createRequestData({
                    retriesPerformedSoFar: 0,
                    url: 'https://any.posthog-instance.com/?ver=1.23.45&ip=7&_=1698404857278',
                })
            )

            expect(assignableWindow.fetch).toHaveBeenCalledWith(
                `https://any.posthog-instance.com/?ver=1.23.45&ip=7&_=1698404857278`,
                {
                    body: null,
                    headers: new Headers(),
                    keepalive: false,
                    method: 'GET',
                }
            )
        })

        test('it adds the retry count to the URL', () => {
            const retryCount = Math.floor(Math.random() * 100) + 1 // make sure it is never 0
            request(
                createRequestData({
                    retriesPerformedSoFar: retryCount,
                    url: 'https://any.posthog-instance.com/?ver=1.23.45&ip=7&_=1698404857278',
                })
            )
            expect(assignableWindow.fetch).toHaveBeenCalledWith(
                `https://any.posthog-instance.com/?ver=1.23.45&ip=7&_=1698404857278&retry_count=${retryCount}`,
                {
                    body: null,
                    headers: new Headers(),
                    keepalive: false,
                    method: 'GET',
                }
            )
        })

        it('calls the on response handler', async () => {
            request(createRequestData())
            await flushPromises()
            expect(checkForLimiting).toHaveBeenCalledWith({
                statusCode: 200,
                responseText: '',
            })
        })

        describe('when the requests fail', () => {
            beforeEach(() => {
                assignableWindow.fetch = jest.fn(
                    () =>
                        Promise.resolve({
                            status: 502,
                            text: () => Promise.resolve('oh no!'),
                        }) as any
                )
            })

            it('does not error if the configured onError is not a function', () => {
                expect(() => {
                    request(
                        createRequestData({
                            onError: 'not a function' as unknown as RequestData['onError'],
                        })
                    )
                }).not.toThrow()
            })

            it('calls the injected XHR error handler', async () => {
                //cannot use an auto-mock from jest as the code checks if onError is a Function
                let requestFromError: MinimalHTTPResponse | undefined
                request(
                    createRequestData({
                        onError: (req) => {
                            requestFromError = req
                        },
                    })
                )
                await flushPromises()

                expect(requestFromError).toHaveProperty('statusCode', 502)
            })

            it('calls the on response handler - regardless of status', async () => {
                request(createRequestData())
                await flushPromises()
                expect(checkForLimiting).toHaveBeenCalledWith({
                    statusCode: 502,
                    responseText: 'oh no!',
                })
            })
        })
    })

    describe('adding query params to posthog API calls', () => {
        let posthogURL: string
        let parameterOptions: { ip?: boolean }

        posthogURL = 'https://any.posthog-instance.com'

        it('adds library version', () => {
            const alteredURL = addParamsToURL(
                posthogURL,
                {},
                {
                    ip: true,
                }
            )
            // eslint-disable-next-line compat/compat
            expect(new URL(alteredURL).search).toContain('&ver=1.23.45')
        })
        it('adds i as 1 when IP in config', () => {
            const alteredURL = addParamsToURL(
                posthogURL,
                {},
                {
                    ip: true,
                }
            )
            // eslint-disable-next-line compat/compat
            expect(new URL(alteredURL).search).toContain('ip=1')
        })
        it('adds i as 0 when IP not in config', () => {
            parameterOptions = {}
            const alteredURL = addParamsToURL(posthogURL, {}, parameterOptions)
            // eslint-disable-next-line compat/compat
            expect(new URL(alteredURL).search).toContain('ip=0')
        })
        it('adds timestamp', () => {
            const alteredURL = addParamsToURL(
                posthogURL,
                {},
                {
                    ip: true,
                }
            )
            // eslint-disable-next-line compat/compat
            expect(new URL(alteredURL).search).toMatch(/_=\d+/)
        })
        it('does not add a query parameter if it already exists in the URL', () => {
            posthogURL = 'https://test.com/'
            const whenItShouldAddParam = addParamsToURL(
                posthogURL,
                {},
                {
                    ip: true,
                }
            )
            expect(whenItShouldAddParam).toContain('ver=1.23.45')

            posthogURL = 'https://test.com/decide/?ver=2'
            const whenItShouldNotAddParam = addParamsToURL(
                posthogURL,
                {},
                {
                    ip: true,
                }
            )
            expect(whenItShouldNotAddParam).not.toContain('ver=1.23.45')
            expect(whenItShouldNotAddParam).toContain('ver=2')
        })

        it('does not add the i query parameter if it already exists in the URL', () => {
            posthogURL = 'https://test.com/'
            expect(
                addParamsToURL(
                    'https://test.com/',
                    {},
                    {
                        ip: true,
                    }
                )
            ).toContain('ip=1')

            expect(
                addParamsToURL(
                    'https://test.com/',
                    {},
                    {
                        ip: false,
                    }
                )
            ).toContain('ip=0')

            expect(addParamsToURL('https://test.com/', {}, {})).toContain('ip=0')

            const whenItShouldNotAddParam = addParamsToURL(
                'https://test.com/decide/?ip=7',
                {},
                {
                    ip: true,
                }
            )
            expect(whenItShouldNotAddParam).not.toContain('ip=1')
            expect(whenItShouldNotAddParam).toContain('ip=7')
        })
    })

    describe('using property based testing to identify edge cases in encodePostData', () => {
        it('can use many combinations of typed arrays and options to detect if the method generates undefined', () => {
            assert(
                property(uint8Array(), boolean(), boolean(), (data, blob, sendBeacon) => {
                    const encodedData = encodePostData(data, { blob, sendBeacon, method: 'POST' })
                    return !_isUndefined(encodedData)
                }),
                { numRuns: 1000, verbose: VerbosityLevel.VeryVerbose }
            )
        })

        it('does not return undefined when blob and send beacon are false and the input is an empty uint8array', () => {
            const encodedData = encodePostData(new Uint8Array([]), { method: 'POST' })
            expect(typeof encodedData).toBe('string')
            expect(encodedData).toBe('data=')
        })
    })

    describe('encodePostData()', () => {
        let data: Uint8Array | PostData
        let options: Partial<XHROptions>

        beforeEach(() => {
            data = { data: 'content' }
            options = { method: 'POST' }

            // let the spy return things that don't technically ,atch the signature
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            jest.spyOn(global, 'Blob').mockImplementation((...args) => ['Blob', ...args])
        })

        type TestType = [string, Uint8Array | PostData, Partial<XHROptions>, string | BlobPart | null]
        test.each<TestType>([
            ['handles objects', { data: 'content' }, { method: 'POST' }, 'data=content'],
            // JS can pass unexpected types - force the shape here
            ['handles arrays', ['foo', 'bar'] as unknown as Uint8Array, { method: 'POST' }, 'data=foo%2Cbar'],
            [
                'handles data with compression',
                { data: 'content', compression: Compression.GZipJS },
                { method: 'POST' },
                'data=content&compression=gzip-js',
            ],
            [
                'handles string buffer as a blob',
                { buffer: 'buffer' },
                { method: 'POST', blob: true },
                [
                    'Blob',
                    ['buffer'],
                    {
                        type: 'text/plain',
                    },
                ] as unknown as BlobPart, // the mock sends more info than the real Blob
            ],
            [
                'handles sendBeacon',
                { data: 'content' },
                { method: 'POST', sendBeacon: true },
                [
                    'Blob',
                    ['data=content'],
                    {
                        type: 'application/x-www-form-urlencoded',
                    },
                ] as unknown as BlobPart, // the mock sends more info than the real Blob,
            ],
            [
                'handles sendBeacon when data is not a typed array and blob is also true',
                { data: 'content' },
                { method: 'POST', sendBeacon: true, blob: true },
                [
                    'Blob',
                    ['data=content'],
                    {
                        type: 'application/x-www-form-urlencoded',
                    },
                ] as unknown as BlobPart, // the mock sends more info than the real Blob
            ],
            [
                'handles sendBeacon when data is a typed array and blob is also true',
                new Uint8Array([1, 2, 3, 4]),
                { method: 'POST', sendBeacon: true, blob: true },
                [
                    'Blob',
                    // TODO in the snapshot versions of this test the content was converted to an empty array
                    // should it still be a Uint8Array?
                    [new Uint8Array([1, 2, 3, 4])],
                    {
                        type: 'text/plain',
                    },
                ] as unknown as BlobPart, // the mock sends more info than the real Blob,,
            ],
        ])('handles %s', (_, data, options, expected) => {
            expect(encodePostData(data, options)).toEqual(expected)
        })

        it('handles GET requests', () => {
            options = { method: 'GET' }

            expect(encodePostData(data, options)).toEqual(null)
        })
    })
})
