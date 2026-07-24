/// <reference lib="dom" />

import { expect } from '@jest/globals'
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'util'
import { buildNetworkRequestOptions } from '../../../../extensions/replay/external/config'
import { NetworkRecordOptions } from '../../../../types'
import { defaultConfig } from '../../../../posthog-core'
import {
    _contentLengthExceedsLimit,
    _readBody,
    _tryReadBodyStreaming,
    NEVER_RECORD_BODY_CONTENT_TYPES,
    shouldRecordBody,
} from '../../../../extensions/replay/external/network-plugin'

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

function createResourceTimingEntry(name: string, serverTimingName: string, serverTimingDuration: number) {
    return {
        name,
        entryType: 'resource',
        initiatorType: 'fetch',
        startTime: 10,
        responseEnd: 20,
        serverTiming: [{ name: serverTimingName, duration: serverTimingDuration }],
        toJSON() {
            return {
                name: this.name,
                entryType: this.entryType,
                initiatorType: this.initiatorType,
                startTime: this.startTime,
                duration: 10,
            }
        },
    }
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

        describe('binary content types are never recorded', () => {
            const neverRecordCases: [string, boolean][] = NEVER_RECORD_BODY_CONTENT_TYPES.map((prefix) => [
                prefix.endsWith('/') ? `${prefix}example` : prefix,
                false,
            ])
            const alwaysRecordCases: [string, boolean][] = [
                ['application/json', true],
                ['text/plain', true],
            ]
            it.each([...neverRecordCases, ...alwaysRecordCases])(
                'recordBody:true with content-type %s should record=%s',
                (contentType, expected) => {
                    const result = shouldRecordBody({
                        type: 'response',
                        headers: { 'content-type': contentType } as unknown as Headers,
                        url: 'https://example.com/asset',
                        recordBody: true,
                    })
                    expect(result).toBe(expected)
                }
            )

            it('should ignore content-type casing (RFC 9110)', () => {
                expect(
                    shouldRecordBody({
                        type: 'response',
                        headers: { 'content-type': 'Image/WebP' } as unknown as Headers,
                        url: 'https://example.com/asset',
                        recordBody: true,
                    })
                ).toBe(false)
                expect(
                    shouldRecordBody({
                        type: 'response',
                        headers: { 'content-type': 'APPLICATION/PDF' } as unknown as Headers,
                        url: 'https://example.com/asset',
                        recordBody: true,
                    })
                ).toBe(false)
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
        it('drops server timings derived from a masked PostHog ingestion request', () => {
            jest.isolateModules(() => {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const { getRecordNetworkPlugin } = require('../../../../extensions/replay/external/network-plugin')
                const { mockWindow, observerCallbacks } = createMockWindow()
                global.PerformanceObserver = mockWindow.PerformanceObserver

                const callback = jest.fn()
                const networkOptions = buildNetworkRequestOptions(
                    { ...defaultConfig(), api_host: 'https://example.com/ingest' },
                    { recordPerformance: true }
                )
                const plugin = getRecordNetworkPlugin(networkOptions)
                const cleanup = plugin.observer(callback, mockWindow, networkOptions)
                const entry = createResourceTimingEntry('https://example.com/ingest/s/?ver=1.406.2', 'proxy', 5)

                observerCallbacks[0]({ getEntries: () => [entry] } as PerformanceObserverEntryList)

                expect(callback).not.toHaveBeenCalled()
                cleanup()
            })
        })

        it('does not let a dropped parent suppress the next request in a performance observer batch', () => {
            jest.isolateModules(() => {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const { getRecordNetworkPlugin } = require('../../../../extensions/replay/external/network-plugin')
                const { mockWindow, observerCallbacks } = createMockWindow()
                global.PerformanceObserver = mockWindow.PerformanceObserver

                const callback = jest.fn()
                const networkOptions = buildNetworkRequestOptions(
                    { ...defaultConfig(), api_host: 'https://example.com/ingest' },
                    { recordPerformance: true }
                )
                const plugin = getRecordNetworkPlugin(networkOptions)
                const cleanup = plugin.observer(callback, mockWindow, networkOptions)
                const droppedEntry = createResourceTimingEntry('https://example.com/ingest/s/', 'proxy', 5)
                const allowedEntry = createResourceTimingEntry('https://example.com/api/data', 'allowed-proxy', 3)

                observerCallbacks[0]({ getEntries: () => [droppedEntry, allowedEntry] } as PerformanceObserverEntryList)

                expect(callback).toHaveBeenCalledWith({
                    requests: [
                        expect.objectContaining({ name: allowedEntry.name, entryType: 'resource' }),
                        expect.objectContaining({ name: 'allowed-proxy', entryType: 'serverTiming' }),
                    ],
                })
                cleanup()
            })
        })

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

        describe('instrumentation failures degrade gracefully', () => {
            // instrumentation runs before we delegate to the host's open/fetch, so if it throws we must
            // not let the exception escape and misattribute a failure to session replay
            const OriginalRequest = global.Request

            afterEach(() => {
                global.Request = OriginalRequest
            })

            it('XHR open still delegates to the host when Request construction throws', () => {
                jest.isolateModules(() => {
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    const { getRecordNetworkPlugin } = require('../../../../extensions/replay/external/network-plugin')
                    const { mockWindow } = createMockWindow()
                    global.PerformanceObserver = mockWindow.PerformanceObserver

                    const openCalls: any[] = []
                    mockWindow.XMLHttpRequest.prototype.open = function (...args: any[]) {
                        openCalls.push(args)
                    }

                    global.Request = class {
                        constructor() {
                            throw new Error('InvalidMethod')
                        }
                    } as any

                    const plugin = getRecordNetworkPlugin({ recordBody: true })
                    plugin.observer(() => {}, mockWindow, { recordBody: true })

                    const xhr = new mockWindow.XMLHttpRequest()
                    expect(() => xhr.open('GET', 'https://example.com')).not.toThrow()

                    // the host's original open still ran with the original arguments
                    expect(openCalls).toHaveLength(1)
                    expect(openCalls[0][0]).toBe('GET')
                    expect(openCalls[0][1]).toBe('https://example.com')
                })
            })

            it('fetch still delegates to the host when Request construction throws', async () => {
                const { mockWindow } = createMockWindow()
                global.PerformanceObserver = mockWindow.PerformanceObserver

                let fetchCallCount = 0
                const sentinelResponse = { sentinel: true }
                mockWindow.fetch = async () => {
                    fetchCallCount++
                    return sentinelResponse
                }

                let patchedFetch: (...args: any[]) => Promise<any> = mockWindow.fetch
                jest.isolateModules(() => {
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    const { getRecordNetworkPlugin } = require('../../../../extensions/replay/external/network-plugin')
                    const plugin = getRecordNetworkPlugin({ recordBody: true })
                    plugin.observer(() => {}, mockWindow, { recordBody: true })
                    patchedFetch = mockWindow.fetch
                })

                global.Request = class {
                    constructor() {
                        throw new Error('InvalidMethod')
                    }
                } as any

                // the wrapper must not throw and the host's original fetch must still run
                await expect(patchedFetch('https://example.com')).resolves.toBe(sentinelResponse)
                expect(fetchCallCount).toBe(1)
            })

            it('fetch still delegates to the host when request recording throws', async () => {
                const { mockWindow } = createMockWindow()
                global.PerformanceObserver = mockWindow.PerformanceObserver

                let fetchCallCount = 0
                const sentinelResponse = { status: 204, headers: { forEach: () => {} } }
                mockWindow.fetch = async () => {
                    fetchCallCount++
                    return sentinelResponse
                }

                global.Request = class {
                    url: string
                    method = 'GET'
                    headers = {
                        forEach: () => {
                            throw new Error('HeaderReadFailed')
                        },
                    }

                    constructor(url: string) {
                        this.url = url
                    }
                } as any

                let patchedFetch: (...args: any[]) => Promise<any> = mockWindow.fetch
                jest.isolateModules(() => {
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    const { getRecordNetworkPlugin } = require('../../../../extensions/replay/external/network-plugin')
                    const plugin = getRecordNetworkPlugin({ recordBody: { request: true, response: false } })
                    plugin.observer(() => {}, mockWindow, { recordBody: { request: true, response: false } })
                    patchedFetch = mockWindow.fetch
                })

                // request header/body recording must not throw or block the host's original fetch
                await expect(patchedFetch('https://example.com')).resolves.toBe(sentinelResponse)
                expect(fetchCallCount).toBe(1)
            })
        })
    })

    describe('_tryReadBodyStreaming', () => {
        // jsdom omits TextEncoder/TextDecoder; every browser that supports fetch + streams has them,
        // so shim them here to exercise the real streaming path (the function falls back to text()
        // when TextDecoder is absent, which is covered by the no-stream case).
        const originalTextEncoder = (global as any).TextEncoder
        const originalTextDecoder = (global as any).TextDecoder
        beforeAll(() => {
            ;(global as any).TextEncoder = (global as any).TextEncoder ?? NodeTextEncoder
            ;(global as any).TextDecoder = (global as any).TextDecoder ?? NodeTextDecoder
        })
        afterAll(() => {
            ;(global as any).TextEncoder = originalTextEncoder
            ;(global as any).TextDecoder = originalTextDecoder
        })

        const encode = (s: string): Uint8Array => new TextEncoder().encode(s)

        function fakeStreamingBody(
            chunks: Uint8Array[],
            opts: {
                readRejects?: boolean
                cloneThrows?: boolean
                noStream?: boolean
                textFallback?: string
                readNeverResolves?: boolean
                cancel?: () => Promise<void>
            } = {}
        ): Request | Response {
            let i = 0
            const reader = {
                read: () =>
                    opts.readNeverResolves
                        ? new Promise(() => {})
                        : opts.readRejects
                          ? Promise.reject(new Error('boom'))
                          : Promise.resolve(
                                i < chunks.length
                                    ? { done: false, value: chunks[i++] }
                                    : { done: true, value: undefined }
                            ),
                cancel: opts.cancel ?? (() => Promise.resolve()),
            }
            const clone = {
                body: opts.noStream ? null : { getReader: () => reader, tee: () => [] },
                text: () => Promise.resolve(opts.textFallback ?? ''),
            }
            return {
                clone: () => {
                    if (opts.cloneThrows) {
                        throw new Error('cannot clone')
                    }
                    return clone
                },
            } as unknown as Response
        }

        it('returns the full body when under the limit', async () => {
            const r = fakeStreamingBody([encode('hello '), encode('world')])
            await expect(_tryReadBodyStreaming(r, 1000)).resolves.toBe('hello world')
        })

        it('stops at the limit and returns a placeholder, without buffering past it', async () => {
            const r = fakeStreamingBody([encode('a'.repeat(8)), encode('b'.repeat(8))])
            await expect(_tryReadBodyStreaming(r, 10)).resolves.toBe(
                '[SessionReplay] Body too large to record (> 10 bytes)'
            )
        })

        it('records a body that exactly fills the limit', async () => {
            const r = fakeStreamingBody([encode('1234567890')])
            await expect(_tryReadBodyStreaming(r, 10)).resolves.toBe('1234567890')
        })

        it('decodes a multi-byte character split across chunk boundaries', async () => {
            const bytes = encode('😀')
            const r = fakeStreamingBody([bytes.slice(0, 2), bytes.slice(2)])
            await expect(_tryReadBodyStreaming(r, 1000)).resolves.toBe('😀')
        })

        it('decodes an empty body to an empty string', async () => {
            const r = fakeStreamingBody([])
            await expect(_tryReadBodyStreaming(r, 1000)).resolves.toBe('')
        })

        it('falls back to text() when there is no readable stream', async () => {
            const r = fakeStreamingBody([], { noStream: true, textFallback: 'plain text body' })
            await expect(_tryReadBodyStreaming(r, 1000)).resolves.toBe('plain text body')
        })

        it('resolves with a failure placeholder when the clone cannot be read', async () => {
            const r = fakeStreamingBody([], { cloneThrows: true })
            await expect(_tryReadBodyStreaming(r, 1000)).resolves.toBe('[SessionReplay] Failed to read body')
        })

        it('resolves (never rejects) when the reader errors mid-stream', async () => {
            const r = fakeStreamingBody([encode('partial')], { readRejects: true })
            await expect(_tryReadBodyStreaming(r, 1000)).resolves.toBe(
                '[SessionReplay] Failed to read body: Error: boom'
            )
        })

        it('times out a hung stream and cancels the reader so it stops being read', async () => {
            jest.useFakeTimers()
            try {
                const cancel = jest.fn(() => Promise.resolve())
                const r = fakeStreamingBody([], { readNeverResolves: true, cancel })
                const result = _tryReadBodyStreaming(r, 1000)
                jest.advanceTimersByTime(500)
                await expect(result).resolves.toBe('[SessionReplay] Timeout while trying to read body')
                expect(cancel).toHaveBeenCalled()
            } finally {
                jest.useRealTimers()
            }
        })
    })

    describe('content-length pre-check', () => {
        function fakeRequestWith(contentLength: string | null): {
            r: Request | Response
            wasCloned: () => boolean
        } {
            let cloned = false
            const r = {
                headers: {
                    get: (name: string) => (name.toLowerCase() === 'content-length' ? contentLength : null),
                },
                clone: () => {
                    cloned = true
                    return { body: null, text: () => Promise.resolve('') }
                },
            } as unknown as Response
            return { r, wasCloned: () => cloned }
        }

        it.each([
            ['over the limit', '2000', 1000, true],
            ['equal to the limit', '1000', 1000, false],
            ['under the limit', '500', 1000, false],
            ['absent', null, 1000, false],
            ['not a number', 'banana', 1000, false],
        ])('_contentLengthExceedsLimit: content-length %s', (_label, header, limit, expected) => {
            const { r } = fakeRequestWith(header as string | null)
            expect(_contentLengthExceedsLimit(r, limit as number)).toBe(expected)
        })

        it('skips reading the body when content-length is over the limit (flag on)', async () => {
            const { r, wasCloned } = fakeRequestWith('2000')
            await expect(
                _readBody(r, { streamNetworkBody: true, payloadSizeLimitBytes: 1000 } as NetworkRecordOptions)
            ).resolves.toBe('[SessionReplay] Body too large to record (> 1000 bytes)')
            expect(wasCloned()).toBe(false)
        })

        it('still reads the body when content-length is under the limit (flag on)', async () => {
            const { r, wasCloned } = fakeRequestWith('10')
            await _readBody(r, { streamNetworkBody: true, payloadSizeLimitBytes: 1000 } as NetworkRecordOptions)
            expect(wasCloned()).toBe(true)
        })

        it('ignores the content-length pre-check when the flag is off', async () => {
            const { r, wasCloned } = fakeRequestWith('2000')
            await _readBody(r, { streamNetworkBody: false, payloadSizeLimitBytes: 1000 } as NetworkRecordOptions)
            expect(wasCloned()).toBe(true)
        })
    })
})
