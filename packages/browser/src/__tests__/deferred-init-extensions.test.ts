import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'
import { RemoteConfig, RemoteConfigResult } from '../types'
import type { Client } from '@posthog/browser-common'
import { PostHog } from '../posthog-core'
import { SURVEYS, SURVEYS_LOADED_AT } from '../constants'
import { SurveyType } from '../posthog-surveys-types'
import { assignableWindow } from '../utils/globals'
import { PostHogLogs } from '../posthog-logs'
import * as mockedGlobals from '@posthog/browser-common/utils/globals'

vi.mock('@posthog/browser-common/utils/globals', async (importOriginal) => {
    const orig = await importOriginal<typeof import('@posthog/browser-common/utils/globals')>()
    const mockURLGetter = vi.fn()
    const mockReferrerGetter = vi.fn()
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

const { mockURLGetter, mockReferrerGetter } = mockedGlobals as any

describe('deferred extension initialization', () => {
    beforeEach(() => {
        console.error = vi.fn()
        mockReferrerGetter.mockReturnValue('https://referrer.com')
        mockURLGetter.mockReturnValue('https://example.com')
    })

    it('does not create an extension client when only obtaining a logger', () => {
        const instance = new PostHog()
        expect((instance as any)._browserClientAdapter).toBeUndefined()
        void instance.logger
        expect((instance as any)._browserClientAdapter).toBeUndefined()
        instance.logs?.dispose()
    })

    describe('race condition handling', () => {
        it('recovers early programmatic logs on reconnect before deferred setup', async () => {
            vi.useFakeTimers()
            const setup = vi.spyOn(PostHogLogs.prototype, 'setup')
            try {
                const posthog = await createPosthogInstance(uuidv7(), {
                    __preview_deferred_init_extensions: true,
                    advanced_disable_flags: true,
                    capture_pageview: false,
                    disable_session_recording: true,
                    logs: { flushIntervalMs: 0 },
                })
                const send = vi.spyOn(posthog, '_send_request').mockImplementation((options) => {
                    options.callback?.({ statusCode: 0, error: new Error('blocked') })
                })
                posthog.captureLog({ body: 'early' })
                const core = (posthog.logs as any)._core
                for (let i = 0; i < 3; i++) await core.flush().catch(() => {})
                expect(send).toHaveBeenCalledTimes(3)
                expect((posthog.logs as any)._consecutiveStatusZeroFailures).toBe(3)
                expect(setup).not.toHaveBeenCalled()
                send.mockImplementation((options) => options.callback?.({ statusCode: 200 }))
                window.dispatchEvent(new Event('online'))
                await core.flush()
                expect(send).toHaveBeenCalledTimes(4)
                expect((posthog.logs as any)._queue).toHaveLength(0)
                expect(setup).not.toHaveBeenCalled()
                posthog.logs!.dispose()
                await posthog.shutdown()
            } finally {
                setup.mockRestore()
                vi.clearAllTimers()
                vi.useRealTimers()
            }
        })

        it('captures programmatic logs from loaded without activating deferred console setup', async () => {
            let captured = 0
            let loadedError: unknown
            const setup = vi.spyOn(PostHogLogs.prototype, 'setup')
            const loader = vi.spyOn(PostHogLogs.prototype as any, '_getConsoleLoader').mockReturnValue(() => {})
            const originalLog = console.log
            const posthog = await createPosthogInstance(uuidv7(), {
                __preview_deferred_init_extensions: true,
                advanced_disable_flags: true,
                capture_pageview: false,
                disable_session_recording: true,
                logs: { captureConsoleLogs: true },
                loaded: (instance) => {
                    try {
                        const logger = instance.logger
                        expect(setup).not.toHaveBeenCalled()
                        expect(loader).not.toHaveBeenCalled()
                        instance.identify('early-logs-user')
                        instance.captureLog({ body: 'loaded callback' })
                        logger.info('logger callback')
                        captured = (instance.logs as any)._queue.length
                        expect((instance.logs as any)._queue[0].record.attributes).toContainEqual({
                            key: 'posthogDistinctId',
                            value: { stringValue: 'early-logs-user' },
                        })
                        instance.opt_out_capturing()
                        instance.captureLog({ body: 'denied' })
                        logger.info('also denied')
                        expect((instance.logs as any)._queue).toHaveLength(2)
                        instance.opt_in_capturing()
                        expect(setup).not.toHaveBeenCalled()
                        expect(loader).not.toHaveBeenCalled()
                        expect(console.log).toBe(originalLog)
                    } catch (error) {
                        loadedError = error
                    }
                },
            })
            expect(loadedError).toBeUndefined()
            expect(captured).toBe(2)
            await new Promise((resolve) => setTimeout(resolve, 100))
            expect(setup).toHaveBeenCalledTimes(1)
            expect(loader).toHaveBeenCalledTimes(1)
            await posthog.shutdown()
            setup.mockRestore()
            loader.mockRestore()
        })

        it('reports surveys unavailable until deferred setup completes', async () => {
            vi.useFakeTimers()
            const previousExtensions = assignableWindow.__PosthogExtensions__
            const generateSurveys = vi.fn()
            assignableWindow.__PosthogExtensions__ = { generateSurveys }
            const posthog = await createPosthogInstance(uuidv7(), {
                __preview_deferred_init_extensions: true,
                advanced_disable_flags: true,
                disable_surveys: false,
                capture_pageview: false,
                disable_session_recording: true,
            })
            try {
                const client = posthog._getBrowserClientAdapter()
                const cached = [{ id: 'cached', type: SurveyType.API }]
                posthog.register({ [SURVEYS]: cached, [SURVEYS_LOADED_AT]: Date.now() })
                const callback = vi.fn()
                expect(client.getExtension('surveys')).toBeUndefined()
                posthog.getSurveys(callback)
                expect(callback).toHaveBeenCalledWith([], {
                    isLoaded: false,
                    error: 'SDK is not enabled or survey functionality is not yet loaded',
                })
                expect(generateSurveys).not.toHaveBeenCalled()

                await vi.advanceTimersByTimeAsync(200)
                expect(client.getExtension('surveys')).toBe(posthog.surveys)
                callback.mockClear()
                posthog.getSurveys(callback)
                expect(callback).toHaveBeenCalledWith(cached, { isLoaded: true })

                const fetched = [{ id: 'fetched', type: SurveyType.API }]
                const transport = vi.spyOn(posthog, '_send_request').mockImplementation(({ callback }) => {
                    callback?.({ statusCode: 200, json: { surveys: fetched } })
                })
                const request = vi.spyOn(client, 'sendRequest')
                await new Promise<void>((resolve) => posthog.getSurveys(() => resolve(), true))
                expect(request).toHaveBeenCalledWith('/api/surveys/', {
                    method: 'GET',
                    query: { token: posthog.config.token },
                    sentAt: 'query',
                    timeoutMs: posthog.config.surveys_request_timeout_ms,
                })
                expect(transport).toHaveBeenCalledOnce()
                expect(posthog.get_property(SURVEYS)).toEqual(fetched)
                expect(generateSurveys).not.toHaveBeenCalled()

                callback.mockClear()
                posthog.getSurveys(callback)
                expect(callback).toHaveBeenCalledWith(fetched, { isLoaded: true })
            } finally {
                await posthog.shutdown()
                assignableWindow.__PosthogExtensions__ = previousExtensions
                vi.restoreAllMocks()
                vi.useRealTimers()
            }
        })

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
            const processInitTaskQueue = vi
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

        it('delivers pending remote config to shared surveys exactly once', async () => {
            const savedDefaults = PostHog.__defaultExtensionClasses
            PostHog.__defaultExtensionClasses = {}
            const received: RemoteConfigResult[] = []
            class TestSurveys {
                readonly name = 'surveys'

                setup(client: Client): void {
                    client.onRemoteConfig((result) => received.push(result as RemoteConfigResult))
                }
            }

            try {
                const posthog = await createPosthogInstance(uuidv7(), {
                    __preview_deferred_init_extensions: true,
                    __extensionClasses: { surveys: TestSurveys as any },
                    advanced_disable_decide: false,
                    capture_pageview: false,
                    disable_session_recording: true,
                })
                const result = { ok: true, config: { surveys: true, marker: 'shared-surveys' } as any } as const

                posthog._onRemoteConfig(result)
                await new Promise((resolve) => setTimeout(resolve, 200))

                expect(
                    received.filter((entry) => entry.ok && (entry.config as any).marker === 'shared-surveys')
                ).toEqual([result])
            } finally {
                PostHog.__defaultExtensionClasses = savedDefaults
            }
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
            const setup = vi.fn()
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

        it('cancels deferred extension construction during shutdown', async () => {
            const savedDefaults = PostHog.__defaultExtensionClasses
            PostHog.__defaultExtensionClasses = {}
            const setup = vi.fn()
            const construct = vi.fn()
            class TestLogs {
                readonly name = 'logs'
                setup = setup
                constructor() {
                    construct()
                }
            }

            try {
                const posthog = await createPosthogInstance(uuidv7(), {
                    __preview_deferred_init_extensions: true,
                    __extensionClasses: { logs: TestLogs as any },
                    capture_pageview: false,
                })
                await posthog.shutdown()
                await new Promise((resolve) => setTimeout(resolve, 20))

                expect(setup).not.toHaveBeenCalled()
                expect(construct).not.toHaveBeenCalled()
            } finally {
                PostHog.__defaultExtensionClasses = savedDefaults
            }
        })
    })
})
