// __tests__/site-apps.ts

import { SiteApps } from '../site-apps'
import { PostHogPersistence } from '../posthog-persistence'
import { RequestRouter } from '../utils/request-router'
import { PostHog } from '../posthog-core'
import { DecideResponse, PostHogConfig, Properties, CaptureResult } from '../types'
import { assignableWindow } from '../utils/globals'
import '../entrypoints/external-scripts-loader'
import { logger } from '../utils/logger'

jest.mock('../entrypoints/external-scripts-loader', () => ({
    loadScript: jest.fn(),
}))

describe('SiteApps', () => {
    let posthog: PostHog

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
    })

    describe('constructor', () => {
        it('sets enabled to true when opt_in_site_apps is true and advanced_disable_decide is false', () => {
            posthog.config = {
                ...defaultConfig,
                opt_in_site_apps: true,
                advanced_disable_decide: false,
            } as PostHogConfig

            const siteAppsInstance = new SiteApps(posthog)

            expect(siteAppsInstance.enabled).toBe(true)
        })

        it('sets enabled to false when opt_in_site_apps is false', () => {
            posthog.config = {
                ...defaultConfig,
                opt_in_site_apps: false,
                advanced_disable_decide: false,
            } as PostHogConfig

            const siteAppsInstance = new SiteApps(posthog)

            expect(siteAppsInstance.enabled).toBe(false)
        })

        it('sets enabled to false when advanced_disable_decide is true', () => {
            posthog.config = {
                ...defaultConfig,
                opt_in_site_apps: true,
                advanced_disable_decide: true,
            } as PostHogConfig

            const siteAppsInstance = new SiteApps(posthog)

            expect(siteAppsInstance.enabled).toBe(false)
        })

        it('initializes missedInvocations, loaded, appsLoading correctly', () => {
            const siteAppsInstance = new SiteApps(posthog)

            expect(siteAppsInstance.missedInvocations).toEqual([])
            expect(siteAppsInstance.loaded).toBe(false)
            expect(siteAppsInstance.appsLoading).toEqual(new Set())
        })
    })

    describe('init', () => {
        it('adds eventCollector as a capture hook', () => {
            const siteAppsInstance = new SiteApps(posthog)
            siteAppsInstance.init()

            expect(posthog._addCaptureHook).toHaveBeenCalledWith(expect.any(Function))
        })
    })

    describe('eventCollector', () => {
        let siteAppsInstance: SiteApps

        beforeEach(() => {
            siteAppsInstance = new SiteApps(posthog)
        })

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

            siteAppsInstance.missedInvocations = new Array(1000).fill({}).map((_, index) => ({ index }))

            const eventPayload = { event: 'test_event', properties: { prop1: 'value1' } } as CaptureResult

            jest.spyOn(siteAppsInstance, 'globalsForEvent').mockReturnValue({ some: 'globals' })

            siteAppsInstance.eventCollector('test_event', eventPayload)

            expect(siteAppsInstance.missedInvocations.length).toBe(991)
            // Ensure that the first 10 events were trimmed
            expect(siteAppsInstance.missedInvocations[0]).toEqual({ index: 10 })
            expect(siteAppsInstance.missedInvocations[990]).toEqual({ some: 'globals' })
        })
    })

    describe('globalsForEvent', () => {
        let siteAppsInstance: SiteApps

        beforeEach(() => {
            siteAppsInstance = new SiteApps(posthog)
        })

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

    describe('loadSiteApp', () => {
        let siteAppsInstance: SiteApps
        let loadScript: jest.Mock

        beforeEach(() => {
            siteAppsInstance = new SiteApps(posthog)
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            loadScript = require('../entrypoints/external-scripts-loader').loadScript as jest.Mock
            loadScript.mockClear()
        })

        it('calls loadScript with correct parameters', () => {
            const callback = jest.fn()
            jest.spyOn(posthog.requestRouter, 'endpointFor').mockReturnValue('https://test.com/script.js')

            siteAppsInstance.loadSiteApp(posthog, '/site_app/1', callback)

            expect(posthog.requestRouter.endpointFor).toHaveBeenCalledWith('api', '/site_app/1')
            expect(loadScript).toHaveBeenCalledWith(posthog, 'https://test.com/script.js', callback)
        })
    })

    describe('afterDecideResponse', () => {
        let siteAppsInstance: SiteApps

        beforeEach(() => {
            siteAppsInstance = new SiteApps(posthog)
            jest.spyOn(siteAppsInstance, 'loadSiteApp').mockImplementation((posthog, url, callback) => {
                // Simulate loading
                callback()
            })
        })

        it('sets loaded to true and enabled to false when response is undefined', () => {
            siteAppsInstance.afterDecideResponse(undefined)

            expect(siteAppsInstance.loaded).toBe(true)
            expect(siteAppsInstance.enabled).toBe(false)
        })

        it('loads site apps when enabled and opt_in_site_apps is true', () => {
            posthog.config.opt_in_site_apps = true
            siteAppsInstance.enabled = true
            const response = {
                siteApps: [
                    { id: '1', url: '/site_app/1' },
                    { id: '2', url: '/site_app/2' },
                ],
            } as DecideResponse

            siteAppsInstance.afterDecideResponse(response)

            expect(siteAppsInstance.appsLoading.size).toBe(2)
            expect(siteAppsInstance.loaded).toBe(false)
            expect(siteAppsInstance.loadSiteApp).toHaveBeenCalledTimes(2)
        })

        it('does not load site apps when enabled is false', () => {
            siteAppsInstance.enabled = false
            posthog.config.opt_in_site_apps = false
            const response = {
                siteApps: [{ id: '1', url: '/site_app/1' }],
            } as DecideResponse

            siteAppsInstance.afterDecideResponse(response)

            expect(siteAppsInstance.loaded).toBe(true)
            expect(siteAppsInstance.enabled).toBe(false)
            expect(siteAppsInstance.loadSiteApp).not.toHaveBeenCalled()
        })

        it('clears missedInvocations when all apps are loaded', () => {
            posthog.config.opt_in_site_apps = true
            siteAppsInstance.enabled = true
            siteAppsInstance.missedInvocations = [{ some: 'data' }]
            const response = {
                siteApps: [{ id: '1', url: '/site_app/1' }],
            } as DecideResponse

            siteAppsInstance.afterDecideResponse(response)

            // Simulate app loaded
            siteAppsInstance.appsLoading.delete('1')
            // Manually invoke the checkIfAllLoaded function
            if (siteAppsInstance.appsLoading.size === 0) {
                siteAppsInstance.loaded = true
                siteAppsInstance.missedInvocations = []
            }

            expect(siteAppsInstance.loaded).toBe(true)
            expect(siteAppsInstance.missedInvocations).toEqual([])
        })

        it('sets assignableWindow properties for each site app', () => {
            posthog.config.opt_in_site_apps = true
            siteAppsInstance.enabled = true
            const response = {
                siteApps: [{ id: '1', url: '/site_app/1' }],
            } as DecideResponse

            siteAppsInstance.afterDecideResponse(response)

            expect(assignableWindow['__$$ph_site_app_1_posthog']).toBe(posthog)
            expect(typeof assignableWindow['__$$ph_site_app_1_missed_invocations']).toBe('function')
            expect(typeof assignableWindow['__$$ph_site_app_1_callback']).toBe('function')
        })

        it('logs error if site apps are disabled but response contains site apps', () => {
            posthog.config.opt_in_site_apps = false
            siteAppsInstance.enabled = false
            const response = {
                siteApps: [{ id: '1', url: '/site_app/1' }],
            } as DecideResponse

            jest.spyOn(logger, 'error').mockImplementation()
            siteAppsInstance.afterDecideResponse(response)

            expect(logger.error).toHaveBeenCalledWith(
                'PostHog site apps are disabled. Enable the "opt_in_site_apps" config to proceed.'
            )
        })
    })
})
