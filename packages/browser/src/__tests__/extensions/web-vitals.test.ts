import '../helpers/mock-logger'

import { createPosthogInstance } from '../helpers/posthog-instance'
import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'
import { PostHog } from '../../posthog-core'
import { FlagsResponse, PerformanceCaptureConfig, RemoteConfig, SupportedWebVitalsMetrics } from '../../types'
import { assignableWindow } from '../../utils/globals'
import { DEFAULT_FLUSH_TO_CAPTURE_TIMEOUT_MILLISECONDS, FIFTEEN_MINUTES_IN_MILLIS } from '../../extensions/web-vitals'
import {
    WEB_VITALS_ENABLED_SERVER_SIDE,
    WEB_VITALS_ALLOWED_METRICS,
    COOKIELESS_MODE_FLAG_PROPERTY,
} from '../../constants'

jest.useFakeTimers()

// `var` so the hoisted jest.mock factory below can assign to it without TDZ.
// Previously masked by babel-jest transpiling `let` -> `var` because IE 11
// was in package.json#browserslist. `jest.hoisted()` would be the modern
// fix but needs babel-plugin-jest-hoist 30 (jest 30 catalog bump).
// eslint-disable-next-line no-var
var mockLocation: jest.Mock

jest.mock('@posthog/browser-common/utils/globals', () => {
    const original = jest.requireActual('@posthog/browser-common/utils/globals')
    mockLocation = jest.fn().mockReturnValue({
        protocol: 'http:',
        host: 'localhost',
        pathname: '/',
        search: '',
        hash: '',
        href: 'http://localhost/',
    })

    const mockWindow = original.window || global.window
    Object.defineProperty(mockWindow, 'location', {
        get: () => mockLocation(),
        configurable: true,
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
        window: mockWindow,
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
            null,
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
            clientConfig: SupportedWebVitalsMetrics[] | undefined | null,
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
                    ok: true,
                    config: {
                        capturePerformance: { web_vitals: true },
                    } as unknown as FlagsResponse,
                })

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

    describe('cookieless_mode (no SessionIdManager)', () => {
        const expectedEmittedWebVitalsCookieless = (name: string) => ({
            $current_url: 'http://localhost/',
            timestamp: expect.any(Number),
            name: name,
            value: 123.45,
            extra: 'property',
        })

        beforeEach(async () => {
            beforeSendMock.mockClear()
            onLCPCallback = undefined
            onCLSCallback = undefined
            onFCPCallback = undefined
            onINPCallback = undefined

            posthog = await createPosthogInstance(uuidv7(), {
                before_send: beforeSendMock,
                cookieless_mode: 'always',
                capture_performance: { web_vitals: true, web_vitals_allowed_metrics: ['CLS', 'FCP'] },
                capture_pageview: false,
            })

            expect(posthog.sessionManager).toBeUndefined()

            loadScriptMock.mockImplementation((_ph, _path, callback) => {
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

            posthog.webVitalsAutocapture!.onRemoteConfig({
                ok: true,
                config: {
                    capturePerformance: { web_vitals: true },
                } as unknown as FlagsResponse,
            })

            expect(posthog.webVitalsAutocapture!.allowedMetrics).toEqual(['CLS', 'FCP'])
        })

        it('emits web vitals without nested $session_id or $window_id; sets $cookieless_mode on payload', async () => {
            onCLSCallback?.({ name: 'CLS', value: 123.45, extra: 'property' })
            onFCPCallback?.({ name: 'FCP', value: 123.45, extra: 'property' })

            expect(beforeSendMock).toBeCalledTimes(1)

            const payload = beforeSendMock.mock.calls[0][0]
            expect(payload.event).toBe('$web_vitals')
            expect(payload.properties[COOKIELESS_MODE_FLAG_PROPERTY]).toBe(true)
            expect(payload.properties.$web_vitals_CLS_event).toEqual(expectedEmittedWebVitalsCookieless('CLS'))
            expect(payload.properties.$web_vitals_FCP_event).toEqual(expectedEmittedWebVitalsCookieless('FCP'))
            expect(payload.properties.$web_vitals_CLS_event).not.toHaveProperty('$session_id')
            expect(payload.properties.$web_vitals_CLS_event).not.toHaveProperty('$window_id')
            expect(payload.properties.$web_vitals_FCP_event).not.toHaveProperty('$session_id')
            expect(payload.properties.$web_vitals_FCP_event).not.toHaveProperty('$window_id')
        })

        it('emits on delayed flush without nested session ids when only one metric is captured', async () => {
            onCLSCallback?.({ name: 'CLS', value: 123.45, extra: 'property' })

            jest.advanceTimersByTime(DEFAULT_FLUSH_TO_CAPTURE_TIMEOUT_MILLISECONDS + 1)

            expect(beforeSendMock).toBeCalledTimes(1)
            const payload = beforeSendMock.mock.calls[0][0]
            expect(payload.event).toBe('$web_vitals')
            expect(payload.properties[COOKIELESS_MODE_FLAG_PROPERTY]).toBe(true)
            expect(payload.properties.$web_vitals_CLS_event).not.toHaveProperty('$session_id')
            expect(payload.properties.$web_vitals_CLS_event).not.toHaveProperty('$window_id')
        })
    })

    describe('cookieless_mode on_reject after opt_out', () => {
        const expectedEmittedWebVitalsCookieless = (name: string) => ({
            $current_url: 'http://localhost/',
            timestamp: expect.any(Number),
            name: name,
            value: 123.45,
            extra: 'property',
        })

        beforeEach(async () => {
            beforeSendMock.mockClear()
            onLCPCallback = undefined
            onCLSCallback = undefined
            onFCPCallback = undefined
            onINPCallback = undefined

            posthog = await createPosthogInstance(uuidv7(), {
                before_send: beforeSendMock,
                cookieless_mode: 'on_reject',
                capture_performance: { web_vitals: true, web_vitals_allowed_metrics: ['CLS', 'FCP'] },
                capture_pageview: false,
            })

            posthog.opt_out_capturing()
            beforeSendMock.mockClear()

            expect(posthog.sessionManager).toBeUndefined()

            loadScriptMock.mockImplementation((_ph, _path, callback) => {
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

            posthog.webVitalsAutocapture!.onRemoteConfig({
                ok: true,
                config: {
                    capturePerformance: { web_vitals: true },
                } as unknown as FlagsResponse,
            })

            expect(posthog.webVitalsAutocapture!.allowedMetrics).toEqual(['CLS', 'FCP'])
        })

        it('emits cookieless web vitals after opt_out with no nested session ids', async () => {
            onCLSCallback?.({ name: 'CLS', value: 123.45, extra: 'property' })
            onFCPCallback?.({ name: 'FCP', value: 123.45, extra: 'property' })

            expect(beforeSendMock).toBeCalledTimes(1)

            const payload = beforeSendMock.mock.calls[0][0]
            expect(payload.event).toBe('$web_vitals')
            expect(payload.properties[COOKIELESS_MODE_FLAG_PROPERTY]).toBe(true)
            expect(payload.properties.distinct_id).toBe('$posthog_cookieless')
            expect(payload.properties.$session_id).toBeUndefined()
            expect(payload.properties.$window_id).toBeUndefined()
            expect(payload.properties.$web_vitals_CLS_event).toEqual(expectedEmittedWebVitalsCookieless('CLS'))
            expect(payload.properties.$web_vitals_FCP_event).toEqual(expectedEmittedWebVitalsCookieless('FCP'))
            expect(payload.properties.$web_vitals_CLS_event).not.toHaveProperty('$session_id')
            expect(payload.properties.$web_vitals_FCP_event).not.toHaveProperty('$session_id')
        })
    })

    describe('web_vitals_attribution config', () => {
        it.each([
            [undefined, false],
            [true, true],
            [false, false],
        ])(
            'when web_vitals_attribution is %p, useAttribution should be %p',
            async (attributionConfig, expectedUseAttribution) => {
                posthog = await createPosthogInstance(uuidv7(), {
                    capture_performance: { web_vitals: true, web_vitals_attribution: attributionConfig },
                    capture_pageview: false,
                })

                expect(posthog.webVitalsAutocapture!.useAttribution).toBe(expectedUseAttribution)
            }
        )

        it.each([
            [undefined, 'web-vitals'],
            [false, 'web-vitals'],
            [true, 'web-vitals-with-attribution'],
        ])('when web_vitals_attribution is %p, should load %s bundle', async (attributionConfig, expectedBundle) => {
            const loadScriptMock = jest.fn().mockImplementation((_ph, _kind, callback) => {
                assignableWindow.__PosthogExtensions__ = {}
                assignableWindow.__PosthogExtensions__.postHogWebVitalsCallbacks = {
                    onLCP: jest.fn(),
                    onCLS: jest.fn(),
                    onFCP: jest.fn(),
                    onINP: jest.fn(),
                }
                callback()
            })

            assignableWindow.__PosthogExtensions__ = {}
            assignableWindow.__PosthogExtensions__.loadExternalDependency = loadScriptMock

            posthog = await createPosthogInstance(uuidv7(), {
                capture_performance: { web_vitals: true, web_vitals_attribution: attributionConfig },
                capture_pageview: false,
            })

            posthog.webVitalsAutocapture!.onRemoteConfig({
                ok: true,
                config: {
                    capturePerformance: { web_vitals: true },
                } as RemoteConfig,
            })

            expect(loadScriptMock).toHaveBeenCalledWith(expect.anything(), expectedBundle, expect.any(Function))
        })
    })

    describe('__preview_web_vitals_soft_navs config', () => {
        it.each([
            [undefined, false],
            [true, true],
            [false, false],
        ])(
            'when __preview_web_vitals_soft_navs is %p, useSoftNavs should be %p',
            async (softNavsConfig, expectedUseSoftNavs) => {
                posthog = await createPosthogInstance(uuidv7(), {
                    capture_performance: { web_vitals: true, __preview_web_vitals_soft_navs: softNavsConfig },
                    capture_pageview: false,
                })

                expect(posthog.webVitalsAutocapture!.useSoftNavs).toBe(expectedUseSoftNavs)
            }
        )

        it.each([
            // [soft_navs, attribution, expected bundle]
            [undefined, undefined, 'web-vitals'],
            [false, false, 'web-vitals'],
            [true, undefined, 'web-vitals-soft-navs'],
            [true, false, 'web-vitals-soft-navs'],
            [true, true, 'web-vitals-with-attribution-soft-navs'],
            [false, true, 'web-vitals-with-attribution'],
        ])(
            'when __preview_web_vitals_soft_navs is %p and web_vitals_attribution is %p, should load %s bundle',
            async (softNavsConfig, attributionConfig, expectedBundle) => {
                const loadScriptMock = jest.fn().mockImplementation((_ph, kind, callback) => {
                    assignableWindow.__PosthogExtensions__ = {
                        postHogWebVitalsCallbacksByFlavor: {
                            [kind]: {
                                onLCP: jest.fn(),
                                onCLS: jest.fn(),
                                onFCP: jest.fn(),
                                onINP: jest.fn(),
                            },
                        },
                    }
                    callback()
                })

                assignableWindow.__PosthogExtensions__ = {}
                assignableWindow.__PosthogExtensions__.loadExternalDependency = loadScriptMock

                posthog = await createPosthogInstance(uuidv7(), {
                    capture_performance: {
                        web_vitals: true,
                        __preview_web_vitals_soft_navs: softNavsConfig,
                        web_vitals_attribution: attributionConfig,
                    },
                    capture_pageview: false,
                })

                posthog.webVitalsAutocapture!.onRemoteConfig({
                    ok: true,
                    config: {
                        capturePerformance: { web_vitals: true },
                    } as RemoteConfig,
                })

                expect(loadScriptMock).toHaveBeenCalledWith(expect.anything(), expectedBundle, expect.any(Function))
            }
        )

        it.each([
            [undefined, false],
            [true, true],
            [false, false],
        ])(
            'when __preview_web_vitals_soft_navs is %p, passes reportSoftNavs=%p to the observers',
            async (softNavsConfig, expectedReportSoftNavs) => {
                const onLCP = jest.fn()
                const onCLS = jest.fn()
                const onFCP = jest.fn()
                const onINP = jest.fn()

                const loadScriptMock = jest.fn().mockImplementation((_ph, kind, callback) => {
                    assignableWindow.__PosthogExtensions__ = {
                        postHogWebVitalsCallbacksByFlavor: {
                            [kind]: { onLCP, onCLS, onFCP, onINP },
                        },
                    }
                    callback()
                })

                assignableWindow.__PosthogExtensions__ = {}
                assignableWindow.__PosthogExtensions__.loadExternalDependency = loadScriptMock

                posthog = await createPosthogInstance(uuidv7(), {
                    capture_performance: { web_vitals: true, __preview_web_vitals_soft_navs: softNavsConfig },
                    capture_pageview: false,
                })

                posthog.webVitalsAutocapture!.onRemoteConfig({
                    ok: true,
                    config: {
                        capturePerformance: { web_vitals: true },
                    } as RemoteConfig,
                })

                for (const observer of [onLCP, onCLS, onFCP, onINP]) {
                    expect(observer).toHaveBeenCalledWith(expect.any(Function), {
                        reportSoftNavs: expectedReportSoftNavs,
                    })
                }
            }
        )

        it('loads soft-nav callbacks when stable callbacks were preloaded by another instance', async () => {
            const stableOnLCP = jest.fn()
            const softOnLCP = jest.fn()
            const softCallbacks = {
                onLCP: softOnLCP,
                onCLS: jest.fn(),
                onFCP: jest.fn(),
                onINP: jest.fn(),
            }
            const stableCallbacks = {
                onLCP: stableOnLCP,
                onCLS: jest.fn(),
                onFCP: jest.fn(),
                onINP: jest.fn(),
            }
            const loadExternalDependency = jest.fn((_ph, kind, callback) => {
                assignableWindow.__PosthogExtensions__!.postHogWebVitalsCallbacksByFlavor![kind] = softCallbacks
                callback()
            })
            assignableWindow.__PosthogExtensions__ = {
                postHogWebVitalsCallbacks: stableCallbacks,
                postHogWebVitalsCallbacksByFlavor: { 'web-vitals': stableCallbacks },
                loadExternalDependency,
            }

            posthog = await createPosthogInstance(uuidv7(), {
                capture_performance: { web_vitals: true, __preview_web_vitals_soft_navs: true },
                capture_pageview: false,
            })

            expect(loadExternalDependency).toHaveBeenCalledWith(
                expect.anything(),
                'web-vitals-soft-navs',
                expect.any(Function)
            )
            expect(softOnLCP).toHaveBeenCalledWith(expect.any(Function), { reportSoftNavs: true })
            expect(stableOnLCP).not.toHaveBeenCalled()
        })

        it('uses the requested preloaded callback flavor without loading another bundle', async () => {
            const stableOnLCP = jest.fn()
            const softOnLCP = jest.fn()
            const loadExternalDependency = jest.fn()
            assignableWindow.__PosthogExtensions__ = {
                postHogWebVitalsCallbacksByFlavor: {
                    'web-vitals': {
                        onLCP: stableOnLCP,
                        onCLS: jest.fn(),
                        onFCP: jest.fn(),
                        onINP: jest.fn(),
                    },
                    'web-vitals-soft-navs': {
                        onLCP: softOnLCP,
                        onCLS: jest.fn(),
                        onFCP: jest.fn(),
                        onINP: jest.fn(),
                    },
                },
                loadExternalDependency,
            }

            posthog = await createPosthogInstance(uuidv7(), {
                capture_performance: { web_vitals: true, __preview_web_vitals_soft_navs: true },
                capture_pageview: false,
            })

            expect(loadExternalDependency).not.toHaveBeenCalled()
            expect(softOnLCP).toHaveBeenCalledWith(expect.any(Function), { reportSoftNavs: true })
            expect(stableOnLCP).not.toHaveBeenCalled()
        })
    })

    describe('onRemoteConfig empty config handling', () => {
        beforeEach(async () => {
            beforeSendMock = jest.fn()
            posthog = await createPosthogInstance(uuidv7(), {
                before_send: beforeSendMock,
            })
        })

        it('does not overwrite persistence when called with empty config', () => {
            // Set up existing persisted values
            posthog.persistence!.register({
                [WEB_VITALS_ENABLED_SERVER_SIDE]: true,
                [WEB_VITALS_ALLOWED_METRICS]: ['LCP', 'FCP'],
            })

            // Call with empty config (server returned no setting for this feature)
            posthog.webVitalsAutocapture!.onRemoteConfig({ ok: true, config: {} as RemoteConfig })

            // Should NOT have overwritten the existing values
            expect(posthog.persistence!.props[WEB_VITALS_ENABLED_SERVER_SIDE]).toBe(true)
            expect(posthog.persistence!.props[WEB_VITALS_ALLOWED_METRICS]).toEqual(['LCP', 'FCP'])
        })

        it('updates persistence when capturePerformance key is present', () => {
            posthog.persistence!.register({
                [WEB_VITALS_ENABLED_SERVER_SIDE]: true,
                [WEB_VITALS_ALLOWED_METRICS]: ['LCP', 'FCP'],
            })

            posthog.webVitalsAutocapture!.onRemoteConfig({
                ok: true,
                config: {
                    capturePerformance: { web_vitals: false, web_vitals_allowed_metrics: ['CLS'] },
                } as RemoteConfig,
            })

            expect(posthog.persistence!.props[WEB_VITALS_ENABLED_SERVER_SIDE]).toBe(false)
            expect(posthog.persistence!.props[WEB_VITALS_ALLOWED_METRICS]).toEqual(['CLS'])
        })
    })

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
                    ok: true,
                    config: {
                        capturePerformance: { web_vitals: serverSideOptIn },
                    } as FlagsResponse,
                })
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
            ok: true,
            config: {
                capturePerformance: {
                    web_vitals: true,
                },
            } as RemoteConfig,
        })

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
            ok: true,
            config: {
                capturePerformance: { web_vitals: true },
            } as RemoteConfig,
        })

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
            ok: true,
            config: {
                capturePerformance: { web_vitals: true },
            } as RemoteConfig,
        })

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
            ok: true,
            config: {
                capturePerformance: { web_vitals: true },
            } as FlagsResponse,
        })

        expect(posthog.webVitalsAutocapture!.isEnabled).toBe(true)
    })

    describe('soft-navigation metric attribution', () => {
        const initializeWebVitals = async () => {
            beforeSendMock = jest.fn().mockImplementation((event) => event)
            assignableWindow.__PosthogExtensions__ = {
                postHogWebVitalsCallbacksByFlavor: {
                    'web-vitals-soft-navs': {
                        onLCP: (callback) => {
                            onLCPCallback = callback
                        },
                        onCLS: (callback) => {
                            onCLSCallback = callback
                        },
                        onFCP: jest.fn(),
                        onINP: jest.fn(),
                    },
                },
            }
            posthog = await createPosthogInstance(uuidv7(), {
                before_send: beforeSendMock,
                capture_performance: {
                    web_vitals: true,
                    web_vitals_allowed_metrics: ['LCP', 'CLS'],
                    __preview_web_vitals_soft_navs: true,
                },
                capture_pageview: false,
                mask_personal_data_properties: true,
            })
        }

        it('attributes a delayed metric to its masked navigation URL after the live URL changes', async () => {
            mockLocation.mockReturnValue({
                protocol: 'http:',
                host: 'localhost',
                pathname: '/new',
                search: '',
                hash: '',
                href: 'http://localhost/new',
            })
            await initializeWebVitals()

            onLCPCallback?.({
                name: 'LCP',
                value: 123.45,
                navigationId: 1,
                navigationURL: 'http://localhost/old?gclid=secret',
            })
            onCLSCallback?.({
                name: 'CLS',
                value: 0.1,
                navigationId: 2,
                navigationURL: 'http://localhost/new?gclid=secret',
            })
            jest.advanceTimersByTime(DEFAULT_FLUSH_TO_CAPTURE_TIMEOUT_MILLISECONDS + 1)

            expect(beforeSendMock).toHaveBeenCalledTimes(2)
            expect(beforeSendMock.mock.calls[0][0]).toMatchObject({
                event: '$web_vitals',
                properties: {
                    $current_url: 'http://localhost/old?gclid=<masked>',
                    $web_vitals_LCP_event: {
                        $current_url: 'http://localhost/old?gclid=<masked>',
                        navigationURL: 'http://localhost/old?gclid=<masked>',
                        navigationId: 1,
                    },
                },
            })
            expect(beforeSendMock.mock.calls[1][0]).toMatchObject({
                event: '$web_vitals',
                properties: {
                    $current_url: 'http://localhost/new?gclid=<masked>',
                    $web_vitals_CLS_event: {
                        $current_url: 'http://localhost/new?gclid=<masked>',
                        navigationURL: 'http://localhost/new?gclid=<masked>',
                        navigationId: 2,
                    },
                },
            })
        })

        it('separates buffers by navigation identity even when the navigation URL is unchanged', async () => {
            await initializeWebVitals()

            onLCPCallback?.({
                name: 'LCP',
                value: 100,
                navigationId: 'soft-navigation-10',
                navigationURL: 'http://localhost/route',
            })
            onCLSCallback?.({
                name: 'CLS',
                value: 0.1,
                navigationId: 'soft-navigation-11',
                navigationURL: 'http://localhost/route',
            })
            jest.advanceTimersByTime(DEFAULT_FLUSH_TO_CAPTURE_TIMEOUT_MILLISECONDS + 1)

            expect(beforeSendMock).toHaveBeenCalledTimes(2)
            expect(beforeSendMock.mock.calls[0][0].properties.$web_vitals_LCP_event.navigationId).toBe(
                'soft-navigation-10'
            )
            expect(beforeSendMock.mock.calls[1][0].properties.$web_vitals_CLS_event.navigationId).toBe(
                'soft-navigation-11'
            )
        })
    })

    describe.each([
        [false, undefined, 'http://localhost/?gclid=12345&other=true'],
        [true, undefined, 'http://localhost/?gclid=<masked>&other=true'],
        [true, ['other'], 'http://localhost/?gclid=<masked>&other=<masked>'],
    ])(
        'the behaviour when mask_personal_data_properties is %s and custom_personal_data_properties is %s',
        (
            maskPersonalDataProperties: boolean,
            customPersonalDataProperties: undefined | string[],
            maskedUrl: string
        ) => {
            beforeEach(async () => {
                mockLocation.mockReturnValue({
                    protocol: 'http:',
                    host: 'localhost',
                    pathname: '/',
                    search: '?gclid=12345&other=true',
                    hash: '',
                    href: `http://localhost/?gclid=12345&other=true`,
                })

                beforeSendMock.mockClear()
                posthog = await createPosthogInstance(uuidv7(), {
                    before_send: beforeSendMock,
                    capture_performance: { web_vitals: true },
                    // sometimes pageviews sneak in and make asserting on mock capture tricky
                    capture_pageview: false,
                    mask_personal_data_properties: maskPersonalDataProperties,
                    custom_personal_data_properties: customPersonalDataProperties,
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
                    ok: true,
                    config: {
                        capturePerformance: { web_vitals: true },
                    } as unknown as FlagsResponse,
                })
            })

            it('masks properties accordingly', async () => {
                emitAllMetrics()

                expect(beforeSendMock).toBeCalledTimes(1)

                expect(beforeSendMock.mock.lastCall).toMatchObject([
                    {
                        event: '$web_vitals',
                        properties: {
                            $current_url: maskedUrl,
                            $session_entry_url: maskedUrl,
                            $web_vitals_LCP_event: { $current_url: maskedUrl },
                            $web_vitals_CLS_event: { $current_url: maskedUrl },
                            $web_vitals_FCP_event: { $current_url: maskedUrl },
                            $web_vitals_INP_event: { $current_url: maskedUrl },
                        },
                    },
                ])
            })
        }
    )
})
