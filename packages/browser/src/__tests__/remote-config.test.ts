vi.mock('@posthog/browser-common/utils/logger', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@posthog/browser-common/utils/logger')>()),
    createLogger: vi.fn().mockReturnValue({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }),
}))

import { createLogger } from '@posthog/browser-common/utils/logger'
import { RemoteConfigLoader } from '../remote-config'
import { RequestRouter } from '../utils/request-router'
import { PostHog } from '../posthog-core'
import { PostHogConfig, RemoteConfig, RemoteConfigResult } from '../types'
import type { Client } from '@posthog/browser-common'
import type { RequestResponse } from '@posthog/types'
import { Autocapture } from '../autocapture'
import { AUTOCAPTURE_DISABLED_SERVER_SIDE } from '../constants'
import '../entrypoints/external-scripts-loader'
import { assignableWindow } from '../utils/globals'
import { createMockPostHog } from './helpers/posthog-instance'

const mockLogger = vi.mocked(createLogger).mock.results[0].value

describe('RemoteConfigLoader', () => {
    let posthog: PostHog

    beforeEach(() => {
        vi.useFakeTimers()
        vi.clearAllMocks()

        const defaultConfig: Partial<PostHogConfig> = {
            token: 'testtoken',
            api_host: 'https://test.com',
            persistence: 'memory',
        }

        document.body.innerHTML = ''
        document.head.innerHTML = ''
        vi.spyOn(window.console, 'error').mockImplementation(() => {})

        posthog = createMockPostHog({
            config: { ...defaultConfig },
            _onRemoteConfig: vi.fn(),
            _send_request: vi.fn().mockImplementation(({ callback }) => callback?.({ config: {} })),
            _shouldDisableFlags: () =>
                posthog.config.advanced_disable_flags || posthog.config.advanced_disable_decide || false,
            featureFlags: {
                ensureFlagsLoaded: vi.fn(),
            },
            reloadFeatureFlags: vi.fn(),
            requestRouter: new RequestRouter(createMockPostHog({ config: defaultConfig })),
        })
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    describe('autocapture with cached remote config', () => {
        let autocapture: Autocapture
        let capture: ReturnType<typeof vi.fn>
        let button: HTMLButtonElement
        let completeRequest: (response: RequestResponse) => void
        let cachedOptOut: boolean | undefined

        beforeEach(() => {
            cachedOptOut = false
            capture = vi.fn()
            button = document.createElement('button')
            document.body.appendChild(button)
            assignableWindow._POSTHOG_REMOTE_CONFIG = undefined
            assignableWindow.__PosthogExtensions__.loadExternalDependency = vi.fn((_ph, _name, cb) => cb())
            posthog.config.autocapture = true
            posthog._send_request = vi.fn(({ callback }) => {
                completeRequest = callback!
            })
            autocapture = new Autocapture({
                refresh: (config) => {
                    config.enabled = !!posthog.config.autocapture
                    config.remoteRequestsDisabled = posthog._shouldDisableFlags()
                },
            })
            autocapture.setup({
                capture,
                kv: {
                    get: (key: string) => (key === AUTOCAPTURE_DISABLED_SERVER_SIDE ? cachedOptOut : undefined),
                    set: (_key: string, value: boolean) => {
                        cachedOptOut = value
                    },
                },
                onRemoteConfig: (handler: (result: RemoteConfigResult) => void) => {
                    posthog._onRemoteConfig = handler
                    return { dispose: vi.fn() }
                },
            } as unknown as Client)
        })

        afterEach(() => {
            autocapture.dispose()
            assignableWindow._POSTHOG_REMOTE_CONFIG = undefined
        })

        it.each([
            ['enabled', { statusCode: 200, json: { autocapture_opt_out: false } }, true],
            ['disabled', { statusCode: 200, json: { autocapture_opt_out: true } }, false],
            ['missing opt-out', { statusCode: 200, json: {} }, true],
            ['unavailable config', { statusCode: 200 }, true],
            ['network error', { statusCode: 0, error: new TypeError('Failed to fetch') }, true],
            ['timeout', { statusCode: 0, error: new DOMException('Timed out', 'AbortError') }, true],
        ])('waits for the initial %s outcome before using cached enablement', (_name, response, enabled) => {
            new RemoteConfigLoader(posthog).load()
            button.click()
            expect(capture).not.toHaveBeenCalled()
            expect(autocapture.isEnabled).toBe(false)

            completeRequest(response)
            expect(autocapture.isEnabled).toBe(enabled)
            expect(capture).not.toHaveBeenCalled() // Do not replay clicks from before the config outcome.
            button.click()
            expect(capture).toHaveBeenCalledTimes(enabled ? 1 : 0)
        })

        it.each([true, false, undefined])('preserves cached opt-out %s when requests are disabled', (optOut) => {
            cachedOptOut = optOut
            posthog.config.advanced_disable_flags = true
            autocapture.startIfEnabled()

            new RemoteConfigLoader(posthog).load()
            button.click()

            expect(posthog._send_request).not.toHaveBeenCalled()
            expect(capture).toHaveBeenCalledTimes(optOut === true ? 0 : 1)
        })

        it.each([true, false])('applies preloaded opt-out %s synchronously', (optOut) => {
            assignableWindow._POSTHOG_REMOTE_CONFIG = {
                [posthog.config.token]: { config: { autocapture_opt_out: optOut }, siteApps: [] },
            }

            new RemoteConfigLoader(posthog).load()
            button.click()

            expect(posthog._send_request).not.toHaveBeenCalled()
            expect(assignableWindow.__PosthogExtensions__.loadExternalDependency).not.toHaveBeenCalled()
            expect(capture).toHaveBeenCalledTimes(optOut ? 0 : 1)
        })

        it.each([true, false])('preserves local opt-out with remote opt-out %s', (optOut) => {
            posthog.config.autocapture = false
            new RemoteConfigLoader(posthog).load()
            button.click()
            completeRequest({ statusCode: 200, json: { autocapture_opt_out: optOut } })
            button.click()

            expect(autocapture.isEnabled).toBe(false)
            expect(capture).not.toHaveBeenCalled()
        })

        it('uses subsequent config outcomes without re-gating or duplicating listeners', () => {
            const loader = new RemoteConfigLoader(posthog)
            loader.load()
            completeRequest({ statusCode: 200, json: { autocapture_opt_out: false } })
            button.click()
            expect(capture).toHaveBeenCalledTimes(1)

            loader.load()
            button.click()
            expect(capture).toHaveBeenCalledTimes(2)
            completeRequest({ statusCode: 200, json: { autocapture_opt_out: true } })
            button.click()
            expect(capture).toHaveBeenCalledTimes(2)

            loader.load()
            completeRequest({ statusCode: 200, json: { autocapture_opt_out: false } })
            button.click()
            expect(capture).toHaveBeenCalledTimes(3)
        })
    })

    describe('remote config', () => {
        const config = { surveys: true } as RemoteConfig

        beforeEach(() => {
            assignableWindow._POSTHOG_REMOTE_CONFIG = undefined

            assignableWindow.__PosthogExtensions__.loadExternalDependency = vi.fn(
                (_ph: PostHog, _name: string, cb: (err?: any) => void) => {
                    assignableWindow._POSTHOG_REMOTE_CONFIG = {}
                    assignableWindow._POSTHOG_REMOTE_CONFIG[_ph.config.token] = {
                        config,
                        siteApps: [],
                    }
                    cb()
                }
            )

            posthog._send_request = vi.fn().mockImplementation(({ callback }) => callback?.({ json: config }))
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
            assignableWindow.__PosthogExtensions__.loadExternalDependency = vi.fn(
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
            posthog._onRemoteConfig = vi.fn(() => {
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
            posthog.featureFlags.ensureFlagsLoaded = vi.fn(() => {
                throw new Error('feature flag initialization failed')
            })

            expect(() => new RemoteConfigLoader(posthog).load()).not.toThrow()

            expect(posthog._onRemoteConfig).toHaveBeenCalledTimes(1)
            expect(posthog.featureFlags.ensureFlagsLoaded).toHaveBeenCalledTimes(1)
        })

        it('reports synchronous loading errors as a failed outcome', () => {
            assignableWindow.__PosthogExtensions__.loadExternalDependency = vi.fn(() => {
                throw new Error('loader failed')
            })

            new RemoteConfigLoader(posthog).load()

            expect(posthog._onRemoteConfig).toHaveBeenCalledWith({ ok: false })
            expect(posthog.featureFlags.ensureFlagsLoaded).toHaveBeenCalled()
        })

        it('still initializes extensions and loads flags when config fetch fails', () => {
            assignableWindow.__PosthogExtensions__.loadExternalDependency = vi.fn(
                (_ph: PostHog, _name: string, cb: (err?: any) => void) => {
                    cb()
                }
            )
            posthog._send_request = vi.fn().mockImplementation(({ callback }) => callback?.({ json: undefined }))

            new RemoteConfigLoader(posthog).load()

            // Should still call _onRemoteConfig, marked as failed, so extensions start
            expect(posthog._onRemoteConfig).toHaveBeenCalledWith({ ok: false })
            // Should still attempt to load flags
            expect(posthog.featureFlags.ensureFlagsLoaded).toHaveBeenCalled()
        })

        it('does not re-log status-zero failures already handled by the request layer', () => {
            assignableWindow.__PosthogExtensions__.loadExternalDependency = vi.fn(
                (_ph: PostHog, _name: string, cb: (err?: any) => void) => cb()
            )
            posthog._send_request = vi
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
            assignableWindow.__PosthogExtensions__.loadExternalDependency = vi.fn(
                (_ph: PostHog, _name: string, cb: (err?: any) => void) => cb()
            )
            posthog._send_request = vi.fn().mockImplementation(({ callback }) => callback?.({ statusCode: 0 }))

            new RemoteConfigLoader(posthog).load()

            expect(mockLogger.warn).toHaveBeenCalledWith('Failed to fetch remote config from PostHog.')
            expect(mockLogger.error).not.toHaveBeenCalled()
        })

        it('keeps HTTP failures at error severity', () => {
            assignableWindow.__PosthogExtensions__.loadExternalDependency = vi.fn(
                (_ph: PostHog, _name: string, cb: (err?: any) => void) => cb()
            )
            posthog._send_request = vi.fn().mockImplementation(({ callback }) => callback?.({ statusCode: 500 }))

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
