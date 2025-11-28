/// <reference lib="dom" />

import { expect } from '@jest/globals'
import { shouldRecordBody } from '../../../../extensions/replay/external/network-plugin'

// Mock Request class since jsdom might not provide it
class MockRequest {
    url: string
    constructor(url: string) {
        this.url = url
    }
}

// Replace global Request with our mock
global.Request = MockRequest as any

// Mock window with performance API
function createMockWindow() {
    const performanceEntries: PerformanceEntry[] = []
    const observerCallbacks: Array<(entries: PerformanceObserverEntryList) => void> = []

    const mockWindow = {
        performance: {
            now: () => Date.now(),
            getEntries: () => performanceEntries,
            getEntriesByName: (name: string) => performanceEntries.filter((e: any) => e.name === name),
            clearResourceTimings: () => {
                performanceEntries.length = 0
            },
        },
        PerformanceObserver: class {
            callback: (entries: PerformanceObserverEntryList) => void
            constructor(callback: (entries: PerformanceObserverEntryList) => void) {
                this.callback = callback
            }
            observe() {
                observerCallbacks.push(this.callback)
            }
            disconnect() {
                const index = observerCallbacks.indexOf(this.callback)
                if (index > -1) observerCallbacks.splice(index, 1)
            }
        } as any,
        XMLHttpRequest: class {
            listeners: Map<string, Array<(e: any) => void>> = new Map()
            readyState = 0
            DONE = 4
            status = 200
            response = ''
            responseText = ''

            open() {}
            send() {}
            setRequestHeader() {}
            getAllResponseHeaders() {
                return ''
            }
            addEventListener(event: string, listener: (e: any) => void) {
                if (!this.listeners.has(event)) this.listeners.set(event, [])
                this.listeners.get(event)!.push(listener)
            }
            removeEventListener(event: string, listener: (e: any) => void) {
                const listeners = this.listeners.get(event)
                if (listeners) {
                    const index = listeners.indexOf(listener)
                    if (index > -1) listeners.splice(index, 1)
                }
            }
            getListenerCount(event: string) {
                return this.listeners.get(event)?.length || 0
            }
        } as any,
        fetch: async () => new Response(),
    } as any

    mockWindow.PerformanceObserver.supportedEntryTypes = ['navigation', 'resource']

    return { mockWindow, performanceEntries, observerCallbacks }
}

const blobUrlTestCases = [
    { url: 'blob:https://example.com/123', expected: false },
    { url: new URL('blob:https://example.com/123'), expected: false },
    { url: new Request('blob:https://example.com/123'), expected: false },
    { url: 'https://example.com', expected: true },
    { url: new URL('https://example.com'), expected: true },
    { url: new Request('https://example.com'), expected: true },
]

const recordBodyConfigTestCases = [
    { recordBody: false, expected: false },
    { recordBody: true, expected: true },
    { recordBody: { request: true, response: false }, type: 'request', expected: true },
    { recordBody: { request: true, response: false }, type: 'response', expected: false },
    { recordBody: { request: false, response: true }, type: 'request', expected: false },
    { recordBody: { request: false, response: true }, type: 'response', expected: true },
]

const contentTypeTestCases = [
    {
        recordBody: ['application/json'],
        headers: { 'content-type': 'application/json' },
        expected: true,
    },
    {
        recordBody: ['application/json'],
        headers: { 'content-type': 'text/plain' },
        expected: false,
    },
    {
        recordBody: { request: ['application/json'], response: ['text/plain'] },
        type: 'request',
        headers: { 'content-type': 'application/json' },
        expected: true,
    },
    {
        recordBody: { request: ['application/json'], response: ['text/plain'] },
        type: 'response',
        headers: { 'content-type': 'text/plain' },
        expected: true,
    },
]

