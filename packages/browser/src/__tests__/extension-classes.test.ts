import { PostHog } from '../posthog-core'
import { PostHogConfig } from '../types'
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
    })
})
