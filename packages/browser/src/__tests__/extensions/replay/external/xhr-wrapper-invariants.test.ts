/**
 * @jest-environment node
 */

import { getRecordNetworkPlugin } from '../../../../extensions/replay/external/network-plugin'
import { CapturedNetworkRequest, NetworkRecordOptions } from '../../../../types'
import { csrfHeaderCases, sensitiveHeaderCases } from './test_data/header-cases'

class MockPerformanceObserver {
    static supportedEntryTypes = ['resource']
    observe() {}
    disconnect() {}
}

// network-plugin reads XHR request bodies via `_tryReadXHRBody`, which
// does `body instanceof Document` to detect HTML form submissions.
// Node lacks the `Document` global so `instanceof` throws. Provide an
// empty stand-in — no real HTMLDocument flows through these tests.
if (typeof (global as any).Document === 'undefined') {
    ;(global as any).Document = class {}
}

type SetHeaderCall = { header: string; value: string }
type CapturedCb = { requests: CapturedNetworkRequest[] }

function createMockXhrClass(setHeaderCalls: SetHeaderCall[], sendCalls: unknown[]) {
    return class {
        listeners: Map<string, Array<(e: any) => void>> = new Map()
        readyState = 0
        DONE = 4
        status = 200
        response = ''
        responseText = ''

        open(_method: string, _url: string) {}
        send(body: unknown) {
            sendCalls.push(body)
        }
        setRequestHeader(header: string, value: string) {
            setHeaderCalls.push({ header, value })
        }
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
    }
}

// Synthetic PerformanceResourceTiming entry returned by getEntriesByName.
// network-plugin.ts:getRequestPerformanceEntry retries with setTimeout
// until it finds one — returning one immediately keeps the cb path
// synchronous-ish and avoids fake-timer juggling.
function fakeResourceTimingEntry(url: string): any {
    return {
        entryType: 'resource',
        initiatorType: 'xmlhttprequest',
        name: url,
        startTime: 0,
        responseEnd: 1,
        toJSON: () => ({ name: url, entryType: 'resource', initiatorType: 'xmlhttprequest' }),
    }
}

function setupWrappedXhr() {
    const setHeaderCalls: SetHeaderCall[] = []
    const sendCalls: unknown[] = []
    const cbInvocations: CapturedCb[] = []

    ;(global as any).PerformanceObserver = MockPerformanceObserver

    const MockXMLHttpRequest = createMockXhrClass(setHeaderCalls, sendCalls)

    // performance.now() must be 0 (or close to it) — getRequestPerformanceEntry
    // filters entries by `entry.startTime >= start`, where `start` is
    // performance.now() at xhr.send() time. Our synthetic entry has
    // startTime=0, so a real timestamp from Date.now() would always fail.
    let perfClock = 0
    const mockWindow = {
        performance: {
            now: () => perfClock++,
            getEntriesByName: (url: string) => [fakeResourceTimingEntry(url)],
        },
        PerformanceObserver: MockPerformanceObserver,
        XMLHttpRequest: MockXMLHttpRequest,
    } as any

    const plugin = getRecordNetworkPlugin({
        recordHeaders: true,
        recordBody: true,
    } as Partial<NetworkRecordOptions> as NetworkRecordOptions)
    const cleanup = plugin.observer(
        (data: CapturedCb) => cbInvocations.push(data),
        mockWindow,
        {
            recordHeaders: true,
            recordBody: true,
            initiatorTypes: ['xmlhttprequest'],
        } as any
    )

    return { mockWindow, MockXMLHttpRequest, setHeaderCalls, sendCalls, cbInvocations, cleanup }
}

// getRecordNetworkPlugin holds a module-level singleton
// (initialisedHandler in network-plugin.ts). Every test must call
// cleanup() so the next test can re-initialise — without an afterEach
// safety net, a test that throws before its own cleanup() would leave
// the next test with a no-op wrapper and trivially-passing assertions.
// Wraps cleanup so it is idempotent and registered for the safety net.
const pendingCleanups: Array<() => void> = []
function setupWrappedXhrWithSafety(): ReturnType<typeof setupWrappedXhr> {
    const result = setupWrappedXhr()
    let called = false
    const wrappedCleanup = () => {
        if (called) return
        called = true
        result.cleanup()
    }
    pendingCleanups.push(wrappedCleanup)
    return { ...result, cleanup: wrappedCleanup }
}

// Drive the XHR to DONE so the network-plugin's readystatechange
// listener fires and ultimately calls the recording cb. Returns the
// first captured cb payload — null if no cb fired within the budget.
async function triggerDoneAndFlush(xhr: any, cbInvocations: CapturedCb[]): Promise<CapturedCb | null> {
    xhr.readyState = xhr.DONE
    xhr.status = 200
    const listeners = xhr.listeners.get('readystatechange') || []
    listeners.forEach((listener: any) => listener())
    // network-plugin awaits a Promise chain (getRequestPerformanceEntry
    // resolves synchronously now that getEntriesByName returns an entry,
    // but the .then() still defers to a microtask). Flush microtasks.
    for (let i = 0; i < 5 && cbInvocations.length === 0; i++) {
        await Promise.resolve()
    }
    return cbInvocations[0] ?? null
}