const edgeCaseTestCases = [
    // Test with null/undefined recordBody
    { recordBody: null, expected: false },
    { recordBody: undefined, expected: false },

    // Test with empty headers
    { recordBody: true, headers: {}, expected: true },

    // Test with case-insensitive content-type header
    {
        recordBody: ['application/json'],
        headers: { 'Content-Type': 'application/json' },
        expected: true,
    },

    // Test with multiple content types in header
    {
        recordBody: ['application/json'],
        headers: { 'content-type': 'application/json; charset=utf-8' },
        expected: true,
    },

    // Test with multiple content types in configuration
    {
        recordBody: ['application/json', 'text/plain'],
        headers: { 'content-type': 'text/plain' },
        expected: true,
    },

    // Test with invalid URL
    { recordBody: true, url: 'not-a-url', expected: true },

    // Test with empty content type in configuration
    {
        recordBody: [],
        headers: { 'content-type': 'application/json' },
        expected: false,
    },
]

const errorHandlingTestCases = [
    // Test with malformed URL
    { recordBody: true, url: 'blob:invalid-url', expected: false },

    // Test with malformed Request object
    { recordBody: true, url: new Request(''), expected: true },

    // Test with malformed URL object
    { recordBody: true, url: new URL('https://example.com'), expected: true },
]

