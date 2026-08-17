import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'
import { RemoteConfig, RemoteConfigResult } from '../types'

jest.mock('@posthog/browser-common/utils/globals', () => {
    const orig = jest.requireActual('@posthog/browser-common/utils/globals')
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
const { mockURLGetter, mockReferrerGetter } = require('@posthog/browser-common/utils/globals')

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
            posthog._onRemoteConfig({ ok: true, config: remoteConfig })

            // The config should be stored in _pendingRemoteConfig
            expect((posthog as any)._pendingRemoteConfig).toEqual({ ok: true, config: remoteConfig })

            // Wait for extensions to initialize (time-sliced, may take multiple ticks)
            await new Promise((resolve) => setTimeout(resolve, 200))

            // After extensions initialize and replay, the functionality has worked correctly
            // (Don't test implementation details about whether the variable is cleared)
            expect(posthog.sessionRecording).toBeDefined()
            expect(posthog.autocapture).toBeDefined()
        })

        it('does not start autocapture before setup when set_config runs between deferred tasks', async () => {
            const posthog = await createPosthogInstance(uuidv7(), {
                __preview_deferred_init_extensions: true,
                advanced_disable_flags: true,
                autocapture: true,
                capture_pageview: false,
                disable_session_recording: true,
            })
            const initTasks: Array<() => void> = []
            const processInitTaskQueue = jest
                .spyOn(posthog as any, '_processInitTaskQueue')
                .mockImplementation((queue: Array<() => void>) => initTasks.push(...queue))

            await new Promise((resolve) => setTimeout(resolve, 20))

            const autocapture = posthog.autocapture!
            expect(autocapture['_client']).toBeUndefined()

            posthog.set_config({ autocapture: true })

            expect(autocapture['_initialized']).toBe(false)

            initTasks.forEach((task) => task())

            expect(autocapture['_client']).toBe(posthog._getBrowserClientAdapter())
            expect(autocapture['_initialized']).toBe(true)

            processInitTaskQueue.mockRestore()
            await posthog.shutdown()
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
            posthog._onRemoteConfig({ ok: true, config: remoteConfig })

            // Config should be stored
            expect((posthog as any)._pendingRemoteConfig).toEqual({ ok: true, config: remoteConfig })
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

            // With sync init, extensions are already ready, no need to store config
            posthog._onRemoteConfig({ ok: true, config: remoteConfig })

            // Config should NOT be stored when deferred init is disabled
            expect((posthog as any)._pendingRemoteConfig).toBeUndefined()
        })

        it('should replay pending remote config to extensions when they initialize', async () => {
            const token = uuidv7()
            const remoteConfig: RemoteConfig = {
                supportedCompression: ['gzip'],
            } as RemoteConfig
            const legacyRemoteConfigs: RemoteConfigResult[] = []
            class TestAutocapture {
                initialize(): void {}

                onRemoteConfig(result: RemoteConfigResult): void {
                    legacyRemoteConfigs.push(result)
                }
            }

            const posthog = await createPosthogInstance(token, {
                __preview_deferred_init_extensions: true,
                __extensionClasses: { autocapture: TestAutocapture as any },
                advanced_disable_decide: false,
                capture_pageview: false,
                disable_session_recording: true,
            })

            const sharedRemoteConfigs: RemoteConfigResult[] = []
            posthog
                ._getBrowserClientAdapter()
                .onRemoteConfig((result) => sharedRemoteConfigs.push(result as RemoteConfigResult))
            const initialSharedRemoteConfigCount = sharedRemoteConfigs.length

            // Call _onRemoteConfig before extensions are ready
            posthog._onRemoteConfig({ ok: true, config: remoteConfig })
            expect((posthog as any)._pendingRemoteConfig).toEqual({ ok: true, config: remoteConfig })
            expect(legacyRemoteConfigs).toEqual([])

            // Wait for extensions to initialize
            await new Promise((resolve) => setTimeout(resolve, 200))

            // Legacy extensions receive the post-initialization replay, while shared listeners
            // receive each remote config outcome only once.
            expect(legacyRemoteConfigs).toEqual([{ ok: true, config: remoteConfig }])
            expect(sharedRemoteConfigs).toHaveLength(initialSharedRemoteConfigCount + 1)
            expect(sharedRemoteConfigs.at(-1)).toEqual({ ok: true, config: remoteConfig })
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

        it('does not set up autocapture after shutdown', async () => {
            const setup = jest.fn()
            class TestAutocapture {
                readonly name = 'autocapture'
                setup = setup
            }

            const posthog = await createPosthogInstance(uuidv7(), {
                __preview_deferred_init_extensions: true,
                __extensionClasses: { autocapture: TestAutocapture as any },
                capture_pageview: false,
            })
            await posthog.shutdown()
            await new Promise((resolve) => setTimeout(resolve, 20))

            expect(setup).not.toHaveBeenCalled()
        })
    })
})
