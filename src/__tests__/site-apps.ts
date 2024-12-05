import { mockLogger } from './helpers/mock-logger'

import { SiteApps } from '../site-apps'
import { PostHogPersistence } from '../posthog-persistence'
import { RequestRouter } from '../utils/request-router'
import { PostHog } from '../posthog-core'
import { DecideResponse, PostHogConfig, Properties, CaptureResult } from '../types'
import { assignableWindow } from '../utils/globals'
import '../entrypoints/external-scripts-loader'
import { isFunction } from '../utils/type-utils'

describe('SiteApps', () => {
    let posthog: PostHog
    let siteAppsInstance: SiteApps

    const defaultConfig: Partial<PostHogConfig> = {
        token: 'testtoken',
        api_host: 'https://test.com',
        persistence: 'memory',
    }

    beforeEach(() => {
        // Clean the JSDOM to prevent interdependencies between tests
        document.body.innerHTML = ''
        document.head.innerHTML = ''
        jest.spyOn(window.console, 'error').mockImplementation()

        // Reset assignableWindow properties
        assignableWindow.__PosthogExtensions__ = {
            loadSiteApp: jest.fn().mockImplementation((_instance, _url, callback) => {
                // Simulate async loading
                setTimeout(() => {
                    const id = _url.split('/').pop()
                    if (isFunction(assignableWindow[`__$$ph_site_app_${id}_callback`])) {
                        assignableWindow[`__$$ph_site_app_${id}_callback`]()
                    }
                    callback()
                }, 0)
            }),
        }

        posthog = {
            config: { ...defaultConfig },
            persistence: new PostHogPersistence(defaultConfig as PostHogConfig),
            register: (props: Properties) => posthog.persistence!.register(props),
            unregister: (key: string) => posthog.persistence!.unregister(key),
            get_property: (key: string) => posthog.persistence!.props[key],
            capture: jest.fn(),
            _addCaptureHook: jest.fn(),
            _afterDecideResponse: jest.fn(),
            get_distinct_id: jest.fn().mockImplementation(() => 'distinctid'),
            _send_request: jest.fn().mockImplementation(({ callback }) => callback?.({ config: {} })),
            featureFlags: {
                receivedFeatureFlags: jest.fn(),
                setReloadingPaused: jest.fn(),
                _startReloadTimer: jest.fn(),
            },
            requestRouter: new RequestRouter({ config: defaultConfig } as unknown as PostHog),
            _hasBootstrappedFeatureFlags: jest.fn(),
            getGroups: () => ({ organization: '5' }),
        } as unknown as PostHog

        siteAppsInstance = new SiteApps(posthog)
    })

    afterEach(() => {
        jest.clearAllMocks()
    })

    describe('constructor', () => {
        it('sets enabled to true when opt_in_site_apps is true and advanced_disable_decide is false', () => {
            posthog.config = {
                ...defaultConfig,
                opt_in_site_apps: true,
                advanced_disable_decide: false,
            } as PostHogConfig

            siteAppsInstance = new SiteApps(posthog)

            expect(siteAppsInstance.enabled).toBe(true)
        })

        it('sets enabled to false when opt_in_site_apps is false', () => {
            posthog.config = {
                ...defaultConfig,
                opt_in_site_apps: false,
                advanced_disable_decide: false,
            } as PostHogConfig

            siteAppsInstance = new SiteApps(posthog)

            expect(siteAppsInstance.enabled).toBe(false)
        })

        it('sets enabled to false when advanced_disable_decide is true', () => {
            posthog.config = {
                ...defaultConfig,
                opt_in_site_apps: true,
                advanced_disable_decide: true,
            } as PostHogConfig

            siteAppsInstance = new SiteApps(posthog)

            expect(siteAppsInstance.enabled).toBe(false)
        })

        it('initializes missedInvocations, loaded, appsLoading correctly', () => {
            expect(siteAppsInstance.missedInvocations).toEqual([])
            expect(siteAppsInstance.loaded).toBe(false)
            expect(siteAppsInstance.appsLoading).toEqual(new Set())
        })
    })

    describe('init', () => {
        it('adds eventCollector as a capture hook', () => {
            siteAppsInstance.init()

            expect(posthog._addCaptureHook).toHaveBeenCalledWith(expect.any(Function))
        })
    })

    describe('eventCollector', () => {
        it('does nothing if enabled is false', () => {
            siteAppsInstance.enabled = false
            siteAppsInstance.eventCollector('event_name', {} as CaptureResult)

            expect(siteAppsInstance.missedInvocations.length).toBe(0)
        })

        it('collects event if enabled and loaded is false', () => {
            siteAppsInstance.enabled = true
            siteAppsInstance.loaded = false

            const eventPayload = { event: 'test_event', properties: { prop1: 'value1' } } as CaptureResult

            jest.spyOn(siteAppsInstance, 'globalsForEvent').mockReturnValue({ some: 'globals' })

            siteAppsInstance.eventCollector('test_event', eventPayload)

            expect(siteAppsInstance.globalsForEvent).toHaveBeenCalledWith(eventPayload)
            expect(siteAppsInstance.missedInvocations).toEqual([{ some: 'globals' }])
        })

        it('trims missedInvocations to last 990 when exceeding 1000', () => {
            siteAppsInstance.enabled = true
            siteAppsInstance.loaded = false

            siteAppsInstance.missedInvocations = new Array(1000).fill({})

            const eventPayload = { event: 'test_event', properties: { prop1: 'value1' } } as CaptureResult

            jest.spyOn(siteAppsInstance, 'globalsForEvent').mockReturnValue({ some: 'globals' })

            siteAppsInstance.eventCollector('test_event', eventPayload)

            expect(siteAppsInstance.missedInvocations.length).toBe(991)
            expect(siteAppsInstance.missedInvocations[0]).toEqual({})
            expect(siteAppsInstance.missedInvocations[990]).toEqual({ some: 'globals' })
        })
    })

    describe('globalsForEvent', () => {
        it('throws an error if event is undefined', () => {
            expect(() => siteAppsInstance.globalsForEvent(undefined as any)).toThrow('Event payload is required')
        })

        it('constructs globals object correctly', () => {
            jest.spyOn(posthog, 'get_property').mockImplementation((key) => {
                if (key === '$groups') {
                    return { groupType: 'groupId' }
                } else if (key === '$stored_group_properties') {
                    return { groupType: { prop1: 'value1' } }
                } else if (key === '$stored_person_properties') {
                    return { personProp: 'personValue' }
                }
            })

            const eventPayload = {
                uuid: 'test_uuid',
                event: 'test_event',
                properties: {
                    prop1: 'value1',
                    distinct_id: 'test_distinct_id',
                    $elements_chain: 'elements_chain_value',
                },
                $set: { setProp: 'setValue' },
                $set_once: { setOnceProp: 'setOnceValue' },
            } as CaptureResult

            const globals = siteAppsInstance.globalsForEvent(eventPayload)

            expect(globals).toEqual({
                event: {
                    uuid: 'test_uuid',
                    event: 'test_event',
                    properties: {
                        $elements_chain: 'elements_chain_value',
                        prop1: 'value1',
                        distinct_id: 'test_distinct_id',
                        $set: { setProp: 'setValue' },
                        $set_once: { setOnceProp: 'setOnceValue' },
                    },
                    elements_chain: 'elements_chain_value',
                    distinct_id: 'test_distinct_id',
                },
                person: {
                    properties: { personProp: 'personValue' },
                },
                groups: {
                    groupType: {
                        id: 'groupId',
                        type: 'groupType',
                        properties: { prop1: 'value1' },
                    },
                },
            })
        })
    })

    describe('afterDecideResponse', () => {
        it('sets loaded to true and enabled to false when response is undefined', () => {
            siteAppsInstance.onRemoteConfig(undefined)

            expect(siteAppsInstance.loaded).toBe(true)
            expect(siteAppsInstance.enabled).toBe(false)
        })

        it('loads site apps when enabled and opt_in_site_apps is true', (done) => {
            posthog.config.opt_in_site_apps = true
            siteAppsInstance.enabled = true
            const response = {
                siteApps: [
                    { id: '1', url: '/site_app/1' },
                    { id: '2', url: '/site_app/2' },
                ],
            } as DecideResponse

            siteAppsInstance.onRemoteConfig(response)

            expect(siteAppsInstance.appsLoading.size).toBe(2)
            expect(siteAppsInstance.loaded).toBe(false)

            // Wait for the simulated async loading to complete
            setTimeout(() => {
                expect(assignableWindow.__PosthogExtensions__?.loadSiteApp).toHaveBeenCalledTimes(2)
                expect(siteAppsInstance.appsLoading.size).toBe(0)
                expect(siteAppsInstance.loaded).toBe(true)
                done()
            }, 10)
        })

        it('does not load site apps when enabled is false', () => {
            siteAppsInstance.enabled = false
            posthog.config.opt_in_site_apps = false
            const response = {
                siteApps: [{ id: '1', url: '/site_app/1' }],
            } as DecideResponse

            siteAppsInstance.onRemoteConfig(response)

            expect(siteAppsInstance.loaded).toBe(true)
            expect(siteAppsInstance.enabled).toBe(false)
            expect(assignableWindow.__PosthogExtensions__?.loadSiteApp).not.toHaveBeenCalled()
        })

        it('clears missedInvocations when all apps are loaded', (done) => {
            posthog.config.opt_in_site_apps = true
            siteAppsInstance.enabled = true
            siteAppsInstance.missedInvocations = [{ some: 'data' }]
            const response = {
                siteApps: [{ id: '1', url: '/site_app/1' }],
            } as DecideResponse

            siteAppsInstance.onRemoteConfig(response)

            // Wait for the simulated async loading to complete
            setTimeout(() => {
                expect(siteAppsInstance.loaded).toBe(true)
                expect(siteAppsInstance.missedInvocations).toEqual([])
                done()
            }, 10)
        })

        it('sets assignableWindow properties for each site app', () => {
            posthog.config.opt_in_site_apps = true
            siteAppsInstance.enabled = true
            const response = {
                siteApps: [{ id: '1', url: '/site_app/1' }],
            } as DecideResponse

            siteAppsInstance.onRemoteConfig(response)

            expect(assignableWindow['__$$ph_site_app_1']).toBe(posthog)
            expect(typeof assignableWindow['__$$ph_site_app_1_missed_invocations']).toBe('function')
            expect(typeof assignableWindow['__$$ph_site_app_1_callback']).toBe('function')
            expect(assignableWindow.__PosthogExtensions__?.loadSiteApp).toHaveBeenCalledWith(
                posthog,
                '/site_app/1',
                expect.any(Function)
            )
        })

        it('logs error if site apps are disabled but response contains site apps', () => {
            posthog.config.opt_in_site_apps = false
            siteAppsInstance.enabled = false
            const response = {
                siteApps: [{ id: '1', url: '/site_app/1' }],
            } as DecideResponse

            siteAppsInstance.onRemoteConfig(response)

            expect(mockLogger.error).toHaveBeenCalledWith(
                'Site apps exist but "opt_in_site_apps" is not set so they are not loaded.'
            )
            expect(siteAppsInstance.loaded).toBe(true)
        })

        it('sets loaded to true if response.siteApps is empty', () => {
            siteAppsInstance.enabled = true
            posthog.config.opt_in_site_apps = true
            const response = {
                siteApps: [],
            } as DecideResponse

            siteAppsInstance.onRemoteConfig(response)

            expect(siteAppsInstance.loaded).toBe(true)
            expect(siteAppsInstance.enabled).toBe(false)
        })
    })
})
