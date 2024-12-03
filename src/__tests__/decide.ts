import { Decide } from '../decide'
import { PostHogPersistence } from '../posthog-persistence'
import { RequestRouter } from '../utils/request-router'
import { PostHog } from '../posthog-core'
import { DecideResponse, PostHogConfig, Properties, RemoteConfig } from '../types'
import '../entrypoints/external-scripts-loader'
import { assignableWindow } from '../utils/globals'

const expectDecodedSendRequest = (
    send_request: PostHog['_send_request'],
    data: Record<string, any>,
    noCompression: boolean,
    posthog: PostHog
) => {
    const lastCall = jest.mocked(send_request).mock.calls[jest.mocked(send_request).mock.calls.length - 1]

    const decoded = lastCall[0].data
    // Helper to give us more accurate error messages
    expect(decoded).toEqual(data)

    expect(posthog._send_request).toHaveBeenCalledWith({
        url: 'https://test.com/decide/?v=3',
        data,
        method: 'POST',
        callback: expect.any(Function),
        compression: noCompression ? undefined : 'base64',
        timeout: undefined,
    })
}

describe('Decide', () => {
    let posthog: PostHog

    const decide = () => new Decide(posthog)

    const defaultConfig: Partial<PostHogConfig> = {
        token: 'testtoken',
        api_host: 'https://test.com',
        persistence: 'memory',
    }

    beforeEach(() => {
        // clean the JSDOM to prevent interdependencies between tests
        document.body.innerHTML = ''
        document.head.innerHTML = ''
        jest.spyOn(window.console, 'error').mockImplementation()

        posthog = {
            config: defaultConfig,
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
                _startReloadTimer: jest.fn(),
            },
            requestRouter: new RequestRouter({ config: defaultConfig } as unknown as PostHog),
            _hasBootstrappedFeatureFlags: jest.fn(),
            getGroups: () => ({ organization: '5' }),
        } as unknown as PostHog
    })

    describe('constructor', () => {
        it('should call instance._send_request on constructor', () => {
            decide().call()

            expectDecodedSendRequest(
                posthog._send_request,
                {
                    token: 'testtoken',
                    distinct_id: 'distinctid',
                    groups: { organization: '5' },
                },
                false,
                posthog
            )
        })

        it('should send all stored properties with decide request', () => {
            posthog.register({
                $stored_person_properties: { key: 'value' },
                $stored_group_properties: { organization: { orgName: 'orgValue' } },
            })

            decide().call()

            expectDecodedSendRequest(
                posthog._send_request,
                {
                    token: 'testtoken',
                    distinct_id: 'distinctid',
                    groups: { organization: '5' },
                    person_properties: { key: 'value' },
                    group_properties: { organization: { orgName: 'orgValue' } },
                },
                false,
                posthog
            )
        })

        it('should send disable flags with decide request when config is set', () => {
            posthog.config = {
                api_host: 'https://test.com',
                token: 'testtoken',
                persistence: 'memory',
                advanced_disable_feature_flags: true,
            } as PostHogConfig

            posthog.register({
                $stored_person_properties: { key: 'value' },
                $stored_group_properties: { organization: { orgName: 'orgValue' } },
            })
            decide().call()

            expectDecodedSendRequest(
                posthog._send_request,
                {
                    token: 'testtoken',
                    distinct_id: 'distinctid',
                    groups: { organization: '5' },
                    person_properties: { key: 'value' },
                    group_properties: { organization: { orgName: 'orgValue' } },
                    disable_flags: true,
                },
                false,
                posthog
            )
        })

        it('should disable compression when config is set', () => {
            posthog.config = {
                api_host: 'https://test.com',
                token: 'testtoken',
                persistence: 'memory',
                disable_compression: true,
            } as PostHogConfig

            posthog.register({
                $stored_person_properties: {},
                $stored_group_properties: {},
            })
            decide().call()

            // noCompression is true
            expectDecodedSendRequest(
                posthog._send_request,
                {
                    token: 'testtoken',
                    distinct_id: 'distinctid',
                    groups: { organization: '5' },
                    person_properties: {},
                    group_properties: {},
                },
                true,
                posthog
            )
        })

        it('should send disable flags with decide request when config for advanced_disable_feature_flags_on_first_load is set', () => {
            posthog.config = {
                api_host: 'https://test.com',
                token: 'testtoken',
                persistence: 'memory',
                advanced_disable_feature_flags_on_first_load: true,
            } as PostHogConfig

            posthog.register({
                $stored_person_properties: { key: 'value' },
                $stored_group_properties: { organization: { orgName: 'orgValue' } },
            })

            decide().call()

            expectDecodedSendRequest(
                posthog._send_request,
                {
                    token: 'testtoken',
                    distinct_id: 'distinctid',
                    groups: { organization: '5' },
                    person_properties: { key: 'value' },
                    group_properties: { organization: { orgName: 'orgValue' } },
                    disable_flags: true,
                },
                false,
                posthog
            )
        })
    })

    describe('parseDecideResponse', () => {
        const subject = (decideResponse: DecideResponse) => decide().parseDecideResponse(decideResponse)

        it('properly parses decide response', () => {
            subject({} as DecideResponse)

            expect(posthog.featureFlags.receivedFeatureFlags).toHaveBeenCalledWith({}, false)
            expect(posthog._onRemoteConfig).toHaveBeenCalledWith({})
        })

        it('Make sure receivedFeatureFlags is called with errors if the decide response fails', () => {
            ;(window as any).POSTHOG_DEBUG = true

            subject(undefined as unknown as DecideResponse)

            expect(posthog.featureFlags.receivedFeatureFlags).toHaveBeenCalledWith({}, true)
            expect(console.error).toHaveBeenCalledWith('[PostHog.js]', 'Failed to fetch feature flags from PostHog.')
        })

        it('Make sure receivedFeatureFlags is not called if advanced_disable_feature_flags_on_first_load is set', () => {
            posthog.config = {
                api_host: 'https://test.com',
                token: 'testtoken',
                persistence: 'memory',
                advanced_disable_feature_flags_on_first_load: true,
            } as PostHogConfig

            const decideResponse = {
                featureFlags: { 'test-flag': true },
            } as unknown as DecideResponse
            subject(decideResponse)

            expect(posthog._onRemoteConfig).toHaveBeenCalledWith(decideResponse)
            expect(posthog.featureFlags.receivedFeatureFlags).not.toHaveBeenCalled()
        })

        it('Make sure receivedFeatureFlags is not called if advanced_disable_feature_flags is set', () => {
            posthog.config = {
                api_host: 'https://test.com',
                token: 'testtoken',
                persistence: 'memory',
                advanced_disable_feature_flags: true,
            } as PostHogConfig

            const decideResponse = {
                featureFlags: { 'test-flag': true },
            } as unknown as DecideResponse
            subject(decideResponse)

            expect(posthog._onRemoteConfig).toHaveBeenCalledWith(decideResponse)
            expect(posthog.featureFlags.receivedFeatureFlags).not.toHaveBeenCalled()
        })
    })

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
            decide().call()

            expect(assignableWindow.__PosthogExtensions__.loadExternalDependency).not.toHaveBeenCalled()
            expect(posthog._send_request).not.toHaveBeenCalled()

            expect(posthog._onRemoteConfig).toHaveBeenCalledWith(config)
        })

        it('loads the script if window config not set', () => {
            decide().call()

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

            decide().call()

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
            decide().call()

            if (shouldReload) {
                expect(posthog.featureFlags.reloadFeatureFlags).toHaveBeenCalled()
            } else {
                expect(posthog.featureFlags.reloadFeatureFlags).not.toHaveBeenCalled()
            }
        })
    })
})
