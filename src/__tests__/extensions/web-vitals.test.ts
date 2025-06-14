import '../helpers/mock-logger'

import { createPosthogInstance } from '../helpers/posthog-instance'
import { uuidv7 } from '../../uuidv7'
import { PostHog } from '../../posthog-core'
import { FlagsResponse, PerformanceCaptureConfig, RemoteConfig, SupportedWebVitalsMetrics } from '../../types'
import { assignableWindow } from '../../utils/globals'
import { DEFAULT_FLUSH_TO_CAPTURE_TIMEOUT_MILLISECONDS, FIFTEEN_MINUTES_IN_MILLIS } from '../../extensions/web-vitals'

jest.useFakeTimers()

let mockLocation: jest.Mock

jest.mock('../../utils/globals', () => {
    const original = jest.requireActual('../../utils/globals')
    mockLocation = jest.fn().mockReturnValue({
        protocol: 'http:',
        host: 'localhost',
        pathname: '/',
        search: '',
        hash: '',
        href: 'http://localhost/',
    })
    return {
        ...original,
        assignableWindow: {
            ...original.assignableWindow,
            __PosthogExtensions__: {},
        },
        get location() {
            return mockLocation()
        },
    }
})

describe('web vitals', () => {
    let posthog: PostHog
    let beforeSendMock = jest.fn().mockImplementation((e) => e)
    let onLCPCallback: ((metric: Record<string, any>) => void) | undefined = undefined
    let onCLSCallback: ((metric: Record<string, any>) => void) | undefined = undefined
    let onFCPCallback: ((metric: Record<string, any>) => void) | undefined = undefined
    let onINPCallback: ((metric: Record<string, any>) => void) | undefined = undefined
    const loadScriptMock = jest.fn()

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

    describe.each([
        [
            undefined,
            ['CLS', 'FCP', 'INP', 'LCP'] as SupportedWebVitalsMetrics[],
            {
                $web_vitals_LCP_event: expectedEmittedWebVitals('LCP'),
                $web_vitals_LCP_value: 123.45,
                $web_vitals_CLS_event: expectedEmittedWebVitals('CLS'),
                $web_vitals_CLS_value: 123.45,
                $web_vitals_FCP_event: expectedEmittedWebVitals('FCP'),
                $web_vitals_FCP_value: 123.45,
                $web_vitals_INP_event: expectedEmittedWebVitals('INP'),
                $web_vitals_INP_value: 123.45,
            },
        ],
        [
            ['CLS', 'FCP', 'INP', 'LCP'] as SupportedWebVitalsMetrics[],
            ['CLS', 'FCP', 'INP', 'LCP'] as SupportedWebVitalsMetrics[],
            {
                $web_vitals_LCP_event: expectedEmittedWebVitals('LCP'),
                $web_vitals_LCP_value: 123.45,
                $web_vitals_CLS_event: expectedEmittedWebVitals('CLS'),
                $web_vitals_CLS_value: 123.45,
                $web_vitals_FCP_event: expectedEmittedWebVitals('FCP'),
                $web_vitals_FCP_value: 123.45,
                $web_vitals_INP_event: expectedEmittedWebVitals('INP'),
                $web_vitals_INP_value: 123.45,
            },
        ],
        [
            ['CLS', 'FCP'] as SupportedWebVitalsMetrics[],
            ['CLS', 'FCP'] as SupportedWebVitalsMetrics[],
            {
                $web_vitals_CLS_event: expectedEmittedWebVitals('CLS'),
                $web_vitals_CLS_value: 123.45,
                $web_vitals_FCP_event: expectedEmittedWebVitals('FCP'),
                $web_vitals_FCP_value: 123.45,
            },
        ],
    ])(
        'the behaviour when client config is %s',
        (
            clientConfig: SupportedWebVitalsMetrics[] | undefined,
            expectedAllowedMetrics: SupportedWebVitalsMetrics[],
            expectedProperties: Record<string, any>
        ) => {
            beforeEach(async () => {
                beforeSendMock.mockClear()
                posthog = await createPosthogInstance(uuidv7(), {
                    before_send: beforeSendMock,
                    capture_performance: { web_vitals: true, web_vitals_allowed_metrics: clientConfig },
                    // sometimes pageviews sneak in and make asserting on mock capture tricky
                    capture_pageview: false,
                })

                loadScriptMock.mockImplementation((_ph, _path, callback) => {
                    // we need a set of fake web vitals handlers, so we can manually trigger the events
                    assignableWindow.__PosthogExtensions__ = {}
                    assignableWindow.__PosthogExtensions__.postHogWebVitalsCallbacks = {
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

                assignableWindow.__PosthogExtensions__ = {}
                assignableWindow.__PosthogExtensions__.loadExternalDependency = loadScriptMock

                // need to force this to get the web vitals script loaded
                posthog.webVitalsAutocapture!.onRemoteConfig({
                    capturePerformance: { web_vitals: true },
                } as unknown as FlagsResponse)

                expect(posthog.webVitalsAutocapture.allowedMetrics).toEqual(expectedAllowedMetrics)
            })

            it('should emit when all allowed metrics are captured', async () => {
                emitAllMetrics()

                expect(beforeSendMock).toBeCalledTimes(1)

                expect(beforeSendMock.mock.lastCall).toMatchObject([
                    {
                        event: '$web_vitals',
                        properties: expectedProperties,
                    },
                ])
            })

            it('should emit after 5 seconds even when only 1 to 3 metrics captured', async () => {
                onCLSCallback?.({ name: 'CLS', value: 123.45, extra: 'property' })

                expect(beforeSendMock).toBeCalledTimes(0)

                jest.advanceTimersByTime(DEFAULT_FLUSH_TO_CAPTURE_TIMEOUT_MILLISECONDS + 1)

                // for some reason advancing the timer emits a $pageview event as well 🤷
                expect(beforeSendMock.mock.lastCall).toMatchObject([
                    {
                        event: '$web_vitals',
                        properties: {
                            $web_vitals_CLS_event: expectedEmittedWebVitals('CLS'),
                            $web_vitals_CLS_value: 123.45,
                        },
                    },
                ])
            })

            it('should emit after configured timeout even when only 1 to 3 metrics captured', async () => {
                ;(posthog.config.capture_performance as PerformanceCaptureConfig).web_vitals_delayed_flush_ms = 1000
                onCLSCallback?.({ name: 'CLS', value: 123.45, extra: 'property' })

                expect(beforeSendMock).toBeCalledTimes(0)

                jest.advanceTimersByTime(1000 + 1)

                expect(beforeSendMock.mock.lastCall).toMatchObject([
                    {
                        event: '$web_vitals',
                        properties: {
                            $web_vitals_CLS_event: expectedEmittedWebVitals('CLS'),
                            $web_vitals_CLS_value: 123.45,
                        },
                    },
                ])
            })

            it('should ignore a ridiculous value', async () => {
                onCLSCallback?.({ name: 'CLS', value: FIFTEEN_MINUTES_IN_MILLIS, extra: 'property' })

                expect(beforeSendMock).toBeCalledTimes(0)

                jest.advanceTimersByTime(DEFAULT_FLUSH_TO_CAPTURE_TIMEOUT_MILLISECONDS + 1)

                expect(beforeSendMock.mock.calls).toEqual([])
            })

            it('can be configured not to ignore a ridiculous value', async () => {
                posthog.config.capture_performance = { __web_vitals_max_value: 0 }
                onCLSCallback?.({ name: 'CLS', value: FIFTEEN_MINUTES_IN_MILLIS, extra: 'property' })

                expect(beforeSendMock).toBeCalledTimes(0)

                jest.advanceTimersByTime(DEFAULT_FLUSH_TO_CAPTURE_TIMEOUT_MILLISECONDS + 1)

                expect(beforeSendMock).toBeCalledTimes(1)
            })
        }
    )

    describe('afterFlagsResponse()', () => {
        beforeEach(async () => {
            // we need a set of fake web vitals handlers, so we can manually trigger the events
            assignableWindow.__PosthogExtensions__ = {}
            assignableWindow.__PosthogExtensions__.postHogWebVitalsCallbacks = {
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

            beforeSendMock = jest.fn()
            posthog = await createPosthogInstance(uuidv7(), {
                before_send: beforeSendMock,
            })
        })

        it('should not be enabled before the flags response', () => {
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
                posthog.webVitalsAutocapture!.onRemoteConfig({
                    capturePerformance: { web_vitals: serverSideOptIn },
                } as FlagsResponse)
                expect(posthog.webVitalsAutocapture!.isEnabled).toBe(expected)
            }
        )
    })

    it('should be disabled if capture_performance is set to false', async () => {
        posthog = await createPosthogInstance(uuidv7(), {
            before_send: beforeSendMock,
            capture_performance: false,
        })

        expect(posthog.webVitalsAutocapture!.isEnabled).toBe(false)
    })

    it('should be disabled if capture_performance is set to false even if enabled server-side', async () => {
        posthog = await createPosthogInstance(uuidv7(), {
            before_send: beforeSendMock,
            capture_performance: false,
        })

        posthog.webVitalsAutocapture!.onRemoteConfig({
            capturePerformance: {
                web_vitals: true,
            },
        } as RemoteConfig)

        expect(posthog.webVitalsAutocapture!.isEnabled).toBe(false)
    })

    it('should not run on file:// protocol', async () => {
        mockLocation.mockReturnValue({
            protocol: 'file:',
            host: ' ',
            pathname: '/Users/robbie/Desktop/test.html',
            search: '',
            hash: '',
            href: 'file:///Users/robbie/Desktop/test.html',
        })

        posthog = await createPosthogInstance(uuidv7(), {
            before_send: beforeSendMock,
            capture_performance: { web_vitals: true },
        })

        posthog.webVitalsAutocapture!.onRemoteConfig({
            capturePerformance: { web_vitals: true },
        } as RemoteConfig)

        expect(posthog.webVitalsAutocapture!.isEnabled).toBe(false)
    })

    it.each([
        // hybrid app tools
        'capacitor',
        'capacitor-electron',
        'tauri',
        'ionic',
        'wails',
        'android-app',
        'ms-appx-web',
        // browser extensions
        'chrome',
        'chrome-extension',
        'moz-extension',
        'safari-web-extension',
        'vscode-webview',
        // local files
        'file',
        'blob',
        'data',
        'content',
        'dfile',
        'javascript',
        'about',
        'localhost',
        // email clients
        'ms-outlook',
        'email',
        // misc
        'ws',
        'wss',
        'ftp',
        'unknown',
    ])('should not run on %s protocol', async (protocol) => {
        mockLocation.mockReturnValue({
            protocol: protocol + ':',
            host: 'localhost',
            pathname: '/',
            search: '',
            hash: '',
            href: `${protocol}://localhost/`,
        })

        posthog = await createPosthogInstance(uuidv7(), {
            before_send: beforeSendMock,
            capture_performance: { web_vitals: true },
        })

        posthog.webVitalsAutocapture!.onRemoteConfig({
            capturePerformance: { web_vitals: true },
        } as RemoteConfig)

        expect(posthog.webVitalsAutocapture!.isEnabled).toBe(false)
    })
    it.each(['http', 'https'])('should run on %s protocol', async (protocol) => {
        mockLocation.mockReturnValue({
            protocol: protocol + ':',
            host: 'localhost',
            pathname: '/',
            search: '',
            hash: '',
            href: `${protocol}://localhost/`,
        })

        posthog = await createPosthogInstance(uuidv7(), {
            before_send: beforeSendMock,
            capture_performance: { web_vitals: true },
        })

        posthog.webVitalsAutocapture!.onRemoteConfig({
            capturePerformance: { web_vitals: true },
        } as FlagsResponse)

        expect(posthog.webVitalsAutocapture!.isEnabled).toBe(true)
    })
})
