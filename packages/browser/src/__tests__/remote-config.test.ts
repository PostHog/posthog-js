jest.mock('@posthog/browser-common/utils/logger', () => ({
    createLogger: jest.fn().mockReturnValue({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    }),
}))

import { RemoteConfigLoader } from '../remote-config'
import { RequestRouter } from '../utils/request-router'
import { PostHog } from '../posthog-core'
import { PostHogConfig, RemoteConfig } from '../types'
import '../entrypoints/external-scripts-loader'
import { assignableWindow } from '../utils/globals'
import { createMockPostHog } from './helpers/posthog-instance'

const mockLogger = jest.requireMock('@posthog/browser-common/utils/logger').createLogger.mock.results[0].value

describe('RemoteConfigLoader', () => {
    let posthog: PostHog

    beforeEach(() => {
        jest.useFakeTimers()
        jest.clearAllMocks()

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

            expect(posthog._onRemoteConfig).toHaveBeenCalledWith({ ok: true, config })
        })

        it('loads the script if window config not set', () => {
            new RemoteConfigLoader(posthog).load()

            expect(assignableWindow.__PosthogExtensions__.loadExternalDependency).toHaveBeenCalledWith(
                posthog,
                'remote-config',
                expect.any(Function)
            )
            expect(posthog._send_request).not.toHaveBeenCalled()
            expect(posthog._onRemoteConfig).toHaveBeenCalledWith({ ok: true, config })
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
            expect(posthog._onRemoteConfig).toHaveBeenCalledWith({ ok: true, config })
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

        it('does not retry or rethrow synchronous config application errors', () => {
            assignableWindow._POSTHOG_REMOTE_CONFIG = {
                [posthog.config.token]: {
                    config,
                    siteApps: [],
                },
            }
            posthog._onRemoteConfig = jest.fn(() => {
                throw new Error('config application failed')
            })

            expect(() => new RemoteConfigLoader(posthog).load()).not.toThrow()

            expect(posthog._onRemoteConfig).toHaveBeenCalledTimes(1)
            expect(posthog._onRemoteConfig).toHaveBeenCalledWith({ ok: true, config })
            expect(posthog.featureFlags.ensureFlagsLoaded).toHaveBeenCalled()
        })

        it('does not rethrow feature flag initialization errors', () => {
            assignableWindow._POSTHOG_REMOTE_CONFIG = {
                [posthog.config.token]: {
                    config,
                    siteApps: [],
                },
            }
            posthog.featureFlags.ensureFlagsLoaded = jest.fn(() => {
                throw new Error('feature flag initialization failed')
            })

            expect(() => new RemoteConfigLoader(posthog).load()).not.toThrow()

            expect(posthog._onRemoteConfig).toHaveBeenCalledTimes(1)
            expect(posthog.featureFlags.ensureFlagsLoaded).toHaveBeenCalledTimes(1)
        })

        it('reports synchronous loading errors as a failed outcome', () => {
            assignableWindow.__PosthogExtensions__.loadExternalDependency = jest.fn(() => {
                throw new Error('loader failed')
            })

            new RemoteConfigLoader(posthog).load()

            expect(posthog._onRemoteConfig).toHaveBeenCalledWith({ ok: false })
            expect(posthog.featureFlags.ensureFlagsLoaded).toHaveBeenCalled()
        })

        it('still initializes extensions and loads flags when config fetch fails', () => {
            assignableWindow.__PosthogExtensions__.loadExternalDependency = jest.fn(
                (_ph: PostHog, _name: string, cb: (err?: any) => void) => {
                    cb()
                }
            )
            posthog._send_request = jest.fn().mockImplementation(({ callback }) => callback?.({ json: undefined }))

            new RemoteConfigLoader(posthog).load()

            // Should still call _onRemoteConfig, marked as failed, so extensions start
            expect(posthog._onRemoteConfig).toHaveBeenCalledWith({ ok: false })
            // Should still attempt to load flags
            expect(posthog.featureFlags.ensureFlagsLoaded).toHaveBeenCalled()
        })

        it('does not re-log status-zero failures already handled by the request layer', () => {
            assignableWindow.__PosthogExtensions__.loadExternalDependency = jest.fn(
                (_ph: PostHog, _name: string, cb: (err?: any) => void) => cb()
            )
            posthog._send_request = jest
                .fn()
                .mockImplementation(({ callback }) =>
                    callback?.({ statusCode: 0, error: new TypeError('Failed to fetch') })
                )

            new RemoteConfigLoader(posthog).load()

            expect(posthog._onRemoteConfig).toHaveBeenCalledWith({ ok: false })
            expect(mockLogger.warn).not.toHaveBeenCalled()
            expect(mockLogger.error).not.toHaveBeenCalled()
        })

        it('warns once for a bare status-zero response', () => {
            assignableWindow.__PosthogExtensions__.loadExternalDependency = jest.fn(
                (_ph: PostHog, _name: string, cb: (err?: any) => void) => cb()
            )
            posthog._send_request = jest.fn().mockImplementation(({ callback }) => callback?.({ statusCode: 0 }))

            new RemoteConfigLoader(posthog).load()

            expect(mockLogger.warn).toHaveBeenCalledWith('Failed to fetch remote config from PostHog.')
            expect(mockLogger.error).not.toHaveBeenCalled()
        })

        it('keeps HTTP failures at error severity', () => {
            assignableWindow.__PosthogExtensions__.loadExternalDependency = jest.fn(
                (_ph: PostHog, _name: string, cb: (err?: any) => void) => cb()
            )
            posthog._send_request = jest.fn().mockImplementation(({ callback }) => callback?.({ statusCode: 500 }))

            new RemoteConfigLoader(posthog).load()

            expect(mockLogger.error).toHaveBeenCalledWith('Failed to fetch remote config from PostHog.')
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

            expect(posthog._onRemoteConfig).toHaveBeenCalledWith({
                ok: true,
                config: { ...config, hasFeatureFlags: true },
            })
            expect(posthog.featureFlags.ensureFlagsLoaded).not.toHaveBeenCalled()
        })
    })
})
