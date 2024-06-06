import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '../uuidv7'
import { PostHog } from '../posthog-core'
import { DecideResponse } from '../types'
import { assignableWindow } from '../utils/globals'
jest.mock('../utils/logger')

describe('web vitals', () => {
    let posthog: PostHog
    let onCapture = jest.fn()
    let onLCPCallback: ((metric: Record<string, any>) => void) | undefined = undefined
    let onCLSCallback: ((metric: Record<string, any>) => void) | undefined = undefined
    let onFCPCallback: ((metric: Record<string, any>) => void) | undefined = undefined
    let onINPCallback: ((metric: Record<string, any>) => void) | undefined = undefined

    const randomlyCallACallback = (
        metricName: string = 'metric',
        metricValue: number = 600.1,
        metricProperties: Record<string, any> = {}
    ) => {
        const callbacks = [onLCPCallback, onCLSCallback, onFCPCallback, onINPCallback]
        const randomIndex = Math.floor(Math.random() * callbacks.length)
        callbacks[randomIndex]?.({ name: metricName, value: metricValue, ...metricProperties })
    }

    describe('the behaviour', () => {
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
                capture_performance: { web_vitals: true },
            })
        })

        it('should include generated web vitals data', async () => {
            randomlyCallACallback('the metric', 123.45, { extra: 'property' })

            posthog.capture('test event')

            expect(onCapture).toBeCalledTimes(1)
            expect(onCapture.mock.lastCall).toMatchObject([
                'test event',
                {
                    event: 'test event',
                    properties: {
                        $web_vitals_data: [
                            {
                                $current_url: 'http://localhost/',
                                $session_id: expect.any(String),
                                $window_id: expect.any(String),
                                timestamp: expect.any(Number),
                                name: 'the metric',
                                value: 123.45,
                                // all the object properties are included
                                extra: 'property',
                            },
                        ],
                    },
                },
            ])
        })

        it('should clear the buffer after each call', async () => {
            randomlyCallACallback()

            posthog.capture('test event')
            expect(onCapture).toBeCalledTimes(1)
            expect(onCapture.mock.lastCall[1].properties.$web_vitals_data).toHaveLength(1)

            posthog.capture('test event 2')
            expect(onCapture).toBeCalledTimes(2)
            expect(onCapture.mock.lastCall[1].properties.$web_vitals_data).toBeUndefined()
        })

        it('should not include generated web vitals data with _noPassengerEvents', async () => {
            randomlyCallACallback()

            posthog.capture('anything', undefined, { _noPassengerEvents: true })

            expect(onCapture).toBeCalledTimes(1)
            expect(onCapture.mock.lastCall).toMatchObject(['anything', {}])
            expect(onCapture.mock.lastCall[1].properties).not.toHaveProperty('$web_vitals_data')
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
