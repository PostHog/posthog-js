import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '../uuidv7'
import { PostHog } from '../posthog-core'
import { DecideResponse } from '../types'
import { assignableWindow } from '../utils/globals'
import { FLUSH_TO_CAPTURE_TIMEOUT_MILLISECONDS } from '../extensions/web-vitals'

jest.mock('../utils/logger')
jest.useFakeTimers()

describe('web vitals', () => {
    let posthog: PostHog
    let onCapture = jest.fn()
    let onLCPCallback: ((metric: Record<string, any>) => void) | undefined = undefined
    let onCLSCallback: ((metric: Record<string, any>) => void) | undefined = undefined
    let onFCPCallback: ((metric: Record<string, any>) => void) | undefined = undefined
    let onINPCallback: ((metric: Record<string, any>) => void) | undefined = undefined
    const loadScriptMock = jest.fn()

    const randomlyAddAMetric = (
        metricName: string = 'metric',
        metricValue: number = 600.1,
        metricProperties: Record<string, any> = {}
    ) => {
        const callbacks = [onLCPCallback, onCLSCallback, onFCPCallback, onINPCallback]
        const randomIndex = Math.floor(Math.random() * callbacks.length)
        callbacks[randomIndex]?.({ name: metricName, value: metricValue, ...metricProperties })
    }

    const emitAllMetrics = () => {
        onLCPCallback?.({ name: 'LCP', value: 123.45, extra: 'property' })
        onCLSCallback?.({ name: 'CLS', value: 123.45, extra: 'property' })
        onFCPCallback?.({ name: 'FCP', value: 123.45, extra: 'property' })
        onINPCallback?.({ name: 'INP', value: 123.45, extra: 'property' })
    }

    const expectedEmittedWebVitals = (name: string) => ({
        $current_url: 'http://localhost/',
        $session_id: expect.any(String),
        $window_id: expect.any(String),
        timestamp: expect.any(Number),
        name: name,
        value: 123.45,
        extra: 'property',
    })

    describe('the behaviour', () => {
        beforeEach(async () => {
            posthog = await createPosthogInstance(uuidv7(), {
                _onCapture: onCapture,
                capture_performance: { web_vitals: true },
            })

            loadScriptMock.mockImplementation((_path, callback) => {
                // we need a set of fake web vitals handlers, so we can manually trigger the events
                assignableWindow.postHogWebVitalsCallbacks = {
                    onLCP: (cb: any) => {
                        onLCPCallback = cb
                    },
                    onCLS: (cb: any) => {
                        onCLSCallback = cb
                    },
                    onFCP: (cb: any) => {
                        onFCPCallback = cb
                    },
                    onINP: (cb: any) => {
                        onINPCallback = cb
                    },
                }
                callback()
            })

            posthog.requestRouter.loadScript = loadScriptMock

            // need to force this to get the web vitals script loaded
            posthog.webVitalsAutocapture!.afterDecideResponse({
                capturePerformance: { web_vitals: true },
            } as unknown as DecideResponse)
        })

        it('should emit when all 4 metrics are captured', async () => {
            emitAllMetrics()

            expect(onCapture).toBeCalledTimes(1)

            expect(onCapture.mock.lastCall).toMatchObject([
                '$web_vitals',
                {
                    event: '$web_vitals',
                    properties: {
                        $web_vitals_LCP_event: expectedEmittedWebVitals('LCP'),
                        $web_vitals_LCP_value: 123.45,
                        $web_vitals_CLS_event: expectedEmittedWebVitals('CLS'),
                        $web_vitals_CLS_value: 123.45,
                        $web_vitals_FCP_event: expectedEmittedWebVitals('FCP'),
                        $web_vitals_FCP_value: 123.45,
                        $web_vitals_INP_event: expectedEmittedWebVitals('INP'),
                        $web_vitals_INP_value: 123.45,
                    },
                },
            ])
        })

        it('should emit after 8 seconds even when only 1 to 3 metrics captured', async () => {
            randomlyAddAMetric('LCP', 123.45, { extra: 'property' })

            expect(onCapture).toBeCalledTimes(0)

            jest.advanceTimersByTime(FLUSH_TO_CAPTURE_TIMEOUT_MILLISECONDS + 1)

            // for some reason advancing the timer emits a $pageview event as well 🤷
            // expect(onCapture).toBeCalledTimes(2)
            expect(onCapture.mock.lastCall).toMatchObject([
                '$web_vitals',
                {
                    event: '$web_vitals',
                    properties: {
                        $web_vitals_LCP_event: expectedEmittedWebVitals('LCP'),
                        $web_vitals_LCP_value: 123.45,
                    },
                },
            ])
        })
    })

    describe('afterDecideResponse()', () => {
        beforeEach(async () => {
            // we need a set of fake web vitals handlers so we can manually trigger the events
            assignableWindow.postHogWebVitalsCallbacks = {
                onLCP: (cb: any) => {
                    onLCPCallback = cb
                },
                onCLS: (cb: any) => {
                    onCLSCallback = cb
                },
                onFCP: (cb: any) => {
                    onFCPCallback = cb
                },
                onINP: (cb: any) => {
                    onINPCallback = cb
                },
            }

            onCapture = jest.fn()
            posthog = await createPosthogInstance(uuidv7(), {
                _onCapture: onCapture,
            })
        })

        it('should not be enabled before the decide response', () => {
            expect(posthog.webVitalsAutocapture!.isEnabled).toBe(false)
        })

        it('should be enabled if client config option is enabled', () => {
            posthog.config.capture_performance = { web_vitals: true }
            expect(posthog.webVitalsAutocapture!.isEnabled).toBe(true)
        })

        it.each([
            // Client not defined
            [undefined, false, false],
            [undefined, true, true],
            [undefined, false, false],
            // Client false
            [false, false, false],
            [false, true, false],

            // Client true
            [true, false, true],
            [true, true, true],
        ])(
            'when client side config is %p and remote opt in is %p - web vitals enabled should be %p',
            (clientSideOptIn, serverSideOptIn, expected) => {
                posthog.config.capture_performance = { web_vitals: clientSideOptIn }
                posthog.webVitalsAutocapture!.afterDecideResponse({
                    capturePerformance: { web_vitals: serverSideOptIn },
                } as DecideResponse)
                expect(posthog.webVitalsAutocapture!.isEnabled).toBe(expected)
            }
        )
    })
})
