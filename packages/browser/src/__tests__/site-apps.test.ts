import { mockLogger } from './helpers/mock-logger'

import { SiteApps } from '../site-apps'
import { PostHogPersistence } from '../posthog-persistence'
import { RequestRouter } from '../utils/request-router'
import { PostHog } from '../posthog-core'
import { PostHogConfig, Properties, CaptureResult, RemoteConfig } from '../types'
import { assignableWindow } from '@posthog/browser-common/utils/globals'
import '../entrypoints/external-scripts-loader'
import { isFunction } from '@posthog/core'
import { createMockPostHog } from './helpers/posthog-instance'

describe('SiteApps', () => {
    let posthog: PostHog
    let siteAppsInstance: SiteApps
    let emitCaptureEvent: ((eventName: string, eventPayload: CaptureResult) => void) | undefined
    let removeCaptureHook = jest.fn()

    const token = 'testtoken'

    const defaultConfig: Partial<PostHogConfig> = {
        token: token,
        api_host: 'https://test.com',
        persistence: 'memory',
    }

    beforeEach(() => {
        // Clean the JSDOM to prevent interdependencies between tests
        document.body.innerHTML = ''
        document.head.innerHTML = ''

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

        delete assignableWindow._POSTHOG_REMOTE_CONFIG
        delete assignableWindow.POSTHOG_DEBUG

        removeCaptureHook = jest.fn()

        posthog = createMockPostHog({
            config: { ...defaultConfig, opt_in_site_apps: true },
            persistence: new PostHogPersistence(defaultConfig as PostHogConfig),
            register: (props: Properties) => posthog.persistence!.register(props),
            unregister: (key: string) => posthog.persistence!.unregister(key),
            get_property: (key: string) => posthog.persistence!.props[key],
            capture: jest.fn(),
            _addCaptureHook: jest.fn((cb) => {
                emitCaptureEvent = cb
                return removeCaptureHook
            }),
            _afterFlagsResponse: jest.fn(),
            get_distinct_id: jest.fn().mockImplementation(() => 'distinctid'),
            _send_request: jest.fn().mockImplementation(({ callback }) => callback?.({ config: {} })),
            featureFlags: {
                receivedFeatureFlags: jest.fn(),
                setReloadingPaused: jest.fn(),
                _startReloadTimer: jest.fn(),
            },
            requestRouter: new RequestRouter(createMockPostHog({ config: defaultConfig })),
            _hasBootstrappedFeatureFlags: jest.fn(),
            getGroups: () => ({ organization: '5' }),
            on: jest.fn(),
        })

        siteAppsInstance = new SiteApps(posthog)
    })

    afterEach(() => {
        jest.clearAllMocks()
    })

    describe('constructor', () => {
        it('sets enabled to true when opt_in_site_apps is true', () => {
            posthog.config = {
                ...defaultConfig,
                opt_in_site_apps: true,
            } as PostHogConfig

            expect(siteAppsInstance.isEnabled).toBe(true)
        })

        it('sets enabled to false when opt_in_site_apps is false', () => {
            posthog.config = {
                ...defaultConfig,
                opt_in_site_apps: false,
            } as PostHogConfig

            siteAppsInstance = new SiteApps(posthog)

            expect(siteAppsInstance.isEnabled).toBe(false)
        })

        it('initializes missedInvocations, loaded, appsLoading correctly', () => {
            expect(siteAppsInstance['_bufferedInvocations']).toEqual([])
            expect(siteAppsInstance.apps).toEqual({})
        })
    })

    describe('init', () => {
        it('adds eventCollector as a capture hook', () => {
            expect(siteAppsInstance['_stopBuffering']).toBeUndefined()
            siteAppsInstance.initialize()

            expect(posthog._addCaptureHook).toHaveBeenCalledWith(expect.any(Function))
            expect(siteAppsInstance['_stopBuffering']).toEqual(expect.any(Function))
        })

        it('does not add eventCollector as a capture hook if disabled', () => {
            posthog.config.opt_in_site_apps = false
            siteAppsInstance.initialize()

            expect(posthog._addCaptureHook).not.toHaveBeenCalled()
            expect(siteAppsInstance['_stopBuffering']).toBeUndefined()
        })
    })

    describe('eventCollector', () => {
        beforeEach(() => {
            siteAppsInstance.initialize()
        })

        it('collects events if enabled after init', () => {
            emitCaptureEvent?.('test_event', { event: 'test_event', properties: { prop1: 'value1' } } as any)

            expect(siteAppsInstance['_bufferedInvocations']).toMatchInlineSnapshot(`
[
  {
    "event": {
      "distinct_id": undefined,
      "elements_chain": "",
      "event": "test_event",
      "properties": {
        "prop1": "value1",
      },
    },
    "groups": {},
    "person": {
      "properties": undefined,
    },
  },
]
`)
        })

        it('trims missedInvocations to last 990 when exceeding 1000', () => {
            siteAppsInstance['_bufferedInvocations'] = new Array(1000).fill({})

            emitCaptureEvent?.('test_event', { event: 'test_event', properties: { prop1: 'value1' } } as any)

            expect(siteAppsInstance['_bufferedInvocations'].length).toBe(991)
            expect(siteAppsInstance['_bufferedInvocations'][0]).toEqual({})
            expect(siteAppsInstance['_bufferedInvocations'][990]).toMatchObject({ event: { event: 'test_event' } })
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

    describe('legacy site apps loading', () => {
        beforeEach(() => {
            posthog.config.opt_in_site_apps = true
            siteAppsInstance.initialize()
        })

        it('loads stops buffering if no site apps', () => {
            posthog.config.opt_in_site_apps = true
            siteAppsInstance.onRemoteConfig({ ok: true, config: {} as RemoteConfig })

            expect(removeCaptureHook).toHaveBeenCalled()
            expect(siteAppsInstance['_stopBuffering']).toBeUndefined()
            expect(assignableWindow.__PosthogExtensions__?.loadSiteApp).not.toHaveBeenCalled()
        })

        it('does not loads site apps if disabled', () => {
            posthog.config.opt_in_site_apps = false
            siteAppsInstance.onRemoteConfig({
                ok: true,
                config: {
                    siteApps: [
                        { id: '1', url: '/site_app/1' },
                        { id: '2', url: '/site_app/2' },
                    ],
                } as RemoteConfig,
            })

            expect(removeCaptureHook).toHaveBeenCalled()
            expect(siteAppsInstance['_stopBuffering']).toBeUndefined()
            expect(assignableWindow.__PosthogExtensions__?.loadSiteApp).not.toHaveBeenCalled()
        })

        it('does not load site apps if new global loader exists', () => {
            assignableWindow._POSTHOG_REMOTE_CONFIG = {
                [token]: {
                    config: {},
                    siteApps: [
                        {
                            id: '1',
                            init: jest.fn(() => {
                                return {
                                    processEvent: jest.fn(),
                                }
                            }),
                        },
                    ],
                },
            } as any
            siteAppsInstance.onRemoteConfig({
                ok: true,
                config: {
                    siteApps: [{ id: '1', url: '/site_app/1' }],
                } as RemoteConfig,
            })

            expect(assignableWindow.__PosthogExtensions__?.loadSiteApp).not.toHaveBeenCalled()
        })

        it('loads site apps if new global loader is not available', () => {
            siteAppsInstance.onRemoteConfig({
                ok: true,
                config: {
                    siteApps: [
                        { id: '1', url: '/site_app/1' },
                        { id: '2', url: '/site_app/2' },
                    ],
                } as RemoteConfig,
            })

            expect(removeCaptureHook).toHaveBeenCalled()
            expect(siteAppsInstance['_stopBuffering']).toBeUndefined()
            expect(assignableWindow.__PosthogExtensions__?.loadSiteApp).toHaveBeenCalledTimes(2)
            expect(assignableWindow.__PosthogExtensions__?.loadSiteApp).toHaveBeenCalledWith(
                posthog,
                '/site_app/1',
                expect.any(Function)
            )
            expect(assignableWindow.__PosthogExtensions__?.loadSiteApp).toHaveBeenCalledWith(
                posthog,
                '/site_app/2',
                expect.any(Function)
            )
        })
    })

    describe('onRemoteConfig', () => {
        interface AppConfig {
            posthog: PostHog
            callback: (success: boolean) => void
        }
        let appConfigs: (AppConfig & { processEvent: jest.Mock })[] = []
        const init = (onInit?: (appConfig: AppConfig) => void) => {
            assignableWindow._POSTHOG_REMOTE_CONFIG = {
                [token]: {
                    config: {},
                    siteApps: [
                        {
                            id: '1',
                            init: jest.fn((config: AppConfig) => {
                                const processEvent = jest.fn()
                                appConfigs.push({ ...config, processEvent })
                                onInit?.(config)
                                return {
                                    processEvent,
                                }
                            }),
                        },
                        {
                            id: '2',
                            init: jest.fn((config: AppConfig) => {
                                const processEvent = jest.fn()
                                appConfigs.push({ ...config, processEvent })
                                onInit?.(config)
                                return {
                                    processEvent,
                                }
                            }),
                        },
                    ],
                },
            } as any

            siteAppsInstance.initialize()
        }

        beforeEach(() => {
            appConfigs = []
        })

        it('sets up the eventCaptured listener if site apps', () => {
            init()
            siteAppsInstance.onRemoteConfig({ ok: true, config: {} as RemoteConfig })
            expect(posthog.on).toHaveBeenCalledWith('eventCaptured', expect.any(Function))
        })

        it('does not sets up the eventCaptured listener if no site apps', () => {
            init()
            assignableWindow._POSTHOG_REMOTE_CONFIG = {
                [token]: {
                    config: {},
                    siteApps: [],
                },
            } as any
            siteAppsInstance.onRemoteConfig({ ok: true, config: {} as RemoteConfig })
            expect(posthog.on).not.toHaveBeenCalled()
        })

        it('loads site apps via the window object if defined', () => {
            init()
            siteAppsInstance.onRemoteConfig({ ok: true, config: {} as RemoteConfig })
            expect(appConfigs[0]).toBeDefined()
            expect(siteAppsInstance.apps['1']).toEqual({
                errored: false,
                loaded: false,
                processedBuffer: false,
                id: '1',
                processEvent: expect.any(Function),
            })

            appConfigs[0].callback(true)

            expect(siteAppsInstance.apps['1']).toEqual({
                errored: false,
                loaded: true,
                processedBuffer: false,
                id: '1',
                processEvent: expect.any(Function),
            })
        })

        it('prepares style elements appended during site app init', () => {
            posthog.config.prepare_external_dependency_stylesheet = jest.fn((stylesheet) => {
                stylesheet.nonce = 'style-nonce'
                return stylesheet
            })
            init(({ callback }) => {
                const host = document.createElement('div')
                const shadow = host.attachShadow({ mode: 'open' })
                const styleElement = Object.assign(document.createElement('style'), {
                    innerText: '.foo { color: red; }',
                })
                shadow.append(styleElement)
                document.body.appendChild(host)
                callback(true)
            })

            siteAppsInstance.onRemoteConfig({ ok: true, config: {} as RemoteConfig })

            const styleElement = document.body.querySelector('div')?.shadowRoot?.querySelector('style')
            expect(posthog.config.prepare_external_dependency_stylesheet).toHaveBeenCalledWith(styleElement)
            expect(styleElement?.nonce).toBe('style-nonce')
        })

        it('prepares style elements inserted with related DOM APIs', () => {
            const insertedStyles: HTMLStyleElement[] = []
            const stylesInsertedPerAppInit = 6
            posthog.config.prepare_external_dependency_stylesheet = jest.fn((stylesheet) => {
                stylesheet.nonce = 'style-nonce'
                return stylesheet
            })
            init(({ callback }) => {
                const host = document.createElement('div')
                document.body.appendChild(host)

                const prependedStyle = document.createElement('style')
                host.prepend(prependedStyle)

                const replacementStyle = document.createElement('style')
                const replacedStyle = document.createElement('style')
                host.replaceChild(replacementStyle, prependedStyle)
                replacementStyle.replaceWith(replacedStyle)

                const beforeStyle = document.createElement('style')
                const afterStyle = document.createElement('style')
                const adjacentStyle = document.createElement('style')
                host.before(beforeStyle)
                host.after(afterStyle)
                host.insertAdjacentElement('afterbegin', adjacentStyle)

                insertedStyles.push(
                    prependedStyle,
                    replacementStyle,
                    replacedStyle,
                    beforeStyle,
                    afterStyle,
                    adjacentStyle
                )
                callback(true)
            })

            siteAppsInstance.onRemoteConfig({ ok: true, config: {} as RemoteConfig })

            const expectedStyleCount = stylesInsertedPerAppInit * appConfigs.length
            const expectedAttachedStyleCount = 4 * appConfigs.length
            expect(insertedStyles).toHaveLength(expectedStyleCount)
            expect(insertedStyles.every((styleElement) => styleElement.nonce === 'style-nonce')).toBe(true)
            expect(document.body.querySelectorAll('style[nonce="style-nonce"]')).toHaveLength(
                expectedAttachedStyleCount
            )
        })

        it('prepares style elements appended before async init callbacks complete', () => {
            const finishInit: (() => HTMLStyleElement)[] = []
            posthog.config.prepare_external_dependency_stylesheet = jest.fn((stylesheet) => {
                stylesheet.nonce = 'style-nonce'
                return stylesheet
            })
            init(({ callback }) => {
                finishInit.push(() => {
                    const styleElement = document.createElement('style')
                    document.body.append(styleElement)
                    callback(true)
                    return styleElement
                })
            })

            siteAppsInstance.onRemoteConfig({ ok: true, config: {} as RemoteConfig })

            const secondAppStyle = finishInit[1]()
            const stillPendingStyle = document.createElement('style')
            document.body.append(stillPendingStyle)
            const firstAppStyle = finishInit[0]()
            const afterCallbacksStyle = document.createElement('style')
            document.body.append(afterCallbacksStyle)

            expect(secondAppStyle.nonce).toBe('style-nonce')
            expect(stillPendingStyle.nonce).toBe('style-nonce')
            expect(firstAppStyle.nonce).toBe('style-nonce')
            expect(afterCallbacksStyle.nonce).toBe('')
        })

        it('does not replace DOM insertion methods when no prepare hooks are configured', () => {
            const win = document.defaultView as Window & typeof globalThis
            const originalMethods = [
                ['Node.appendChild', win.Node.prototype.appendChild],
                ['Node.insertBefore', win.Node.prototype.insertBefore],
                ['Node.replaceChild', win.Node.prototype.replaceChild],
                ['Element.append', win.Element.prototype.append],
                ['Element.prepend', win.Element.prototype.prepend],
                ['Element.before', win.Element.prototype.before],
                ['Element.after', win.Element.prototype.after],
                ['Element.replaceWith', win.Element.prototype.replaceWith],
                ['Element.insertAdjacentElement', win.Element.prototype.insertAdjacentElement],
            ] as const
            const currentMethods = () =>
                [
                    ['Node.appendChild', win.Node.prototype.appendChild],
                    ['Node.insertBefore', win.Node.prototype.insertBefore],
                    ['Node.replaceChild', win.Node.prototype.replaceChild],
                    ['Element.append', win.Element.prototype.append],
                    ['Element.prepend', win.Element.prototype.prepend],
                    ['Element.before', win.Element.prototype.before],
                    ['Element.after', win.Element.prototype.after],
                    ['Element.replaceWith', win.Element.prototype.replaceWith],
                    ['Element.insertAdjacentElement', win.Element.prototype.insertAdjacentElement],
                ] as const
            const expectMethodsUnchanged = () => {
                currentMethods().forEach(([name, method], index) => {
                    expect([name, method]).toEqual(originalMethods[index])
                })
            }

            init(({ callback }) => {
                expectMethodsUnchanged()
                callback(true)
            })

            siteAppsInstance.onRemoteConfig({ ok: true, config: {} as RemoteConfig })
            expectMethodsUnchanged()
        })

        it('prepares script elements appended while processing site app events', () => {
            posthog.config.prepare_external_dependency_script = jest.fn((script) => {
                script.nonce = 'script-nonce'
                return script
            })
            init()
            siteAppsInstance.onRemoteConfig({ ok: true, config: {} as RemoteConfig })
            appConfigs[0].processEvent.mockImplementation(() => {
                const script = document.createElement('script')
                document.head.append(script)
            })

            const eventCaptured = (posthog.on as jest.Mock).mock.calls[0][1]
            eventCaptured({ event: 'test_event', properties: {} } as CaptureResult)

            const scriptElement = document.head.querySelector('script')
            expect(posthog.config.prepare_external_dependency_script).toHaveBeenCalledWith(scriptElement)
            expect(scriptElement?.nonce).toBe('script-nonce')
        })

        it('marks site app as errored if callback fails', () => {
            init()
            siteAppsInstance.onRemoteConfig({ ok: true, config: {} as RemoteConfig })
            expect(appConfigs[0]).toBeDefined()
            expect(siteAppsInstance.apps['1']).toMatchObject({
                errored: false,
                loaded: false,
                processedBuffer: false,
            })

            appConfigs[0].callback(false)

            expect(siteAppsInstance.apps['1']).toMatchObject({
                errored: true,
                loaded: true,
                processedBuffer: false,
            })
        })

        it('calls the processEvent method if it exists and events are buffered', () => {
            init()
            emitCaptureEvent?.('test_event1', { event: 'test_event1' } as any)
            siteAppsInstance.onRemoteConfig({ ok: true, config: {} as RemoteConfig })
            emitCaptureEvent?.('test_event2', { event: 'test_event2' } as any)
            expect(siteAppsInstance['_bufferedInvocations'].length).toBe(2)
            appConfigs[0].callback(true)

            expect(siteAppsInstance.apps['1'].processEvent).toHaveBeenCalledTimes(2)
            expect(siteAppsInstance.apps['1'].processEvent).toHaveBeenCalledWith(
                siteAppsInstance.globalsForEvent({ event: 'test_event1' } as any)
            )
            expect(siteAppsInstance.apps['1'].processEvent).toHaveBeenCalledWith(
                siteAppsInstance.globalsForEvent({ event: 'test_event2' } as any)
            )
        })

        it('clears the buffer after all apps are loaded, when succeeding async', () => {
            init()
            emitCaptureEvent?.('test_event1', { event: 'test_event1' } as any)
            emitCaptureEvent?.('test_event2', { event: 'test_event2' } as any)
            expect(siteAppsInstance['_bufferedInvocations'].length).toBe(2)

            siteAppsInstance.onRemoteConfig({ ok: true, config: {} as RemoteConfig })
            appConfigs[0].callback(true)
            expect(siteAppsInstance['_bufferedInvocations'].length).toBe(2)
            appConfigs[1].callback(true)
            expect(siteAppsInstance['_bufferedInvocations'].length).toBe(0)

            expect(siteAppsInstance.apps['1'].processEvent).toHaveBeenCalledTimes(2)
            expect(siteAppsInstance.apps['2'].processEvent).toHaveBeenCalledTimes(2)
        })

        it('clears the buffer after all apps are loaded, when succeeding sync', () => {
            init(({ callback }) => {
                callback(true)
            })
            emitCaptureEvent?.('test_event1', { event: 'test_event1' } as any)
            emitCaptureEvent?.('test_event2', { event: 'test_event2' } as any)
            expect(siteAppsInstance['_bufferedInvocations'].length).toBe(2)

            siteAppsInstance.onRemoteConfig({ ok: true, config: {} as RemoteConfig })
            expect(siteAppsInstance['_bufferedInvocations'].length).toBe(0)

            expect(siteAppsInstance.apps['1'].processEvent).toHaveBeenCalledTimes(2)
            expect(siteAppsInstance.apps['2'].processEvent).toHaveBeenCalledTimes(2)
        })

        it('logs error if site apps are disabled but response contains site apps', () => {
            init()
            posthog.config.opt_in_site_apps = false
            assignableWindow.POSTHOG_DEBUG = true

            siteAppsInstance.onRemoteConfig({ ok: true, config: {} as RemoteConfig })

            expect(mockLogger.error).toHaveBeenCalledWith(
                'PostHog site apps are disabled. Enable the "opt_in_site_apps" config to proceed.'
            )
            expect(siteAppsInstance.apps).toEqual({})
        })
    })
})
