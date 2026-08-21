import { PostHog } from '../posthog-core'
import { PostHogConfig, RemoteConfig, RemoteConfigResult } from '../types'
import { AllExtensions, FeatureFlagsExtensions } from '../extensions/extension-bundles'
import { Autocapture } from '../autocapture'
import { PostHogFeatureFlags } from '../posthog-featureflags'
import { SessionRecording } from '../extensions/replay/session-recording'
import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'
import { assignableWindow } from '../utils/globals'

describe('__extensionClasses enrollment', () => {
    let savedDefaults: PostHogConfig['__extensionClasses']

    beforeEach(() => {
        savedDefaults = PostHog.__defaultExtensionClasses
        console.error = jest.fn()
    })

    afterEach(() => {
        PostHog.__defaultExtensionClasses = savedDefaults
    })

    it('initializes only extensions provided via __extensionClasses', async () => {
        PostHog.__defaultExtensionClasses = {}

        const posthog = await createPosthogInstance(undefined, {
            __preview_deferred_init_extensions: false,
            __extensionClasses: { autocapture: Autocapture, sessionRecording: SessionRecording },
            capture_pageview: false,
        })

        expect(posthog.autocapture).toBeDefined()
        expect(posthog.sessionRecording).toBeDefined()

        expect(posthog.heatmaps).toBeUndefined()
        expect(posthog.exceptionObserver).toBeUndefined()
        expect(posthog.deadClicksAutocapture).toBeUndefined()
        expect(posthog.webVitalsAutocapture).toBeUndefined()
        expect(posthog.productTours).toBeUndefined()
        expect(posthog.siteApps).toBeUndefined()
        expect(posthog.surveys).toBeUndefined()
        expect(posthog.toolbar).toBeUndefined()
        expect(posthog.exceptions).toBeUndefined()
        expect(posthog.conversations).toBeUndefined()
        expect(posthog.logs).toBeUndefined()
        expect(posthog.experiments).toBeUndefined()
    })

    it('initializes no extensions when none are provided and no defaults exist', async () => {
        PostHog.__defaultExtensionClasses = {}

        const posthog = await createPosthogInstance(undefined, {
            __preview_deferred_init_extensions: false,
            capture_pageview: false,
        })

        expect(posthog.autocapture).toBeUndefined()
        expect(posthog.sessionRecording).toBeUndefined()
        expect(posthog.heatmaps).toBeUndefined()
        expect(posthog.exceptionObserver).toBeUndefined()
        expect(posthog.deadClicksAutocapture).toBeUndefined()
        expect(posthog.webVitalsAutocapture).toBeUndefined()
        expect(posthog.productTours).toBeUndefined()
        expect(posthog.siteApps).toBeUndefined()
        expect(posthog.surveys).toBeUndefined()
        expect(posthog.toolbar).toBeUndefined()
        expect(posthog.exceptions).toBeUndefined()
        expect(posthog.conversations).toBeUndefined()
        expect(posthog.logs).toBeUndefined()
        expect(posthog.experiments).toBeUndefined()
    })

    it('__extensionClasses overrides __defaultExtensionClasses', async () => {
        PostHog.__defaultExtensionClasses = AllExtensions

        class MockAutocapture extends Autocapture {}

        const posthog = await createPosthogInstance(undefined, {
            __preview_deferred_init_extensions: false,
            __extensionClasses: { autocapture: MockAutocapture },
            capture_pageview: false,
        })

        expect(posthog.autocapture).toBeInstanceOf(MockAutocapture)
    })

    it('preserves the PostHog lifecycle contract for custom feature flags classes', async () => {
        PostHog.__defaultExtensionClasses = {}
        const posthog = new PostHog()
        const initialize = jest.fn()
        const destroy = jest.fn()
        let constructorArgument: PostHog | undefined

        class LegacyFeatureFlags {
            constructor(instance: PostHog) {
                constructorArgument = instance
            }

            initialize(): void {
                initialize()
            }

            destroy(): void {
                destroy()
            }
        }

        posthog.config.__extensionClasses = { featureFlags: LegacyFeatureFlags as any }
        posthog['_enrollFeatureFlags']()
        posthog.__loaded = true
        await posthog.shutdown()

        expect(constructorArgument).toBe(posthog)
        expect(initialize).toHaveBeenCalledTimes(1)
        expect(destroy).toHaveBeenCalledTimes(1)
    })

    it('eagerly constructs extensions from defaults before init()', () => {
        PostHog.__defaultExtensionClasses = AllExtensions

        const posthog = new PostHog()

        expect(posthog.featureFlags).toBeDefined()
        expect(posthog.toolbar).toBeDefined()
        expect(posthog.surveys).toBeDefined()
        expect(posthog.conversations).toBeDefined()
        expect(posthog.logs).toBeDefined()
        expect(posthog.experiments).toBeDefined()
        expect(posthog.exceptions).toBeDefined()
    })

    it('does not eagerly construct extensions when no defaults exist', () => {
        PostHog.__defaultExtensionClasses = {}

        const posthog = new PostHog()

        expect(posthog.featureFlags).toBeUndefined()
        expect(posthog.toolbar).toBeUndefined()
        expect(posthog.surveys).toBeUndefined()
        expect(posthog.conversations).toBeUndefined()
        expect(posthog.logs).toBeUndefined()
        expect(posthog.experiments).toBeUndefined()
        expect(posthog.exceptions).toBeUndefined()
    })

    it('preserves feature flag reloading subscriptions across slim initialization', async () => {
        jest.useFakeTimers()
        try {
            PostHog.__defaultExtensionClasses = {}
            const token = uuidv7()
            assignableWindow._POSTHOG_REMOTE_CONFIG = {
                [token]: { config: { hasFeatureFlags: true }, siteApps: [] },
            } as any

            const posthog = new PostHog()
            const beforeInitCallback = jest.fn()
            const unsubscribeBeforeInit = posthog.on('featureFlagsReloading', beforeInitCallback)

            expect(posthog.featureFlags).toBeUndefined()

            posthog.init(token, {
                __extensionClasses: FeatureFlagsExtensions,
                capture_pageview: false,
                remote_config_refresh_interval_ms: 0,
                loaded: (instance) => {
                    instance._send_request = jest.fn(({ callback }) =>
                        callback?.({ statusCode: 200, json: { flags: [] } })
                    )
                },
            })

            expect(posthog.featureFlags).toBeInstanceOf(PostHogFeatureFlags)
            expect(beforeInitCallback).toHaveBeenCalledTimes(1)
            expect(beforeInitCallback).toHaveBeenLastCalledWith(true)

            const afterInitCallback = jest.fn()
            const unsubscribeAfterInit = posthog.on('featureFlagsReloading', afterInitCallback)

            await jest.advanceTimersByTimeAsync(10)
            posthog.reloadFeatureFlags()

            expect(beforeInitCallback).toHaveBeenCalledTimes(2)
            expect(beforeInitCallback).toHaveBeenLastCalledWith(true)
            expect(afterInitCallback).toHaveBeenCalledTimes(1)
            expect(afterInitCallback).toHaveBeenLastCalledWith(true)

            await jest.advanceTimersByTimeAsync(10)
            unsubscribeBeforeInit()
            posthog.reloadFeatureFlags()

            expect(beforeInitCallback).toHaveBeenCalledTimes(2)
            expect(afterInitCallback).toHaveBeenCalledTimes(2)
            expect(afterInitCallback).toHaveBeenLastCalledWith(true)

            await jest.advanceTimersByTimeAsync(10)
            unsubscribeAfterInit()
            posthog.reloadFeatureFlags()

            expect(beforeInitCallback).toHaveBeenCalledTimes(2)
            expect(afterInitCallback).toHaveBeenCalledTimes(2)
            posthog.featureFlags.reset()
        } finally {
            jest.clearAllTimers()
            jest.useRealTimers()
        }
    })

    it('emits feature flag reloading once for default extensions after init', async () => {
        jest.useFakeTimers()
        try {
            PostHog.__defaultExtensionClasses = AllExtensions
            const token = uuidv7()
            assignableWindow._POSTHOG_REMOTE_CONFIG = {
                [token]: { config: { hasFeatureFlags: true }, siteApps: [] },
            } as any

            const posthog = new PostHog()
            posthog.init(token, {
                capture_pageview: false,
                remote_config_refresh_interval_ms: 0,
                loaded: (instance) => {
                    instance._send_request = jest.fn(({ callback }) =>
                        callback?.({ statusCode: 200, json: { flags: [] } })
                    )
                },
            })
            await jest.advanceTimersByTimeAsync(10)

            const callback = jest.fn()
            posthog.on('featureFlagsReloading', callback)
            posthog.reloadFeatureFlags()

            expect(callback).toHaveBeenCalledTimes(1)
            expect(callback).toHaveBeenCalledWith(true)
            posthog.featureFlags.reset()
        } finally {
            jest.clearAllTimers()
            jest.useRealTimers()
        }
    })

    it('keeps one reloading bridge when feature flags are enrolled repeatedly', () => {
        PostHog.__defaultExtensionClasses = FeatureFlagsExtensions
        const posthog = new PostHog()
        const add = jest.fn().mockResolvedValue(undefined)
        posthog._getBrowserClientAdapter = jest.fn().mockReturnValue({ add }) as any

        const enrollFeatureFlags = () => (posthog as any)._enrollFeatureFlags()
        enrollFeatureFlags()
        enrollFeatureFlags()

        const callback = jest.fn()
        posthog.on('featureFlagsReloading', callback)
        posthog.featureFlags.reloadFeatureFlags()

        expect(callback).toHaveBeenCalledTimes(1)
        expect(callback).toHaveBeenCalledWith(true)
        expect(add).toHaveBeenCalledTimes(1)
        posthog.featureFlags.reset()
    })

    it('default extensions are used when __extensionClasses is not provided', async () => {
        PostHog.__defaultExtensionClasses = AllExtensions

        const posthog = await createPosthogInstance(undefined, {
            __preview_deferred_init_extensions: false,
            capture_pageview: false,
        })

        expect(posthog.autocapture).toBeDefined()
        expect(posthog.sessionRecording).toBeDefined()
        expect(posthog.heatmaps).toBeDefined()
        expect(posthog.exceptionObserver).toBeDefined()
        expect(posthog.deadClicksAutocapture).toBeDefined()
        expect(posthog.webVitalsAutocapture).toBeDefined()
        expect(posthog.productTours).toBeDefined()
        expect(posthog.siteApps).toBeDefined()
        expect(posthog.surveys).toBeDefined()
        expect(posthog.toolbar).toBeDefined()
        expect(posthog.exceptions).toBeDefined()
        expect(posthog.conversations).toBeDefined()
        expect(posthog.logs).toBeDefined()
        expect(posthog.experiments).toBeDefined()
    })
})

