/* eslint-disable compat/compat */
/// <reference lib="dom" />

import { extendURLParams, request } from '../request'
import { Compression, RequestOptions } from '../types'

jest.mock('../utils/request-utils', () => ({
    ...jest.requireActual('../utils/request-utils'),
    SUPPORTS_XHR: true,
    SUPPORTS_FETCH: true,
    SUPPORTS_REQUEST: true,
}))

jest.mock('../utils/globals', () => ({
    ...jest.requireActual('../utils/globals'),
    fetch: jest.fn(),
}))

import { assignableWindow, fetch } from '../utils/globals'

jest.mock('../config', () => ({ DEBUG: false, LIB_VERSION: '1.23.45' }))

const flushPromises = async () => {
    jest.useRealTimers()
    await new Promise((res) => setTimeout(res, 0))
    jest.useRealTimers()
}

describe('request', () => {
    let mockedFetch: jest.MockedFunction<any> = fetch as jest.MockedFunction<any>
    const mockedXHR = {
        open: jest.fn(),
        setRequestHeader: jest.fn(),
        onreadystatechange: jest.fn(),
        send: jest.fn(),
        readyState: 4,
        responseText: JSON.stringify('something here'),
        status: 200,
    }

    const now = 1700000000000

    const mockCallback = jest.fn()
    let createRequest: (overrides?: Partial<RequestOptions>) => RequestOptions
    let transport: RequestOptions['transport']

    beforeEach(() => {
        mockedFetch = fetch as jest.MockedFunction<any>
        mockedXHR.open.mockClear()
        // ignore TS complaining about us cramming a fake in here
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        assignableWindow.XMLHttpRequest = jest.fn(() => mockedXHR) as unknown as XMLHttpRequest
        jest.useFakeTimers()
        jest.setSystemTime(now)

        createRequest = (overrides) => ({
            url: 'https://any.posthog-instance.com?ver=1.23.45',
            data: {},
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
                })
            )
            expect(mockedXHR.open).toHaveBeenCalledWith(
                'GET',
                'https://any.posthog-instance.com/?_=1700000000000&ver=1.23.45',
                true
            )
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
            request(createRequest())

            expect(mockedFetch).toHaveBeenCalledWith(`https://any.posthog-instance.com?ver=1.23.45&_=1700000000000`, {
                body: null,
                headers: new Headers(),
                keepalive: false,
                method: 'GET',
            })
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

        it('does not modify existing query parameters', () => {
            const newUrl = extendURLParams(posthogURL + '?a=false', {
                a: true,
                b: 1,
                c: 'encoded string 😘',
            })
            expect(newUrl).toEqual(posthogURL + '?a=false&b=1&c=encoded%20string%20%F0%9F%98%98')
        })

        it('does not re-encode existing params', () => {
            const newUrl = extendURLParams(posthogURL + '?a=false&b=1&c=encoded%20string%20%F0%9F%98%98', {})
            expect(newUrl).toEqual(posthogURL + '?a=false&b=1&c=encoded%20string%20%F0%9F%98%98')
        })
    })

    describe('body encoding', () => {
        beforeEach(() => {
            transport = 'XHR'
        })

        it('should encode data to a string', () => {
            request(
                createRequest({
                    url: 'https://any.posthog-instance.com/',
                    method: 'POST',
                    data: { data: 'content' },
                })
            )
            expect(mockedXHR.send).toHaveBeenCalledWith('data=%7B%22data%22%3A%22content%22%7D')
            expect(mockedXHR.setRequestHeader).toHaveBeenCalledWith('Content-Type', 'application/x-www-form-urlencoded')
        })

        it('should base64 compress data if set', () => {
            request(
                createRequest({
                    url: 'https://any.posthog-instance.com/',
                    method: 'POST',
                    compression: Compression.Base64,
                    data: { data: 'content' },
                })
            )
            expect(mockedXHR.send).toHaveBeenCalledWith('data=eyJkYXRhIjoiY29udGVudCJ9')
            expect(mockedXHR.setRequestHeader).toHaveBeenCalledWith('Content-Type', 'application/x-www-form-urlencoded')
        })

        it('should gzip compress data if set', async () => {
            request(
                createRequest({
                    url: 'https://any.posthog-instance.com/',
                    method: 'POST',
                    compression: Compression.GZipJS,
                    data: { data: 'contents' },
                })
            )
            expect(mockedXHR.send).toHaveBeenCalledTimes(1)
            expect(mockedXHR.send.mock.calls[0][0]).toBeInstanceOf(Blob)
            // Decode and check the blob content

            const res = await new Promise((resolve) => {
                const reader = new FileReader()
                reader.onload = () => resolve(reader.result)
                reader.readAsText(mockedXHR.send.mock.calls[0][0])
            })

            expect(res).toMatchInlineSnapshot(`"�      �VJI,IT�RJ��+I�+)V� ]�   "`)

            expect(mockedXHR.setRequestHeader).not.toHaveBeenCalledWith(
                'Content-Type',
                'application/x-www-form-urlencoded'
            )
        })
    })
})
