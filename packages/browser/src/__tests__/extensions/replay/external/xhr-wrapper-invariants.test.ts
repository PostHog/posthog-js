/**
 * @jest-environment node
 */

import { getRecordNetworkPlugin } from '../../../../extensions/replay/external/network-plugin'
import { NetworkRecordOptions } from '../../../../types'

class MockPerformanceObserver {
    static supportedEntryTypes = ['resource']
    observe() {}
    disconnect() {}
}

type SetHeaderCall = { header: string; value: string }

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

function setupWrappedXhr() {
    const setHeaderCalls: SetHeaderCall[] = []
    const sendCalls: unknown[] = []

    ;(global as any).PerformanceObserver = MockPerformanceObserver

    const MockXMLHttpRequest = createMockXhrClass(setHeaderCalls, sendCalls)

    const mockWindow = {
        performance: { now: () => Date.now(), getEntriesByName: () => [] },
        PerformanceObserver: MockPerformanceObserver,
        XMLHttpRequest: MockXMLHttpRequest,
    } as any

    const plugin = getRecordNetworkPlugin({
        recordHeaders: true,
        recordBody: true,
    } as Partial<NetworkRecordOptions> as NetworkRecordOptions)
    const cleanup = plugin.observer(() => {}, mockWindow, {
        recordHeaders: true,
        recordBody: true,
        initiatorTypes: ['xmlhttprequest'],
    } as any)

    return { mockWindow, MockXMLHttpRequest, setHeaderCalls, sendCalls, cleanup }
}

describe('xhr wrapper', () => {
    beforeEach(() => jest.useFakeTimers())
    afterEach(() => jest.useRealTimers())

    describe('does not strip headers from the actual outgoing request', () => {
        const headerCases = [
            ['x-csrf-token', 'r_lIDFH3NdoomvNNKK5SWHg3KFOpWvnARWDvvi_TbwY'],
            ['x-csrftoken', 'django-style-csrf'],
            ['x-xsrf-token', 'angular-style-xsrf'],
            ['authorization', 'Bearer abc123'],
            ['x-api-key', 'sk-test-1234'],
            ['cache-control', 'no-cache'],
            ['pragma', 'no-cache'],
        ] as const

        it.each(headerCases)('forwards %s to the underlying XMLHttpRequest.setRequestHeader', (name, value) => {
            const { MockXMLHttpRequest, setHeaderCalls, cleanup } = setupWrappedXhr()

            const xhr = new MockXMLHttpRequest()
            xhr.open('POST', 'https://example.com/api/internal/surveys')
            xhr.setRequestHeader(name, value)

            cleanup()

            expect(setHeaderCalls).toEqual(
                expect.arrayContaining([{ header: name, value }])
            )
        })
    })

    describe('does not modify what the underlying send() receives', () => {
        it('forwards the original body to underlying send', () => {
            const { MockXMLHttpRequest, sendCalls, cleanup } = setupWrappedXhr()

            const xhr = new MockXMLHttpRequest()
            xhr.open('POST', 'https://example.com/api/internal/surveys')
            xhr.setRequestHeader('content-type', 'application/json')
            const body = '{"name":"Untitled","surveyType":"ClassicForm","visibility":"Mine"}'
            xhr.send(body)

            cleanup()

            expect(sendCalls).toEqual([body])
        })
    })

    // Both the network-plugin wrapper and the tracing-headers wrapper patch
    // XMLHttpRequest.prototype.open. In the product they're both applied
    // when __add_tracing_headers is configured alongside session recording.
    // Each open patch ALSO patches setRequestHeader on the instance, so
    // setRequestHeader can end up double-wrapped. The user-supplied header
    // must still reach the underlying XHR.
    describe('double wrap (network-plugin + tracing-headers-style setRequestHeader patch)', () => {
        // Wraps an instance's setRequestHeader the same way both wrappers do:
        // replace with a function that records, then forwards to the previous one.
        function wrapInstanceSetRequestHeader(
            xhr: { setRequestHeader: (h: string, v: string) => void },
            sink: SetHeaderCall[]
        ) {
            const previous = xhr.setRequestHeader.bind(xhr)
            xhr.setRequestHeader = (header: string, value: string) => {
                sink.push({ header, value })
                return previous(header, value)
            }
        }

        const csrfHeaderCases = [
            ['x-csrf-token', 'r_lIDFH3NdoomvNNKK5SWHg3KFOpWvnARWDvvi_TbwY'],
            ['x-csrftoken', 'django-style-csrf'],
            ['x-xsrf-token', 'angular-style-xsrf'],
        ] as const

        it.each(csrfHeaderCases)(
            'forwards %s through both layers when an outer wrapper patches setRequestHeader after open',
            (name, value) => {
                const { MockXMLHttpRequest, setHeaderCalls, cleanup } = setupWrappedXhr()
                const outerCalls: SetHeaderCall[] = []

                const xhr = new MockXMLHttpRequest()
                xhr.open('POST', 'https://example.com/api/internal/surveys')

                wrapInstanceSetRequestHeader(xhr, outerCalls)

                xhr.setRequestHeader(name, value)

                cleanup()

                expect(outerCalls).toEqual([{ header: name, value }])
                expect(setHeaderCalls).toEqual(expect.arrayContaining([{ header: name, value }]))
            }
        )

        it.each(csrfHeaderCases)(
            'forwards %s through both layers when an inner wrapper patches setRequestHeader before open',
            (name, value) => {
                const { MockXMLHttpRequest, setHeaderCalls, cleanup } = setupWrappedXhr()
                const innerCalls: SetHeaderCall[] = []

                const xhr = new MockXMLHttpRequest()
                wrapInstanceSetRequestHeader(xhr, innerCalls)
                xhr.open('POST', 'https://example.com/api/internal/surveys')

                xhr.setRequestHeader(name, value)

                cleanup()

                expect(innerCalls).toEqual([{ header: name, value }])
                expect(setHeaderCalls).toEqual(expect.arrayContaining([{ header: name, value }]))
            }
        )
    })
})