describe('extension lifecycle', () => {
    let savedDefaults: PostHogConfig['__extensionClasses']

    beforeEach(() => {
        savedDefaults = PostHog.__defaultExtensionClasses
        console.error = jest.fn()
    })

    afterEach(() => {
        PostHog.__defaultExtensionClasses = savedDefaults
    })

    describe('AllExtensions covers every __extensionClasses key', () => {
        it('has an entry for every key in the __extensionClasses type', () => {
            // If a new key is added to __extensionClasses but not to AllExtensions,
            // this test will fail because the full bundle would silently omit it.
            const allKeys = Object.keys(AllExtensions).sort()
            expect(allKeys).toEqual([
                'autocapture',
                'conversations',
                'deadClicksAutocapture',
                'exceptionObserver',
                'exceptions',
                'experiments',
                'featureFlags',
                'heatmaps',
                'historyAutocapture',
                'logs',
                'metrics',
                'productTours',
                'sessionRecording',
                'siteApps',
                'surveys',
                'toolbar',
                'tracingHeaders',
                'webVitalsAutocapture',
            ])
        })
    })

    describe('initialize() is called on extensions', () => {
        it('calls initialize() on extensions that define it', async () => {
            PostHog.__defaultExtensionClasses = {}

            const initializeSpy = jest.fn()

            class SpyExtension {
                constructor() {}
                initialize() {
                    initializeSpy()
                }
            }

            const posthog = await createPosthogInstance(undefined, {
                __preview_deferred_init_extensions: false,
                __extensionClasses: { autocapture: SpyExtension as any },
                capture_pageview: false,
            })

            expect(posthog.autocapture).toBeInstanceOf(SpyExtension)
            expect(initializeSpy).toHaveBeenCalledTimes(1)
        })

        it('does not throw if an extension has no initialize()', async () => {
            PostHog.__defaultExtensionClasses = {}

            class MinimalExtension {
                constructor() {}
            }

            const posthog = await createPosthogInstance(undefined, {
                __preview_deferred_init_extensions: false,
                __extensionClasses: { autocapture: MinimalExtension as any },
                capture_pageview: false,
            })

            expect(posthog.autocapture).toBeInstanceOf(MinimalExtension)
        })
    })

    describe('onRemoteConfig dispatching', () => {
        it('calls onRemoteConfig on all extensions that define it', async () => {
            PostHog.__defaultExtensionClasses = {}

            const onRemoteConfigSpy = jest.fn()

            class SpyExtension {
                constructor() {}
                onRemoteConfig(result: RemoteConfigResult) {
                    onRemoteConfigSpy(result)
                }
            }

            const posthog = await createPosthogInstance(undefined, {
                __preview_deferred_init_extensions: false,
                __extensionClasses: {
                    toolbar: SpyExtension as any,
                    conversations: SpyExtension as any,
                },
                capture_pageview: false,
            })

            // Clear any calls from the init/loaded flow
            onRemoteConfigSpy.mockClear()

            const remoteConfig = { supportedCompression: [] } as unknown as RemoteConfig
            posthog._onRemoteConfig({ ok: true, config: remoteConfig })

            // Two extensions, each should get onRemoteConfig called once
            expect(onRemoteConfigSpy).toHaveBeenCalledTimes(2)
            expect(onRemoteConfigSpy).toHaveBeenCalledWith({ ok: true, config: remoteConfig })
        })
    })

    describe('graceful degradation without extensions (slim bundle)', () => {
        it('onSurveysLoaded calls back with error when extension is not loaded', async () => {
            PostHog.__defaultExtensionClasses = {}

            const posthog = await createPosthogInstance(undefined, {
                __preview_deferred_init_extensions: false,
                capture_pageview: false,
            })

            const callback = jest.fn()
            posthog.onSurveysLoaded(callback)

            expect(callback).toHaveBeenCalledWith([], { isLoaded: false, error: 'Surveys module not available' })
        })

        it('getSurveys calls back with error when extension is not loaded', async () => {
            PostHog.__defaultExtensionClasses = {}

            const posthog = await createPosthogInstance(undefined, {
                __preview_deferred_init_extensions: false,
                capture_pageview: false,
            })

            const callback = jest.fn()
            posthog.getSurveys(callback)

            expect(callback).toHaveBeenCalledWith([], { isLoaded: false, error: 'Surveys module not available' })
        })

        it('getActiveMatchingSurveys calls back with error when extension is not loaded', async () => {
            PostHog.__defaultExtensionClasses = {}

            const posthog = await createPosthogInstance(undefined, {
                __preview_deferred_init_extensions: false,
                capture_pageview: false,
            })

            const callback = jest.fn()
            posthog.getActiveMatchingSurveys(callback)

            expect(callback).toHaveBeenCalledWith([], { isLoaded: false, error: 'Surveys module not available' })
        })

        it('featureFlags is undefined when extension is not loaded', async () => {
            PostHog.__defaultExtensionClasses = {}

            const posthog = await createPosthogInstance(undefined, {
                __preview_deferred_init_extensions: false,
                capture_pageview: false,
            })

            expect(posthog.featureFlags).toBeUndefined()
        })

        it('onFeatureFlags calls back with error when extension is not loaded', async () => {
            PostHog.__defaultExtensionClasses = {}

            const posthog = await createPosthogInstance(undefined, {
                __preview_deferred_init_extensions: false,
                capture_pageview: false,
            })

            const callback = jest.fn()
            const unsubscribe = posthog.onFeatureFlags(callback)

            expect(callback).toHaveBeenCalledWith([], {}, { errorsLoading: true })
            expect(unsubscribe).toEqual(expect.any(Function))
        })

        it('getFeatureFlag returns undefined when extension is not loaded', async () => {
            PostHog.__defaultExtensionClasses = {}

            const posthog = await createPosthogInstance(undefined, {
                __preview_deferred_init_extensions: false,
                capture_pageview: false,
            })

            expect(posthog.getFeatureFlag('test-flag')).toBeUndefined()
        })

        it('reloadFeatureFlags is a no-op when extension is not loaded', async () => {
            PostHog.__defaultExtensionClasses = {}

            const posthog = await createPosthogInstance(undefined, {
                __preview_deferred_init_extensions: false,
                capture_pageview: false,
            })

            expect(() => posthog.reloadFeatureFlags()).not.toThrow()
        })
    })

    describe('with AllExtensions loaded', () => {
        it('featureFlags getter returns the real instance', async () => {
            PostHog.__defaultExtensionClasses = AllExtensions

            const posthog = await createPosthogInstance(undefined, {
                __preview_deferred_init_extensions: false,
                capture_pageview: false,
            })

            expect(posthog.featureFlags).toBeDefined()
            expect(posthog.featureFlags).toBeInstanceOf(PostHogFeatureFlags)
        })

        it('bootstrap feature flags work through extension initialize()', async () => {
            PostHog.__defaultExtensionClasses = AllExtensions
            const token = uuidv7()

            assignableWindow._POSTHOG_REMOTE_CONFIG = {
                [token]: { config: {}, siteApps: [] },
            } as any

            const posthog = await createPosthogInstance(token, {
                __preview_deferred_init_extensions: false,
                capture_pageview: false,
                bootstrap: {
                    featureFlags: {
                        'test-flag': true,
                        'variant-flag': 'control',
                        'disabled-flag': false,
                    },
                },
            })

            expect(posthog.getFeatureFlag('test-flag')).toBe(true)
            expect(posthog.getFeatureFlag('variant-flag')).toBe('control')
            // Disabled flags should not be returned
            expect(posthog.getFeatureFlag('disabled-flag')).toBeUndefined()
            expect(posthog.flagsEndpointWasHit).toBe(true)
        })
    })
})
