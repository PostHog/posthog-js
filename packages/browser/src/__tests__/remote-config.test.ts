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
            api_host: 'https://test.com',
            persistence: 'memory',
        }

        document.body.innerHTML = ''
        document.head.innerHTML = ''
        jest.spyOn(window.console, 'error').mockImplementation()

        posthog = createMockPostHog({
            config: { ...defaultConfig },
            _onRemoteConfig: jest.fn(),
            _send_request: jest.fn().mockImplementation(({ callback }) => callback?.({ config: {} })),
            _shouldDisableFlags: () =>
                posthog.config.advanced_disable_flags || posthog.config.advanced_disable_decide || false,
            featureFlags: {
                ensureFlagsLoaded: jest.fn(),
                reloadFeatureFlags: jest.fn(),
            },
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

            posthog._send_request = jest.fn().mockImplementation(({ callback }) => callback?.({ json: config }))
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
            expect(posthog._send_request).not.toHaveBeenCalled()

            expect(posthog._onRemoteConfig).toHaveBeenCalledWith(config)
        })

        it('loads the script if window config not set', () => {
            new RemoteConfigLoader(posthog).load()

            expect(assignableWindow.__PosthogExtensions__.loadExternalDependency).toHaveBeenCalledWith(
                posthog,
                'remote-config',
                expect.any(Function)
            )
            expect(posthog._send_request).not.toHaveBeenCalled()
            expect(posthog._onRemoteConfig).toHaveBeenCalledWith(config)
        })

        it('loads the json if window config not set and js failed', () => {
            assignableWindow.__PosthogExtensions__.loadExternalDependency = jest.fn(
                (_ph: PostHog, _name: string, cb: (err?: any) => void) => {
                    cb()
                }
            )

            new RemoteConfigLoader(posthog).load()

            expect(assignableWindow.__PosthogExtensions__.loadExternalDependency).toHaveBeenCalled()
            expect(posthog._send_request).toHaveBeenCalledWith({
                method: 'GET',
                url: 'https://test.com/array/testtoken/config',
                callback: expect.any(Function),
            })
            expect(posthog._onRemoteConfig).toHaveBeenCalledWith(config)
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
            posthog._send_request = jest.fn().mockImplementation(({ callback }) => callback?.({ json: undefined }))

            new RemoteConfigLoader(posthog).load()

            // Should still call _onRemoteConfig with empty object so extensions start
            expect(posthog._onRemoteConfig).toHaveBeenCalledWith({})
            // Should still attempt to load flags
            expect(posthog.featureFlags.ensureFlagsLoaded).toHaveBeenCalled()
        })

        it('does not call ensureFlagsLoaded when advanced_disable_feature_flags_on_first_load is true', () => {
            posthog.config.advanced_disable_feature_flags_on_first_load = true

            assignableWindow._POSTHOG_REMOTE_CONFIG = {
                [posthog.config.token]: {
                    config: { ...config, hasFeatureFlags: true },
                    siteApps: [],
                },
            }

            new RemoteConfigLoader(posthog).load()

            expect(posthog._onRemoteConfig).toHaveBeenCalledWith({ ...config, hasFeatureFlags: true })
            expect(posthog.featureFlags.ensureFlagsLoaded).not.toHaveBeenCalled()
        })
    })

    describe('refresh', () => {
        it('calls reloadFeatureFlags directly without fetching config', () => {
            const loader = new RemoteConfigLoader(posthog)
            loader.refresh()

            expect(posthog.featureFlags.reloadFeatureFlags).toHaveBeenCalled()
            expect(posthog._send_request).not.toHaveBeenCalled()
            expect(posthog._onRemoteConfig).not.toHaveBeenCalled()
        })

        it('is a no-op when flags are disabled', () => {
            posthog._shouldDisableFlags = () => true

            const loader = new RemoteConfigLoader(posthog)
            loader.refresh()

            expect(posthog.featureFlags.reloadFeatureFlags).not.toHaveBeenCalled()
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
            expect(posthog.featureFlags.reloadFeatureFlags).toHaveBeenCalledTimes(1)

            loader.stop()

            jest.advanceTimersByTime(5 * 60 * 1000)
            // Should not be called again after stop
            expect(posthog.featureFlags.reloadFeatureFlags).toHaveBeenCalledTimes(1)
        })
    })

    describe('visibility-aware refresh', () => {
        const config = { surveys: true } as RemoteConfig

        beforeEach(() => {
            assignableWindow._POSTHOG_REMOTE_CONFIG = {
                [posthog.config.token]: { config, siteApps: [] },
            }
        })

        it('pauses the refresh interval when the tab is hidden', () => {
            const loader = new RemoteConfigLoader(posthog)
            loader.load()

            // Simulate hiding the tab partway through an interval
            jest.advanceTimersByTime(2 * 60 * 1000)
            Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
            document.dispatchEvent(new Event('visibilitychange'))

            // Even after the full interval elapses, no refresh while hidden
            jest.advanceTimersByTime(5 * 60 * 1000)
            expect(posthog.featureFlags.reloadFeatureFlags).not.toHaveBeenCalled()

            loader.stop()
            Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
        })

        it('refreshes immediately on re-focus when enough time has elapsed', () => {
            const loader = new RemoteConfigLoader(posthog)
            loader.load()

            // Simulate hiding the tab
            Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
            document.dispatchEvent(new Event('visibilitychange'))

            // Advance past the refresh interval while hidden
            jest.advanceTimersByTime(6 * 60 * 1000)
            expect(posthog.featureFlags.reloadFeatureFlags).not.toHaveBeenCalled()

            // Come back — should refresh immediately since we're past the interval
            Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
            document.dispatchEvent(new Event('visibilitychange'))

            expect(posthog.featureFlags.reloadFeatureFlags).toHaveBeenCalledTimes(1)

            loader.stop()
        })

        it('does not refresh immediately on re-focus when interval has not elapsed', () => {
            const loader = new RemoteConfigLoader(posthog)
            loader.load()

            // Hide then quickly re-show (less than REFRESH_INTERVAL)
            Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
            document.dispatchEvent(new Event('visibilitychange'))

            jest.advanceTimersByTime(1 * 60 * 1000) // Only 1 minute

            Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
            document.dispatchEvent(new Event('visibilitychange'))

            // Should NOT have refreshed — not enough time elapsed
            expect(posthog.featureFlags.reloadFeatureFlags).not.toHaveBeenCalled()

            loader.stop()
        })
    })
})
