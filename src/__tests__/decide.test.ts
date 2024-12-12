import { Decide } from '../decide'
import { PostHogPersistence } from '../posthog-persistence'
import { RequestRouter } from '../utils/request-router'
import { PostHog } from '../posthog-core'
import { PostHogConfig, Properties, RemoteConfig } from '../types'
import '../entrypoints/external-scripts-loader'
import { assignableWindow } from '../utils/globals'

describe('Decide', () => {
    let posthog: PostHog

    beforeEach(() => {
        // clean the JSDOM to prevent interdependencies between tests

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
            persistence: new PostHogPersistence(defaultConfig as PostHogConfig),
            register: (props: Properties) => posthog.persistence!.register(props),
            unregister: (key: string) => posthog.persistence!.unregister(key),
            get_property: (key: string) => posthog.persistence!.props[key],
            capture: jest.fn(),
            _addCaptureHook: jest.fn(),
            _onRemoteConfig: jest.fn(),
            get_distinct_id: jest.fn().mockImplementation(() => 'distinctid'),
            _send_request: jest.fn().mockImplementation(({ callback }) => callback?.({ config: {} })),
            featureFlags: {
                resetRequestQueue: jest.fn(),
                reloadFeatureFlags: jest.fn(),
                receivedFeatureFlags: jest.fn(),
                setReloadingPaused: jest.fn(),
                _callDecideEndpoint: jest.fn(),
            },
            requestRouter: new RequestRouter({ config: defaultConfig } as unknown as PostHog),
            _hasBootstrappedFeatureFlags: jest.fn(),
            getGroups: () => ({ organization: '5' }),
        } as unknown as PostHog
    })

    describe('constructor', () => {
        it('should call _callDecideEndpoint on constructor', () => {
            new Decide(posthog).call()

            expect(posthog.featureFlags._callDecideEndpoint).toHaveBeenCalledTimes(1)
            expect(posthog.featureFlags._callDecideEndpoint).toHaveBeenLastCalledWith({
                data: {
                    disable_flags: undefined,
                },
                callback: expect.any(Function),
            })
        })

        it('should not call _callDecideEndpoint on constructor if advanced_disable_decide', () => {
            posthog.config.advanced_disable_decide = true
            new Decide(posthog).call()

            expect(posthog.featureFlags._callDecideEndpoint).toHaveBeenCalledTimes(0)
        })

        it('should call _callDecideEndpoint with disable_flags true if advanced_disable_feature_flags is set', () => {
            console.log('posthog.config', posthog.config)
            posthog.config.advanced_disable_feature_flags = true
            posthog.config.advanced_disable_feature_flags_on_first_load = false

            new Decide(posthog).call()
            expect(posthog.featureFlags._callDecideEndpoint).toHaveBeenCalledTimes(1)
            expect(posthog.featureFlags._callDecideEndpoint).toHaveBeenLastCalledWith({
                data: {
                    disable_flags: true,
                },
                callback: expect.any(Function),
            })
        })

        it('should call _callDecideEndpoint with disable_flags true if advanced_disable_feature_flags_on_first_load is set', () => {
            posthog.config.advanced_disable_feature_flags = false
            posthog.config.advanced_disable_feature_flags_on_first_load = true

            new Decide(posthog).call()
            expect(posthog.featureFlags._callDecideEndpoint).toHaveBeenCalledTimes(1)
            expect(posthog.featureFlags._callDecideEndpoint).toHaveBeenLastCalledWith({
                data: {
                    disable_flags: true,
                },
                callback: expect.any(Function),
            })
        })
    })

    // describe('parseDecideResponse', () => {

    //     it('Make sure receivedFeatureFlags is called with errors if the decide response fails', () => {
    //         ;(window as any).POSTHOG_DEBUG = true

    //         subject(undefined as unknown as DecideResponse)

    //         expect(posthog.featureFlags.receivedFeatureFlags).toHaveBeenCalledWith({}, true)
    //         expect(console.error).toHaveBeenCalledWith(
    //             '[PostHog.js] [Decide]',
    //             'Failed to fetch feature flags from PostHog.'
    //         )
    //     })

    //     it('Make sure receivedFeatureFlags is not called if advanced_disable_feature_flags_on_first_load is set', () => {
    //         posthog.config = {
    //             api_host: 'https://test.com',
    //             token: 'testtoken',
    //             persistence: 'memory',
    //             advanced_disable_feature_flags_on_first_load: true,
    //         } as PostHogConfig

    //         const decideResponse = {
    //             featureFlags: { 'test-flag': true },
    //         } as unknown as DecideResponse
    //         subject(decideResponse)

    //         expect(posthog._onRemoteConfig).toHaveBeenCalledWith(decideResponse)
    //         expect(posthog.featureFlags.receivedFeatureFlags).not.toHaveBeenCalled()
    //     })

    //     it('Make sure receivedFeatureFlags is not called if advanced_disable_feature_flags is set', () => {
    //         posthog.config = {
    //             api_host: 'https://test.com',
    //             token: 'testtoken',
    //             persistence: 'memory',
    //             advanced_disable_feature_flags: true,
    //         } as PostHogConfig

    //         const decideResponse = {
    //             featureFlags: { 'test-flag': true },
    //         } as unknown as DecideResponse
    //         subject(decideResponse)

    //         expect(posthog._onRemoteConfig).toHaveBeenCalledWith(decideResponse)
    //         expect(posthog.featureFlags.receivedFeatureFlags).not.toHaveBeenCalled()
    //     })
    // })

    describe('remote config', () => {
        const config = { surveys: true } as RemoteConfig

        beforeEach(() => {
            posthog.config.__preview_remote_config = true
            assignableWindow._POSTHOG_CONFIG = undefined
            assignableWindow.POSTHOG_DEBUG = true

            assignableWindow.__PosthogExtensions__.loadExternalDependency = jest.fn(
                (_ph: PostHog, _name: string, cb: (err?: any) => void) => {
                    assignableWindow._POSTHOG_CONFIG = config as RemoteConfig
                    cb()
                }
            )

            posthog._send_request = jest.fn().mockImplementation(({ callback }) => callback?.({ json: config }))
        })

        it('properly pulls from the window and uses it if set', () => {
            assignableWindow._POSTHOG_CONFIG = config as RemoteConfig
            new Decide(posthog).call()

            expect(assignableWindow.__PosthogExtensions__.loadExternalDependency).not.toHaveBeenCalled()
            expect(posthog._send_request).not.toHaveBeenCalled()

            expect(posthog._onRemoteConfig).toHaveBeenCalledWith(config)
        })

        it('loads the script if window config not set', () => {
            new Decide(posthog).call()

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

            new Decide(posthog).call()

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
            assignableWindow._POSTHOG_CONFIG = { hasFeatureFlags } as RemoteConfig
            new Decide(posthog).call()

            if (shouldReload) {
                expect(posthog.featureFlags.reloadFeatureFlags).toHaveBeenCalled()
            } else {
                expect(posthog.featureFlags.reloadFeatureFlags).not.toHaveBeenCalled()
            }
        })
    })
})