describe('xhr wrapper', () => {
    // Note: NO jest.useFakeTimers here — the recording cb path goes
    // through real microtasks and Promise.resolve flushes. Fake timers
    // would freeze the promise chain.
    afterEach(() => {
        while (pendingCleanups.length) pendingCleanups.pop()!()
    })

    describe('does not strip headers from the actual outgoing request', () => {
        it.each(sensitiveHeaderCases)(
            'forwards %s to the underlying XMLHttpRequest.setRequestHeader AND captures it for the recording',
            async (name, value) => {
                const { MockXMLHttpRequest, setHeaderCalls, cbInvocations, cleanup } = setupWrappedXhrWithSafety()

                const xhr = new MockXMLHttpRequest()
                xhr.open('POST', 'https://example.com/api/internal/surveys')
                xhr.setRequestHeader(name, value)
                xhr.send('{}')

                const captured = await triggerDoneAndFlush(xhr, cbInvocations)
                cleanup()

                // Outgoing-side: the wrapper forwarded to the real
                // setRequestHeader, so the underlying XHR has the header.
                // This alone is not load-bearing — the mock pushes
                // unconditionally — so we also assert the recording side.
                expect(setHeaderCalls).toEqual(expect.arrayContaining([{ header: name, value }]))

                // Recording-side: the wrapper recorded the header into
                // the network request payload that PostHog emits. If
                // this assertion holds, the wrapper definitely ran.
                expect(captured).not.toBeNull()
                expect(captured!.requests[0].requestHeaders).toEqual(
                    expect.objectContaining({ [name]: value })
                )
            }
        )
    })

    describe('does not modify what the underlying send() receives', () => {
        // XMLHttpRequestBodyInit per MDN:
        //   Document | Blob | BufferSource | FormData | URLSearchParams | string | null
        // Parameterising mirrors the coverage shape in
        // fetch-wrapper-invariants.test.ts.
        const bodyCases: Array<[string, () => any]> = [
            ['JSON string', () => '{"name":"Untitled","surveyType":"ClassicForm","visibility":"Mine"}'],
            ['plain text', () => 'plain text body'],
            ['empty string', () => ''],
            ['URL encoded', () => 'foo=bar&baz=qux'],
            ['Blob', () => new Blob(['blob content'], { type: 'text/plain' })],
            ['ArrayBuffer', () => new TextEncoder().encode('buffer content').buffer],
            ['Uint8Array', () => new Uint8Array([1, 2, 3])],
            [
                'URLSearchParams',
                () => new URLSearchParams({ foo: 'bar', baz: 'qux' }),
            ],
            [
                'FormData',
                () => {
                    const fd = new FormData()
                    fd.append('key', 'value')
                    return fd
                },
            ],
            ['null', () => null],
        ]

        it.each(bodyCases)('forwards %s body to underlying send unchanged', async (_label, makeBody) => {
            const { MockXMLHttpRequest, sendCalls, cbInvocations, cleanup } = setupWrappedXhrWithSafety()

            const xhr = new MockXMLHttpRequest()
            xhr.open('POST', 'https://example.com/api/internal/surveys')
            xhr.setRequestHeader('content-type', 'application/json')
            const body = makeBody()
            xhr.send(body)

            await triggerDoneAndFlush(xhr, cbInvocations)
            cleanup()

            // The underlying send must receive the EXACT same body
            // reference — copying it would change FormData boundaries,
            // exhaust a stream, or break ArrayBuffer transfer semantics.
            expect(sendCalls).toHaveLength(1)
            expect(sendCalls[0]).toBe(body)
        })
    })

    // Production tracing-headers patchXHR (entrypoints/tracing-headers.ts:54)
    // patches XMLHttpRequest.prototype.open and does NOT touch
    // setRequestHeader. When session recording also runs, the two
    // open-patches stack on the prototype. If this fails, a wrapper is
    // replacing prototype.open without delegating to the previous one.
    describe('double wrap (network-plugin + tracing-headers-style prototype.open patch)', () => {
        // Mirrors entrypoints/tracing-headers.ts:patchXHR. Patches
        // prototype.open in-place; returns a restore function.
        function patchPrototypeOpenWithTracingHeadersStyle(
            XHRClass: any,
            hostnames: string[],
            distinctId: string
        ): () => void {
            const originalOpen = XHRClass.prototype.open
            XHRClass.prototype.open = function (
                method: string,
                url: string | URL,
                async = true,
                username?: string | null,
                password?: string | null
            ) {
                const xhr = this
                // Production code creates a throw-away Request to compute
                // tracing-header values. We just snapshot whether this
                // wrapper ran by attaching a flag to the xhr instance.
                const reqUrl = typeof url === 'string' ? url : url.toString()
                let reqHostname: string | undefined
                try {
                    reqHostname = new URL(reqUrl).hostname
                } catch {
                    /* invalid URL — production also falls through */
                }
                if (reqHostname && hostnames.includes(reqHostname)) {
                    xhr.__tracingHeadersWrapperRan = { distinctId, url: reqUrl }
                }
                return originalOpen.call(xhr, method, reqUrl, async, username, password)
            }
            return () => {
                XHRClass.prototype.open = originalOpen
            }
        }

        it.each(csrfHeaderCases)(
            'inner=network-plugin, outer=tracing-headers — preserves %s and both wrappers run',
            async (name, value) => {
                const { MockXMLHttpRequest, setHeaderCalls, cbInvocations, cleanup } = setupWrappedXhrWithSafety()

                // network-plugin already patched the prototype. Stack the
                // tracing-headers-style patch on top.
                const restoreTracing = patchPrototypeOpenWithTracingHeadersStyle(
                    MockXMLHttpRequest,
                    ['example.com'],
                    'distinct-abc'
                )

                try {
                    const xhr = new MockXMLHttpRequest()
                    xhr.open('POST', 'https://example.com/api/internal/surveys')
                    xhr.setRequestHeader(name, value)
                    xhr.send('{}')

                    const captured = await triggerDoneAndFlush(xhr, cbInvocations)
                    cleanup()

                    // Outer wrapper ran (set the marker on the xhr).
                    expect((xhr as any).__tracingHeadersWrapperRan).toEqual({
                        distinctId: 'distinct-abc',
                        url: 'https://example.com/api/internal/surveys',
                    })

                    // Inner wrapper ran (recorded the header into cb payload).
                    expect(captured!.requests[0].requestHeaders).toEqual(
                        expect.objectContaining({ [name]: value })
                    )

                    // The real underlying setRequestHeader was invoked with
                    // the user's CSRF header — header reaches the XHR
                    // through both layers without being stripped.
                    expect(setHeaderCalls).toEqual(expect.arrayContaining([{ header: name, value }]))
                } finally {
                    restoreTracing()
                }
            }
        )

        it.each(csrfHeaderCases)(
            'inner=tracing-headers, outer=network-plugin — preserves %s and both wrappers run',
            async (name, value) => {
                // Set up a fresh class WITHOUT the network-plugin patch yet,
                // patch tracing-headers-style first, then attach
                // network-plugin on top via setupWrappedXhr (which patches
                // prototype.open via plugin.observer).
                const setHeaderCallsLocal: SetHeaderCall[] = []
                const sendCallsLocal: unknown[] = []
                const MockXMLHttpRequest = createMockXhrClass(setHeaderCallsLocal, sendCallsLocal)
                const restoreTracing = patchPrototypeOpenWithTracingHeadersStyle(
                    MockXMLHttpRequest,
                    ['example.com'],
                    'distinct-xyz'
                )

                ;(global as any).PerformanceObserver = MockPerformanceObserver
                let perfClockLocal = 0
                const mockWindow = {
                    performance: {
                        now: () => perfClockLocal++,
                        getEntriesByName: (url: string) => [fakeResourceTimingEntry(url)],
                    },
                    PerformanceObserver: MockPerformanceObserver,
                    XMLHttpRequest: MockXMLHttpRequest,
                } as any
                const cbInvocations: CapturedCb[] = []
                const plugin = getRecordNetworkPlugin({
                    recordHeaders: true,
                    recordBody: true,
                } as Partial<NetworkRecordOptions> as NetworkRecordOptions)
                const pluginCleanup = plugin.observer(
                    (data: CapturedCb) => cbInvocations.push(data),
                    mockWindow,
                    {
                        recordHeaders: true,
                        recordBody: true,
                        initiatorTypes: ['xmlhttprequest'],
                    } as any
                )

                try {
                    const xhr = new MockXMLHttpRequest()
                    xhr.open('POST', 'https://example.com/api/internal/surveys')
                    xhr.setRequestHeader(name, value)
                    xhr.send('{}')

                    const captured = await triggerDoneAndFlush(xhr, cbInvocations)

                    expect((xhr as any).__tracingHeadersWrapperRan).toEqual({
                        distinctId: 'distinct-xyz',
                        url: 'https://example.com/api/internal/surveys',
                    })
                    expect(captured!.requests[0].requestHeaders).toEqual(
                        expect.objectContaining({ [name]: value })
                    )
                    expect(setHeaderCallsLocal).toEqual(expect.arrayContaining([{ header: name, value }]))
                } finally {
                    pluginCleanup()
                    restoreTracing()
                }
            }
        )
    })
})
