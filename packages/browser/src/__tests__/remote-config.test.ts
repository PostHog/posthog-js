import { RemoteConfigLoader } from '../remote-config'
import { RequestRouter } from '../utils/request-router'
import { PostHog } from '../posthog-core'
import { PostHogConfig, RemoteConfig } from '../types'
import '../entrypoints/external-scripts-loader'
import { assignableWindow } from '../utils/globals'

describe('RemoteConfigLoader', () => {
    let posthog: PostHog

    beforeEach(() => {
        const defaultConfig: Partial<PostHogConfig> = {
            token: 'testtoken',
            api_host: 'https://test.com',
            persistence: 'memory',
        }

        document.body.innerHTML = ''
        document.head.innerHTML = ''
        jest.spyOn(window.console, 'error').mockImplementation()

        posthog = {
            config: { ...defaultConfig },
            _onRemoteConfig: jest.fn(),
            _send_request: jest.fn().mockImplementation(({ callback }) => callback?.({ config: {} })),
            _shouldDisableFlags: () =>
                posthog.config.advanced_disable_flags || posthog.config.advanced_disable_decide || false,
            featureFlags: {
                ensureFlagsLoaded: jest.fn(),
            },
            requestRouter: new RequestRouter({ config: defaultConfig } as unknown as PostHog),
        } as unknown as PostHog
    })

    describe('remote config', () => {
        const config = { surveys: true } as RemoteConfig

        beforeEach(() => {
            posthog.config.__preview_remote_config = true
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
    })
})