describe('network plugin', () => {
    describe('shouldRecordBody', () => {
        describe('blob URL handling', () => {
            blobUrlTestCases.forEach(({ url, expected }, index) => {
                it(`should ${expected ? 'record' : 'not record'} body for ${typeof url === 'string' ? url : url.constructor.name} (case ${index + 1})`, () => {
                    const result = shouldRecordBody({
                        type: 'request',
                        headers: {},
                        url,
                        recordBody: true,
                    })
                    expect(result).toBe(expected)
                })
            })
        })

        describe('recordBody configuration', () => {
            recordBodyConfigTestCases.forEach(({ recordBody, type = 'request', expected }, index) => {
                it(`should handle ${typeof recordBody === 'object' ? JSON.stringify(recordBody) : recordBody} for ${type} (case ${index + 1})`, () => {
                    const result = shouldRecordBody({
                        type: type as 'request' | 'response',
                        headers: {},
                        url: 'https://example.com',
                        recordBody,
                    })
                    expect(result).toBe(expected)
                })
            })
        })

        describe('content type configuration', () => {
            contentTypeTestCases.forEach(({ recordBody, type = 'request', headers, expected }, index) => {
                it(`should handle ${JSON.stringify(recordBody)} with ${headers['content-type']} for ${type} (case ${index + 1})`, () => {
                    const result = shouldRecordBody({
                        type: type as 'request' | 'response',
                        headers,
                        url: 'https://example.com',
                        recordBody,
                    })
                    expect(result).toBe(expected)
                })
            })
        })

        describe('edge cases', () => {
            edgeCaseTestCases.forEach(({ recordBody, headers = {}, url = 'https://example.com', expected }, index) => {
                it(`should handle edge case ${index + 1}: ${JSON.stringify({ recordBody, headers, url })}`, () => {
                    const result = shouldRecordBody({
                        type: 'request',
                        headers,
                        url,
                        recordBody,
                    })
                    expect(result).toBe(expected)
                })
            })
        })

        describe('error handling', () => {
            errorHandlingTestCases.forEach(({ recordBody, url, expected }, index) => {
                it(`should handle error case ${index + 1}: ${JSON.stringify({ recordBody, url })}`, () => {
                    const result = shouldRecordBody({
                        type: 'request',
                        headers: {},
                        url,
                        recordBody,
                    })
                    expect(result).toBe(expected)
                })
            })
        })
    })

    describe('network observer lifecycle', () => {
        describe('singleton initialization and cleanup', () => {
            it('should initialize successfully on first call', () => {
                jest.isolateModules(() => {
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    const { getRecordNetworkPlugin } = require('../../../../extensions/replay/external/network-plugin')
                    const { mockWindow, observerCallbacks } = createMockWindow()
                    global.PerformanceObserver = mockWindow.PerformanceObserver

                    const plugin = getRecordNetworkPlugin()
                    const cleanup = plugin.observer(() => {}, mockWindow, {})

                    expect(typeof cleanup).toBe('function')
                    expect(observerCallbacks.length).toBe(1)
                })
            })

            it('should allow re-initialization after cleanup', () => {
                jest.isolateModules(() => {
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    const { getRecordNetworkPlugin } = require('../../../../extensions/replay/external/network-plugin')
                    const { mockWindow, observerCallbacks } = createMockWindow()
                    global.PerformanceObserver = mockWindow.PerformanceObserver

                    const plugin1 = getRecordNetworkPlugin()
                    const cleanup1 = plugin1.observer(() => {}, mockWindow, {})
                    expect(observerCallbacks.length).toBe(1)

                    cleanup1()
                    expect(observerCallbacks.length).toBe(0)

                    const plugin2 = getRecordNetworkPlugin()
                    const cleanup2 = plugin2.observer(() => {}, mockWindow, {})
                    expect(observerCallbacks.length).toBe(1)

                    cleanup2()
                })
            })

            it('should handle multiple cleanup calls safely', () => {
                jest.isolateModules(() => {
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    const { getRecordNetworkPlugin } = require('../../../../extensions/replay/external/network-plugin')
                    const { mockWindow, observerCallbacks } = createMockWindow()
                    global.PerformanceObserver = mockWindow.PerformanceObserver

                    const plugin = getRecordNetworkPlugin()
                    const cleanup = plugin.observer(() => {}, mockWindow, {})

                    expect(() => {
                        cleanup()
                        cleanup()
                        cleanup()
                    }).not.toThrow()

                    expect(observerCallbacks.length).toBe(0)
                })
            })
        })

        describe('XHR listener cleanup', () => {
            let mockWindow: any
            let xhr: any

            beforeEach(() => {
                jest.isolateModules(() => {
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    const { getRecordNetworkPlugin } = require('../../../../extensions/replay/external/network-plugin')
                    const mock = createMockWindow()
                    mockWindow = mock.mockWindow

                    global.PerformanceObserver = mockWindow.PerformanceObserver

                    const plugin = getRecordNetworkPlugin({ recordBody: true })
                    plugin.observer(() => {}, mockWindow, { recordBody: true })

                    xhr = new mockWindow.XMLHttpRequest()
                })
            })

            it('should remove readystatechange listener on successful request', () => {
                xhr.open('GET', 'https://example.com')
                xhr.send()

                expect(xhr.getListenerCount('readystatechange')).toBeGreaterThan(0)

                xhr.readyState = xhr.DONE
                xhr.status = 200
                const listeners = xhr.listeners.get('readystatechange') || []
                listeners.forEach((listener: any) => listener())

                expect(xhr.getListenerCount('readystatechange')).toBe(0)
            })

            const failureEvents = [
                { event: 'error', payload: new Error('Network error') },
                { event: 'abort', payload: { type: 'abort' } },
                { event: 'timeout', payload: { type: 'timeout' } },
            ]

            failureEvents.forEach(({ event, payload }) => {
                it(`should remove all listeners when XHR ${event}s`, () => {
                    xhr.open('GET', 'https://example.com')
                    xhr.send()

                    const listeners = xhr.listeners.get(event) || []
                    listeners.forEach((listener: any) => listener(payload))

                    expect(xhr.getListenerCount('readystatechange')).toBe(0)
                    expect(xhr.getListenerCount('error')).toBe(0)
                    expect(xhr.getListenerCount('abort')).toBe(0)
                    expect(xhr.getListenerCount('timeout')).toBe(0)
                })
            })

            it('should not leak memory with multiple failed requests', () => {
                const xhrInstances = Array.from({ length: 10 }, (_, i) => {
                    const testXhr = new mockWindow.XMLHttpRequest()
                    testXhr.open('GET', `https://example.com/${i}`)
                    testXhr.send()

                    const errorListeners = testXhr.listeners.get('error') || []
                    errorListeners.forEach((listener: any) => listener(new Error('Network error')))

                    return testXhr
                })

                xhrInstances.forEach((testXhr) => {
                    expect(testXhr.getListenerCount('readystatechange')).toBe(0)
                    expect(testXhr.getListenerCount('error')).toBe(0)
                    expect(testXhr.getListenerCount('abort')).toBe(0)
                    expect(testXhr.getListenerCount('timeout')).toBe(0)
                })
            })
        })
    })
})
