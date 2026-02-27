import { PostHog } from '../posthog-core'
import { PostHogConfig, RemoteConfig } from '../types'
import { AllExtensions } from '../extensions/extension-bundles'
import { Autocapture } from '../autocapture'
import { SessionRecording } from '../extensions/replay/session-recording'
import { createPosthogInstance } from './helpers/posthog-instance'

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

    it('eagerly constructs extensions from defaults before init()', () => {
        PostHog.__defaultExtensionClasses = AllExtensions

        const posthog = new PostHog()

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

        expect(posthog.toolbar).toBeUndefined()
        expect(posthog.surveys).toBeUndefined()
        expect(posthog.conversations).toBeUndefined()
        expect(posthog.logs).toBeUndefined()
        expect(posthog.experiments).toBeUndefined()
        expect(posthog.exceptions).toBeUndefined()
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
                'heatmaps',
                'historyAutocapture',
                'logs',
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
                onRemoteConfig(config: RemoteConfig) {
                    onRemoteConfigSpy(config)
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
            posthog._onRemoteConfig(remoteConfig)

            // Two extensions, each should get onRemoteConfig called once
            expect(onRemoteConfigSpy).toHaveBeenCalledTimes(2)
            expect(onRemoteConfigSpy).toHaveBeenCalledWith(remoteConfig)
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
    })
})
