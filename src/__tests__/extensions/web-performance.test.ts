/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable compat/compat */

import { WebPerformanceObserver } from '../../extensions/web-performance'
import { PostHog } from '../../posthog-core'
import { NetworkRequest, PostHogConfig } from '../../types'

const createMockPerformanceEntry = (overrides: Partial<PerformanceEntry> = {}): PerformanceEntry => {
    const entry = {
        name: 'http://example.com/api/1',
        duration: 100,
        entryType: 'fetch',
        startTime: Date.now() - 1000,
        ...overrides,
        toJSON: () => {
            return {
                ...entry,
                toJSON: undefined,
            }
        },
    }

    return entry
}

describe('WebPerformance', () => {
    let webPerformance: WebPerformanceObserver
    let mockPostHogInstance: any
    const mockConfig: Partial<PostHogConfig> = {
        api_host: 'https://app.posthog.com',
        session_recording: {
            maskNetworkRequestFn: (networkRequest: NetworkRequest) => networkRequest,
        },
    }

    beforeEach(() => {
        mockPostHogInstance = {
            get_config: jest.fn((key: string) => mockConfig[key as keyof PostHogConfig]),
            sessionRecording: {
                onRRwebEmit: jest.fn(),
            },
        }
        webPerformance = new WebPerformanceObserver(mockPostHogInstance as PostHog)
        jest.clearAllMocks()
        jest.useFakeTimers()
        jest.setSystemTime(new Date('2023-01-01'))
        performance.now = jest.fn(() => Date.now())
    })

    describe('when the browser does not support performance observer', () => {
        const OriginalPerformanceObserver = window.PerformanceObserver

        beforeAll(() => {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            window.PerformanceObserver = undefined
        })

        afterAll(() => {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            window.PerformanceObserver = OriginalPerformanceObserver
        })

        it('should not start the observer', () => {
            const webPerformance = new WebPerformanceObserver(mockPostHogInstance as PostHog)
            webPerformance.startObserving()
            expect(webPerformance.isObserving()).toBe(false)
        })
    })

    describe('_capturePerformanceEvent', () => {
        it('should capture and save a standard perf event', () => {
            webPerformance._capturePerformanceEvent(
                createMockPerformanceEntry({
                    name: 'http://example.com/api/1',
                })
            )

            expect(mockPostHogInstance.sessionRecording.onRRwebEmit).toHaveBeenCalledTimes(1)
            expect(mockPostHogInstance.sessionRecording.onRRwebEmit).toHaveBeenCalledWith({
                data: {
                    payload: {
                        '0': 'fetch',
                        '1': 0,
                        '2': 'http://example.com/api/1',
                        '3': 1672531199000,
                        '39': 100,
                        '40': 1672531199000,
                    },
                    plugin: 'posthog/network@1',
                },
                timestamp: 1672531199000,
                type: 6,
            })
        })

        it('should ignore posthog network events', () => {
            webPerformance._capturePerformanceEvent(
                createMockPerformanceEntry({
                    name: 'https://app.posthog.com/s/',
                })
            )

            expect(mockPostHogInstance.sessionRecording.onRRwebEmit).toHaveBeenCalledTimes(0)
        })

        it('should ignore events with maskNetworkRequestFn returning null', () => {
            mockConfig.session_recording!.maskNetworkRequestFn = (event) => {
                if (event.url.includes('ignore')) {
                    return null
                }
                return event
            }
            ;[
                'https://example.com/ignore/',
                'https://example.com/capture/',
                'https://ignore.example.com/capture/',
            ].forEach((url) => {
                webPerformance._capturePerformanceEvent(
                    createMockPerformanceEntry({
                        name: url,
                    })
                )
            })
            expect(mockPostHogInstance.sessionRecording.onRRwebEmit).toHaveBeenCalledTimes(1)
        })

        it('should allow modifying of the content via maskNetworkRequestFn', () => {
            mockConfig.session_recording!.maskNetworkRequestFn = (event) => {
                event.url = event.url.replace('example', 'replaced')
                return event
            }

            webPerformance._capturePerformanceEvent(
                createMockPerformanceEntry({
                    name: 'https://example.com/capture/',
                })
            )

            expect(mockPostHogInstance.sessionRecording.onRRwebEmit).toHaveBeenCalledTimes(1)
            expect(mockPostHogInstance.sessionRecording.onRRwebEmit).toHaveBeenCalledWith({
                data: {
                    payload: {
                        '0': 'fetch',
                        '1': 0,
                        '2': 'https://replaced.com/capture/',
                        '3': 1672531199000,
                        '39': 100,
                        '40': 1672531199000,
                    },
                    plugin: 'posthog/network@1',
                },
                timestamp: 1672531199000,
                type: 6,
            })
        })
    })
})
