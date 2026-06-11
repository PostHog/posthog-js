import { RemoteConfigLoader } from '../remote-config'
import { RequestRouter } from '../utils/request-router'
import { PostHog } from '../posthog-core'
import { PostHogConfig, RemoteConfig } from '../types'
import '../entrypoints/external-scripts-loader'
import { assignableWindow } from '../utils/globals'
import { createMockPostHog } from './helpers/posthog-instance'

describe('RemoteConfigLoader', () => {
    let posthog: PostHog

    beforeEach(() => {
        jest.useFakeTimers()

        const defaultConfig: Partial<PostHogConfig> = {
            token: 'testtoken',
            apiHost: 'https://test.com',
            persistence: 'memory',
        }

        document.body.innerHTML = ''
        document.head.innerHTML = ''
        jest.spyOn(window.console, 'error').mockImplementation()

        posthog = createMockPostHog({
            config: { ...defaultConfig },
            onRemoteConfig: jest.fn(),
            sendRequest: jest.fn().mockImplementation(({ callback }) => callback?.({ config: {} })),
            shouldDisableFlags: () => posthog.config.advancedDisableFlags || false,
            featureFlags: {
                ensureFlagsLoaded: jest.fn(),
            },
            reloadFeatureFlags: jest.fn(),
            requestRouter: new RequestRouter(createMockPostHog({ config: defaultConfig })),
        })
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    describe('remote config', () => {
        const config = { surveys: true } as RemoteConfig

        beforeEach(() => {
            assignableWindow._POSTHOG_REMOTE_CONFIG = undefined
            assignableWindow.POSTHOG_DEBUG = true

            assignableWindow.__PosthogExtensions__.loadExternalDependency = jest.fn(
                (_ph: PostHog, _name: string, cb: (err?: any) => void) => {
                    assignableWindow._POSTHOG_REMOTE_CONFIG = {}
                    assignableWindow._POSTHOG_REMOTE_CONFIG[_ph.config.token] = {
                        config,
                        siteApps: [],
                    }
                    cb()
                }
            )

            posthog.sendRequest = jest.fn().mockImplementation(({ callback }) => callback?.({ json: config }))
        })

        it('properly pulls from the window and uses it if set', () => {
            assignableWindow._POSTHOG_REMOTE_CONFIG = {
                [posthog.config.token]: {
                    config,
                    siteApps: [],
                },
            }
            new RemoteConfigLoader(posthog).load()

            expect(assignableWindow.__PosthogExtensions__.loadExternalDependency).not.toHaveBeenCalled()
            expect(posthog.sendRequest).not.toHaveBeenCalled()

            expect(posthog.onRemoteConfig).toHaveBeenCalledWith(config)
        })

        it('loads the script if window config not set', () => {
            new RemoteConfigLoader(posthog).load()

            expect(assignableWindow.__PosthogExtensions__.loadExternalDependency).toHaveBeenCalledWith(
                posthog,
                'remote-config',
                expect.any(Function)
            )
            expect(posthog.sendRequest).not.toHaveBeenCalled()
            expect(posthog.onRemoteConfig).toHaveBeenCalledWith(config)
        })

        it('loads the json if window config not set and js failed', () => {
            assignableWindow.__PosthogExtensions__.loadExternalDependency = jest.fn(
                (_ph: PostHog, _name: string, cb: (err?: any) => void) => {
                    cb()
                }
            )

            new RemoteConfigLoader(posthog).load()

            expect(assignableWindow.__PosthogExtensions__.loadExternalDependency).toHaveBeenCalled()
            expect(posthog.sendRequest).toHaveBeenCalledWith({
                method: 'GET',
                url: 'https://test.com/array/testtoken/config',
                callback: expect.any(Function),
            })
            expect(posthog.onRemoteConfig).toHaveBeenCalledWith(config)
        })

        it.each([
            [true, true],
            [false, false],
            [undefined, true],
        ])('conditionally reloads feature flags - hasFlags: %s, shouldReload: %s', (hasFeatureFlags, shouldReload) => {
            assignableWindow._POSTHOG_REMOTE_CONFIG = {
                [posthog.config.token]: {
                    config: { ...config, hasFeatureFlags },
                    siteApps: [],
                },
            }

            new RemoteConfigLoader(posthog).load()

            if (shouldReload) {
                expect(posthog.featureFlags.ensureFlagsLoaded).toHaveBeenCalled()
            } else {
                expect(posthog.featureFlags.ensureFlagsLoaded).not.toHaveBeenCalled()
            }
        })

        it('still initializes extensions and loads flags when config fetch fails', () => {
            assignableWindow.__PosthogExtensions__.loadExternalDependency = jest.fn(
                (_ph: PostHog, _name: string, cb: (err?: any) => void) => {
                    cb()
                }
            )
            posthog.sendRequest = jest.fn().mockImplementation(({ callback }) => callback?.({ json: undefined }))

            new RemoteConfigLoader(posthog).load()

            // Should still call onRemoteConfig with empty object so extensions start
            expect(posthog.onRemoteConfig).toHaveBeenCalledWith({})
            // Should still attempt to load flags
            expect(posthog.featureFlags.ensureFlagsLoaded).toHaveBeenCalled()
        })

        it('does not call ensureFlagsLoaded when advancedDisableFeatureFlagsOnFirstLoad is true', () => {
            posthog.config.advancedDisableFeatureFlagsOnFirstLoad = true

            assignableWindow._POSTHOG_REMOTE_CONFIG = {
                [posthog.config.token]: {
                    config: { ...config, hasFeatureFlags: true },
                    siteApps: [],
                },
            }

            new RemoteConfigLoader(posthog).load()

            expect(posthog.onRemoteConfig).toHaveBeenCalledWith({ ...config, hasFeatureFlags: true })
            expect(posthog.featureFlags.ensureFlagsLoaded).not.toHaveBeenCalled()
        })
    })

    describe('refresh', () => {
        it('calls reloadFeatureFlags directly without fetching config', () => {
            const loader = new RemoteConfigLoader(posthog)
            loader.refresh()

            expect(posthog.reloadFeatureFlags).toHaveBeenCalled()
            expect(posthog.sendRequest).not.toHaveBeenCalled()
            expect(posthog.onRemoteConfig).not.toHaveBeenCalled()
        })

        it('is a no-op when flags are disabled', () => {
            posthog.shouldDisableFlags = () => true

            const loader = new RemoteConfigLoader(posthog)
            loader.refresh()

            expect(posthog.reloadFeatureFlags).not.toHaveBeenCalled()
        })
    })

    describe('stop', () => {
        it('clears the refresh interval after load', () => {
            assignableWindow._POSTHOG_REMOTE_CONFIG = {
                [posthog.config.token]: {
                    config: { surveys: true } as RemoteConfig,
                    siteApps: [],
                },
            }

            const loader = new RemoteConfigLoader(posthog)
            loader.load()

            jest.advanceTimersByTime(5 * 60 * 1000)
            expect(posthog.reloadFeatureFlags).toHaveBeenCalledTimes(1)

            loader.stop()

            jest.advanceTimersByTime(5 * 60 * 1000)
            // Should not be called again after stop
            expect(posthog.reloadFeatureFlags).toHaveBeenCalledTimes(1)
        })
    })

    describe('visibility-aware refresh', () => {
        const config = { surveys: true } as RemoteConfig

        beforeEach(() => {
            assignableWindow._POSTHOG_REMOTE_CONFIG = {
                [posthog.config.token]: { config, siteApps: [] },
            }
        })

        it('skips refresh when the tab is hidden', () => {
            const loader = new RemoteConfigLoader(posthog)
            loader.load()

            // Simulate hiding the tab before the interval fires
            Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })

            // Interval fires while hidden — should be a no-op
            jest.advanceTimersByTime(5 * 60 * 1000)
            expect(posthog.reloadFeatureFlags).not.toHaveBeenCalled()

            loader.stop()
            Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
        })

        it('refreshes when tab becomes visible and interval fires', () => {
            const loader = new RemoteConfigLoader(posthog)
            loader.load()

            // Simulate hiding the tab
            Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })

            // Interval fires while hidden — no refresh
            jest.advanceTimersByTime(5 * 60 * 1000)
            expect(posthog.reloadFeatureFlags).not.toHaveBeenCalled()

            // Tab becomes visible
            Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })

            // Next interval fires while visible — should refresh
            jest.advanceTimersByTime(5 * 60 * 1000)
            expect(posthog.reloadFeatureFlags).toHaveBeenCalledTimes(1)

            loader.stop()
        })

        it('skips refresh when no document is available', async () => {
            try {
                await jest.isolateModulesAsync(async () => {
                    jest.doMock('../utils/globals', () => ({
                        ...jest.requireActual('../utils/globals'),
                        document: undefined,
                    }))

                    // Re-import with no globals document to simulate browser extension background contexts.
                    const { RemoteConfigLoader: NoDocumentRemoteConfigLoader } = await import('../remote-config')
                    const reloadFeatureFlags = jest.fn()

                    new NoDocumentRemoteConfigLoader({
                        shouldDisableFlags: () => false,
                        reloadFeatureFlags,
                    } as any).refresh()

                    expect(reloadFeatureFlags).not.toHaveBeenCalled()
                })
            } finally {
                jest.dontMock('../utils/globals')
            }
        })
    })

    describe('configurable refresh interval', () => {
        const config = { surveys: true } as RemoteConfig

        beforeEach(() => {
            assignableWindow._POSTHOG_REMOTE_CONFIG = {
                [posthog.config.token]: { config, siteApps: [] },
            }
        })

        it('uses custom refresh interval when configured', () => {
            const customInterval = 10 * 60 * 1000 // 10 minutes
            posthog.config.remoteConfigRefreshIntervalMs = customInterval

            const loader = new RemoteConfigLoader(posthog)
            loader.load()

            // Default interval (5 min) should not trigger refresh
            jest.advanceTimersByTime(5 * 60 * 1000)
            expect(posthog.reloadFeatureFlags).not.toHaveBeenCalled()

            // Custom interval (10 min) should trigger refresh
            jest.advanceTimersByTime(5 * 60 * 1000) // total: 10 minutes
            expect(posthog.reloadFeatureFlags).toHaveBeenCalledTimes(1)

            loader.stop()
        })

        it('disables periodic refresh when interval is 0', () => {
            posthog.config.remoteConfigRefreshIntervalMs = 0

            const loader = new RemoteConfigLoader(posthog)
            loader.load()

            // Even after a long time, no refresh should occur
            jest.advanceTimersByTime(30 * 60 * 1000) // 30 minutes
            expect(posthog.reloadFeatureFlags).not.toHaveBeenCalled()

            loader.stop()
        })

        it('uses default interval when config is undefined', () => {
            posthog.config.remoteConfigRefreshIntervalMs = undefined

            const loader = new RemoteConfigLoader(posthog)
            loader.load()

            // Should use default 5 minute interval
            jest.advanceTimersByTime(5 * 60 * 1000)
            expect(posthog.reloadFeatureFlags).toHaveBeenCalledTimes(1)

            loader.stop()
        })
    })
})
