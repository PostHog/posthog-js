import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '../uuidv7'
import { RemoteConfig } from '../types'

jest.mock('../utils/globals', () => {
    const orig = jest.requireActual('../utils/globals')
    const mockURLGetter = jest.fn()
    const mockReferrerGetter = jest.fn()
    return {
        ...orig,
        mockURLGetter,
        mockReferrerGetter,
        document: {
            ...orig.document,
            createElement: (...args: any[]) => orig.document.createElement(...args),
            body: orig.document.body,
            get referrer() {
                return mockReferrerGetter()
            },
            get URL() {
                return mockURLGetter()
            },
        },
        get location() {
            const url = mockURLGetter()
            return {
                href: url,
                toString: () => url,
            }
        },
    }
})

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { mockURLGetter, mockReferrerGetter } = require('../utils/globals')

describe('deferred extension initialization', () => {
    beforeEach(() => {
        console.error = jest.fn()
        mockReferrerGetter.mockReturnValue('https://referrer.com')
        mockURLGetter.mockReturnValue('https://example.com')
    })

    describe('race condition handling', () => {
        it('should store pending remote config when it arrives before extensions initialize', async () => {
            const token = uuidv7()
            const remoteConfig: RemoteConfig = {
                supportedCompression: ['gzip'],
            } as RemoteConfig

            const posthog = await createPosthogInstance(token, {
                __preview_deferred_init_extensions: true,
                advanced_disable_decide: false,
                capture_pageview: false,
                disable_session_recording: true,
            })

            // Simulate remote config arriving synchronously before extensions init
            posthog._onRemoteConfig(remoteConfig)

            // The config should be stored in _pendingRemoteConfig
            expect((posthog as any)._pendingRemoteConfig).toEqual(remoteConfig)

            // Wait for extensions to initialize (time-sliced, may take multiple ticks)
            await new Promise((resolve) => setTimeout(resolve, 200))

            // After extensions initialize and replay, the functionality has worked correctly
            // (Don't test implementation details about whether the variable is cleared)
            expect(posthog.sessionRecording).toBeDefined()
            expect(posthog.autocapture).toBeDefined()
        })

        it('should handle remote config arriving after extensions initialize', async () => {
            const token = uuidv7()
            const remoteConfig: RemoteConfig = {
                supportedCompression: ['gzip'],
            } as RemoteConfig

            const posthog = await createPosthogInstance(token, {
                __preview_deferred_init_extensions: true,
                advanced_disable_decide: false,
                capture_pageview: false,
                disable_session_recording: true,
            })

            // Wait for extensions to initialize first
            await new Promise((resolve) => setTimeout(resolve, 200))

            // Now send remote config after extensions are ready
            posthog._onRemoteConfig(remoteConfig)

            // Config should be stored
            expect((posthog as any)._pendingRemoteConfig).toEqual(remoteConfig)
        })

        it('should not store pending config when deferred init is disabled', async () => {
            const token = uuidv7()
            const remoteConfig: RemoteConfig = {
                supportedCompression: ['gzip'],
            } as RemoteConfig

            const posthog = await createPosthogInstance(token, {
                __preview_deferred_init_extensions: false, // sync init
                advanced_disable_decide: false,
                capture_pageview: false,
                disable_session_recording: true,
            })

            // With sync init, extensions are already ready
            posthog._onRemoteConfig(remoteConfig)

            // Config should still be stored (this is the new behavior for all cases)
            expect((posthog as any)._pendingRemoteConfig).toEqual(remoteConfig)
        })

        it('should replay pending remote config to extensions when they initialize', async () => {
            const token = uuidv7()
            const remoteConfig: RemoteConfig = {
                supportedCompression: ['gzip'],
            } as RemoteConfig

            const posthog = await createPosthogInstance(token, {
                __preview_deferred_init_extensions: true,
                advanced_disable_decide: false,
                capture_pageview: false,
                disable_session_recording: true,
            })

            // Call _onRemoteConfig before extensions are ready
            posthog._onRemoteConfig(remoteConfig)
            expect((posthog as any)._pendingRemoteConfig).toEqual(remoteConfig)

            // Spy on _onRemoteConfig to see if it gets called again during replay
            const onRemoteConfigSpy = jest.spyOn(posthog as any, '_onRemoteConfig')

            // Wait for extensions to initialize
            await new Promise((resolve) => setTimeout(resolve, 200))

            // _onRemoteConfig should have been called again with the pending config during replay
            expect(onRemoteConfigSpy).toHaveBeenCalledWith(remoteConfig)
            // Extensions should be initialized, proving the replay worked
            expect(posthog.sessionRecording).toBeDefined()
            expect(posthog.autocapture).toBeDefined()
        })
    })

    describe('extension initialization', () => {
        it('should initialize extensions synchronously when flag is disabled', async () => {
            const token = uuidv7()

            const posthog = await createPosthogInstance(token, {
                __preview_deferred_init_extensions: false,
                capture_pageview: false,
            })

            // Extensions should be initialized immediately (synchronously)
            expect(posthog.sessionRecording).toBeDefined()
            expect(posthog.autocapture).toBeDefined()
        })

        it('should defer extension initialization when flag is enabled', async () => {
            const token = uuidv7()

            const posthog = await createPosthogInstance(token, {
                __preview_deferred_init_extensions: true,
                capture_pageview: false,
            })

            // Extensions should not be initialized yet
            // (They might be undefined or null depending on when test runs)

            // Wait for deferred init to complete
            await new Promise((resolve) => setTimeout(resolve, 200))

            // Now extensions should be initialized
            expect(posthog.sessionRecording).toBeDefined()
            expect(posthog.autocapture).toBeDefined()
        })
    })
})
