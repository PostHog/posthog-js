import { CoreExtension as CoreExtensionToken } from '@posthog/browser-common'
import type { Client, CoreExtension, Extension, ExtensionToken, NewSessionInfo } from '@posthog/browser-common'

import { logger } from '@posthog/browser-common/utils/logger'
import { SimpleEventEmitter } from '@posthog/browser-common/utils/simple-event-emitter'

import { AUTOCAPTURE_DISABLED_SERVER_SIDE, DEVICE_ID, HEATMAPS_ENABLED_SERVER_SIDE } from '../../constants'
import { BrowserExtensionHost } from '../../extensions/browser-client'
import { request } from '../../request'
import { SessionIdManager } from '../../sessionid'
import type { PostHog } from '../../posthog-core'
import type { PostHogPersistence } from '../../posthog-persistence'
import type { CaptureOptions, Properties, QueuedRequestWithOptions, RemoteConfigResult } from '../../types'
import { createPosthogInstance } from '../helpers/posthog-instance'

interface MockPostHog extends PostHog {
    emitSession(
        sessionId: string,
        windowId: string,
        changeReason?: {
            noSessionId: boolean
            activityTimeout: boolean
            sessionPastMaximumLength: boolean
            crossTabAdoption?: boolean
        }
    ): void
    emitForcedIdleReset(): void
    emitEvent(event: string, properties?: Properties): void
}

function createMockPostHog(
    options: {
        remoteConfigResult?: RemoteConfigResult
        flagsDisabled?: boolean
        emitCurrentSession?: boolean
    } = {}
): MockPostHog {
    const props: Properties = {
        distinct_id: 'distinct-id',
        [DEVICE_ID]: 'anonymous-id',
        $groups: { organization: 'org-id' },
    }
    const eventHandlers = new Set<(event: { event: string; properties: Properties }) => void>()
    let forcedIdleResetHandler: (() => void) | undefined
    let sessionHandler:
        | ((
              sessionId: string,
              windowId: string,
              changeReason?: {
                  noSessionId: boolean
                  activityTimeout: boolean
                  sessionPastMaximumLength: boolean
                  crossTabAdoption?: boolean
              }
          ) => void)
        | undefined

    const persistence = {
        props,
        register: jest.fn((values: Properties) => Object.assign(props, values)),
        unregister: jest.fn((key: string) => delete props[key]),
    } as unknown as PostHogPersistence

    const instance = {
        config: { token: 'test-token', debug: false },
        persistence,
        _lastRemoteConfig: options.remoteConfigResult,
        _shouldDisableFlags: jest.fn(() => options.flagsDisabled ?? false),
        get_distinct_id: jest.fn(() => props.distinct_id as string),
        get_property: jest.fn((key: string) => props[key]),
        getGroups: jest.fn(() => props.$groups),
        sessionManager: {
            checkAndGetSessionAndWindowId: jest.fn(() => ({
                sessionId: 'session-id',
                windowId: 'window-id',
                sessionStartTimestamp: 123,
            })),
            on: jest.fn((_event: 'forcedIdleReset', handler: () => void) => {
                forcedIdleResetHandler = handler
                return () => {
                    forcedIdleResetHandler = undefined
                }
            }),
        },
        capture: jest.fn(),
        _registerExtensionEventProperties: jest.fn(() => jest.fn()),
        requestRouter: {
            endpointFor: jest.fn((target: string, path: string) => `https://${target}.example.com${path}`),
        },
        _send_request: jest.fn(),
        _internalEventEmitter: new SimpleEventEmitter(),
        on: jest.fn((_event: string, handler: (event: { event: string; properties: Properties }) => void) => {
            eventHandlers.add(handler)
            return () => eventHandlers.delete(handler)
        }),
        onSessionId: jest.fn((handler) => {
            sessionHandler = handler
            if (options.emitCurrentSession !== false) {
                handler('session-id', 'window-id')
            }
            return () => {
                sessionHandler = undefined
            }
        }),
        emitSession(sessionId, windowId, changeReason) {
            sessionHandler?.(sessionId, windowId, changeReason)
        },
        emitForcedIdleReset() {
            forcedIdleResetHandler?.()
        },
        emitEvent(event, properties = {}) {
            eventHandlers.forEach((handler) => handler({ event, properties }))
        },
    } as unknown as MockPostHog

    return instance
}

function testExtension(
    name: string,
    setup: (client: Client) => void | Promise<void>,
    dispose: () => void | Promise<void> = jest.fn(),
    provides?: readonly ExtensionToken<unknown>[]
): Extension {
    return { name, provides, setup, dispose }
}

describe('BrowserExtensionHost', () => {
    it('provides core analytics behavior as a registered CoreExtension', async () => {
        const instance = createMockPostHog()
        const host = new BrowserExtensionHost(instance)
        let client: Client | undefined
        host.add(testExtension('test', (value) => (client = value)))
        const core = client?.getExtension(CoreExtensionToken)

        expect(CoreExtensionToken).toBe('posthog.core')
        expect(core?.name).toBe('core')
        expect(core?.distinctId).toBe('distinct-id')
        expect(core?.anonymousId).toBe('anonymous-id')
        expect(core?.groups).toEqual({ organization: 'org-id' })
        expect(core?.session).toEqual({
            sessionId: 'session-id',
            windowId: 'window-id',
            sessionStartTimestamp: 123,
        })
        expect(instance.sessionManager?.checkAndGetSessionAndWindowId).toHaveBeenCalledWith(true)
        expect(client?.logger).toBeDefined()

        const timestamp = new Date('2026-01-01T00:00:00Z')
        await core?.capture(
            'test-event',
            { explicit: true },
            { timestamp, uuid: 'test-uuid', set: { plan: 'paid' }, setOnce: { source: 'test' } }
        )
        expect(instance.capture).toHaveBeenCalledWith('test-event', { explicit: true }, {
            timestamp,
            uuid: 'test-uuid',
            $set: { plan: 'paid' },
            $set_once: { source: 'test' },
        } satisfies CaptureOptions)

        await host.dispose()
    })

    it('falls back to the distinct id and an empty session in limited environments', async () => {
        const instance = createMockPostHog()
        instance.get_property = jest.fn(() => undefined)
        instance.sessionManager!.checkAndGetSessionAndWindowId = jest.fn(() => {
            throw new Error('cookieless')
        })
        const host = new BrowserExtensionHost(instance)
        let core: CoreExtension | undefined
        host.add(testExtension('test', (client) => (core = client.getExtension(CoreExtensionToken))))

        expect(core?.anonymousId).toBe('distinct-id')
        expect(core?.session).toEqual({ sessionId: '', windowId: '', sessionStartTimestamp: 0 })
        await host.dispose()
    })

    it('reads, writes, and removes persistence keys directly', async () => {
        const instance = createMockPostHog()
        const host = new BrowserExtensionHost(instance)
        let client: Client | undefined
        host.add(testExtension('test', (value) => (client = value)))

        const key = '$extension_state'
        instance.persistence!.props[key] = { prepopulated: true }
        expect(client?.kv.get(key)).toEqual({ prepopulated: true })

        expect(client?.kv.set(key, { enabled: true })).toBeUndefined()
        expect(instance.persistence?.register).toHaveBeenCalledWith({ [key]: { enabled: true } })
        expect(instance.persistence?.props[key]).toEqual({ enabled: true })

        client?.kv.set(key, null)
        client?.kv.set(key, undefined)
        expect(instance.persistence?.register).toHaveBeenNthCalledWith(2, { [key]: null })
        expect(instance.persistence?.register).toHaveBeenNthCalledWith(3, { [key]: undefined })
        expect(instance.persistence?.unregister).not.toHaveBeenCalled()

        instance.persistence!.props[key] = { externallyUpdated: true }
        expect(await client?.kv.get(key)).toEqual({ externallyUpdated: true })

        await client?.kv.remove(key)
        expect(instance.persistence?.unregister).toHaveBeenCalledWith(key)
        expect(instance.persistence?.props[key]).toBeUndefined()
        await host.dispose()
    })

    it('exposes current remote config, waits for the first outcome, and only publishes successes', async () => {
        const host = new BrowserExtensionHost(createMockPostHog())
        let core: CoreExtension | undefined
        host.add(testExtension('test', (client) => (core = client.getExtension(CoreExtensionToken))))
        const changes: unknown[] = []
        core?.onRemoteConfig((config) => changes.push(config))

        const pending = core?.getRemoteConfig()
        host.handleRemoteConfig({ ok: false })
        await expect(pending).resolves.toBeUndefined()
        expect(changes).toEqual([])
        await expect(core?.getRemoteConfig()).resolves.toBeUndefined()

        const successfulConfig = {
            supportedCompression: [],
            marker: 'current',
            nested: { approved: true },
        } as any
        host.handleRemoteConfig({ ok: true, config: successfulConfig })
        expect(changes).toEqual([expect.objectContaining({ marker: 'current' })])
        const snapshot = await core?.getRemoteConfig()
        ;(snapshot?.nested as { approved: boolean }).approved = false
        expect(successfulConfig.nested.approved).toBe(true)
        await expect(core?.getRemoteConfig()).resolves.toEqual(successfulConfig)
        await host.dispose()
    })

    it('gives each first-config waiter and listener an independent detached snapshot', async () => {
        const host = new BrowserExtensionHost(createMockPostHog())
        let core: CoreExtension | undefined
        await host.add(testExtension('test', (client) => (core = client.getExtension(CoreExtensionToken))))
        const firstWaiter = core!.getRemoteConfig()
        const secondWaiter = core!.getRemoteConfig()
        const secondListener = jest.fn()
        core?.onRemoteConfig((config) => {
            ;(config.nested as { approved: boolean }).approved = false
        })
        core?.onRemoteConfig(secondListener)
        const canonical = { nested: { approved: true } } as any

        host.handleRemoteConfig({ ok: true, config: canonical })
        const first = await firstWaiter
        ;(first?.nested as { approved: boolean }).approved = false
        await expect(secondWaiter).resolves.toEqual({ nested: { approved: true } })
        expect(secondListener).toHaveBeenCalledWith({ nested: { approved: true } })
        expect(canonical).toEqual({ nested: { approved: true } })
        await host.dispose()
    })

    it('resolves a pending first-config waiter with undefined when the host is disposed', async () => {
        const host = new BrowserExtensionHost(createMockPostHog())
        let core: CoreExtension | undefined
        await host.add(testExtension('test', (client) => (core = client.getExtension(CoreExtensionToken))))

        const pending = core!.getRemoteConfig()
        const disposal = host.dispose()

        await expect(pending).resolves.toBeUndefined()
        await disposal
    })

    it('uses a cached remote result and resolves immediately when remote config is disabled', async () => {
        const cachedHost = new BrowserExtensionHost(
            createMockPostHog({
                remoteConfigResult: {
                    ok: true,
                    config: { supportedCompression: [], cached: true } as any,
                },
            })
        )
        let cachedCore: CoreExtension | undefined
        cachedHost.add(testExtension('cached', (client) => (cachedCore = client.getExtension(CoreExtensionToken))))
        await expect(cachedCore?.getRemoteConfig()).resolves.toEqual(expect.objectContaining({ cached: true }))
        await cachedHost.dispose()

        const disabledHost = new BrowserExtensionHost(createMockPostHog({ flagsDisabled: true }))
        let disabledCore: CoreExtension | undefined
        disabledHost.add(
            testExtension('disabled', (client) => (disabledCore = client.getExtension(CoreExtensionToken)))
        )
        await expect(disabledCore?.getRemoteConfig()).resolves.toBeUndefined()
        await disabledHost.dispose()
    })

    it('adapts captured-event and new-session listeners and disposes subscriptions', async () => {
        const instance = createMockPostHog()
        const host = new BrowserExtensionHost(instance)
        let client: Client | undefined
        host.add(testExtension('test', (value) => (client = value)))
        const events: unknown[] = []
        const sessions: NewSessionInfo[] = []
        const core = client!.getExtension(CoreExtensionToken)!
        const eventSubscription = core.onEvent((event) => events.push(event))
        const sessionSubscription = core.onNewSession((session) => sessions.push(session))

        instance.emitEvent('captured', { answer: 42 })
        instance.emitSession('idle-session', 'idle-window', {
            noSessionId: false,
            activityTimeout: true,
            sessionPastMaximumLength: false,
        })
        instance.emitSession('window-only', 'new-window', {
            noSessionId: false,
            activityTimeout: false,
            sessionPastMaximumLength: false,
        })
        instance.emitSession('cross-tab-session', 'cross-tab-window', {
            noSessionId: false,
            activityTimeout: false,
            sessionPastMaximumLength: false,
            crossTabAdoption: true,
        })
        instance.emitSession('max-session', 'max-window', {
            noSessionId: false,
            activityTimeout: false,
            sessionPastMaximumLength: true,
        })
        expect(events).toEqual([{ event: 'captured', properties: { answer: 42 } }])
        expect(sessions.map(({ reason }) => reason)).toEqual(['idleTimeout', 'crossTabAdoption', 'maxLength'])

        eventSubscription.dispose()
        sessionSubscription.dispose()
        instance.emitEvent('ignored')
        instance.emitSession('ignored-session', 'ignored-window', {
            noSessionId: false,
            activityTimeout: true,
            sessionPastMaximumLength: false,
        })
        expect(events).toHaveLength(1)
        expect(sessions).toHaveLength(3)
        await host.dispose()
    })

    it('gives sibling event listeners independent nested array and Date snapshots', async () => {
        const instance = createMockPostHog()
        const host = new BrowserExtensionHost(instance)
        let core: CoreExtension | undefined
        await host.add(testExtension('test', (client) => (core = client.getExtension(CoreExtensionToken))))
        const capturedAt = new Date('2026-02-01T12:00:00Z')
        const source = {
            nested: {
                items: [{ approved: true }],
                capturedAt,
            },
        } as unknown as Properties
        const sibling = jest.fn()

        core?.onEvent(({ properties }) => {
            const nested = properties.nested as {
                items: Array<{ approved: boolean }>
                capturedAt: Date
            }
            nested.items[0].approved = false
            nested.items.push({ approved: false })
            nested.capturedAt.setUTCFullYear(2000)
        })
        core?.onEvent(sibling)

        instance.emitEvent('snapshot', source)

        expect(sibling).toHaveBeenCalledWith({
            event: 'snapshot',
            properties: {
                nested: {
                    items: [{ approved: true }],
                    capturedAt: new Date('2026-02-01T12:00:00Z'),
                },
            },
        })
        expect(source).toEqual({
            nested: {
                items: [{ approved: true }],
                capturedAt: new Date('2026-02-01T12:00:00Z'),
            },
        })
        expect((sibling.mock.calls[0][0].properties.nested as { capturedAt: Date }).capturedAt).not.toBe(capturedAt)
        await host.dispose()
    })

    it('isolates shared listener failures and continues sibling event, config, and session delivery', async () => {
        const instance = createMockPostHog({ emitCurrentSession: false })
        const host = new BrowserExtensionHost(instance)
        let core: CoreExtension | undefined
        await host.add(testExtension('test', (client) => (core = client.getExtension(CoreExtensionToken))))
        const error = jest.spyOn(host.logger, 'error').mockImplementation()
        const eventSibling = jest.fn()
        const configSibling = jest.fn()
        const sessionSibling = jest.fn()

        core?.onEvent(() => {
            throw new Error('event listener failed')
        })
        core?.onEvent(eventSibling)
        core?.onRemoteConfig(() => {
            throw new Error('config listener failed')
        })
        core?.onRemoteConfig(configSibling)
        core?.onNewSession(() => {
            throw new Error('session listener failed')
        })
        core?.onNewSession(sessionSibling)

        expect(() => instance.emitEvent('continues', { nested: { approved: true } })).not.toThrow()
        expect(() => host.handleRemoteConfig({ ok: true, config: { nested: { approved: true } } as any })).not.toThrow()
        expect(() =>
            instance.emitSession('session', 'window', {
                noSessionId: true,
                activityTimeout: false,
                sessionPastMaximumLength: false,
            })
        ).not.toThrow()

        expect(eventSibling).toHaveBeenCalledTimes(1)
        expect(configSibling).toHaveBeenCalledTimes(1)
        expect(sessionSibling).toHaveBeenCalledTimes(1)
        expect(error).toHaveBeenCalledTimes(3)
        await host.dispose()
    })

    it('maps initial and reset session creation when no current session exists', async () => {
        const instance = createMockPostHog({ emitCurrentSession: false })
        const host = new BrowserExtensionHost(instance)
        let client: Client | undefined
        host.add(testExtension('test', (value) => (client = value)))
        const reasons: string[] = []
        client?.getExtension(CoreExtensionToken)?.onNewSession(({ reason }) => reasons.push(reason))
        const noSessionReason = {
            noSessionId: true,
            activityTimeout: false,
            sessionPastMaximumLength: false,
        }

        instance.emitSession('initial', 'window', noSessionReason)
        instance.emitForcedIdleReset()
        host.markReset()
        instance.emitSession('reset', 'window', noSessionReason)
        instance.emitSession('next', 'window', noSessionReason)
        expect(reasons).toEqual(['initial', 'reset', 'initial'])
        await host.dispose()
    })

    it('delegates dynamic properties and returns an idempotent disposable', async () => {
        const instance = createMockPostHog()
        const remove = jest.fn()
        instance._registerExtensionEventProperties = jest.fn(() => remove)
        const host = new BrowserExtensionHost(instance)
        let client: Client | undefined
        host.add(testExtension('test', (value) => (client = value)))
        const producer = () => ({ dynamic: true })

        const registration = client!.getExtension(CoreExtensionToken)!.registerDynamicEventProperties(producer)
        expect(instance._registerExtensionEventProperties).toHaveBeenCalledWith(producer)
        registration.dispose()
        registration.dispose()
        expect(remove).toHaveBeenCalledTimes(1)
        await host.dispose()
    })

    it('adapts API requests, dropped requests, flags routing, query/auth, and unload sends', async () => {
        const instance = createMockPostHog()
        const send = instance._send_request as jest.MockedFunction<(options: QueuedRequestWithOptions) => void>
        send.mockImplementation((options) =>
            options.callback?.({ statusCode: 201, json: { created: true }, text: '{"created":true}' })
        )
        const host = new BrowserExtensionHost(instance)
        let client: Client | undefined
        host.add(testExtension('test', (value) => (client = value)))

        const response = await client!.apiRequest(
            '/flags/?existing=yes&token=existing-token&%74oken=encoded-token&token=last-token',
            {
                method: 'GET',
                query: { extra: 'value', token: 'duplicate-token', '%74oken': 'encoded-query-token' },
                timeoutMs: 321,
            }
        )
        expect(response.statusCode).toBe(201)
        expect(response.json).toEqual({ created: true })
        expect(response.text).toBe('{"created":true}')
        expect(instance.requestRouter.endpointFor).toHaveBeenCalledWith(
            'flags',
            '/flags/?existing=yes&token=existing-token&%74oken=encoded-token&token=last-token'
        )
        expect(send.mock.calls[0][0]).toEqual(
            expect.objectContaining({
                method: 'GET',
                timeout: 321,
                noRetries: true,
                fireCallbackOnDrop: true,
                url: expect.stringContaining('token=test-token'),
            })
        )
        expect(send.mock.calls[0][0].url).toContain('existing=yes')
        expect(send.mock.calls[0][0].url).toContain('extra=value')
        expect(send.mock.calls[0][0].url?.match(/token=/g)).toHaveLength(1)
        expect(send.mock.calls[0][0].url).not.toContain('%74oken')

        const requestError = new Error('network failure')
        send.mockImplementationOnce((options) => options.callback?.({ statusCode: 0, error: requestError }))
        const dropped = await client!.apiRequest('/api/surveys/?token=wrong&survey_id=1', {
            query: { token: 'also-wrong', page: '2' },
        })
        expect(dropped.statusCode).toBe(0)
        expect(dropped.error).toBe(requestError)
        expect(send.mock.calls[1][0].url).toContain('token=test-token')
        expect(send.mock.calls[1][0].url).toContain('survey_id=1')
        expect(send.mock.calls[1][0].url).toContain('page=2')
        expect(send.mock.calls[1][0].url?.match(/token=/g)).toHaveLength(1)

        send.mockImplementationOnce(() => undefined)
        const unload = await client!.apiRequest('/s/?token=wrong&keep=yes', {
            method: 'POST',
            body: { events: [] },
            query: { token: 'also-wrong' },
            unload: true,
        })
        expect(unload.statusCode).toBe(202)
        expect(unload.json).toBeUndefined()
        expect(unload.text).toBeUndefined()
        expect(send.mock.calls.at(-1)?.[0]).toEqual(
            expect.objectContaining({
                transport: 'sendBeacon',
                data: { events: [] },
                url: expect.stringContaining('token=test-token'),
            })
        )
        expect(send.mock.calls.at(-1)?.[0].url).toContain('keep=yes')
        expect(send.mock.calls.at(-1)?.[0].url?.match(/token=/g)).toHaveLength(1)
        await host.dispose()
    })

    it('owns flags body authentication without mutating caller bodies', async () => {
        const instance = createMockPostHog()
        const send = instance._send_request as jest.MockedFunction<(options: QueuedRequestWithOptions) => void>
        send.mockImplementation((options) => options.callback?.({ statusCode: 200 }))
        const host = new BrowserExtensionHost(instance)
        let client: Client | undefined
        await host.add(testExtension('test', (value) => (client = value)))
        const body = {
            token: 'body-project',
            $token: 'body-alias',
            api_key: 'api-key-alias',
            distinct_id: 'person-1',
            nested: { approved: true },
        }
        const originalBody = { ...body, nested: { ...body.nested } }

        await client!.apiRequest('/flags/?token=path-project&%74oken=encoded-project&keep=yes', {
            body,
            query: { token: 'query-project', '%74oken': 'encoded-query-project', extra: 'value' },
        })
        await client!.apiRequest('/flags/', { body: { distinct_id: 'person-2' } })
        await client!.apiRequest('/flags/')

        expect(send.mock.calls[0][0].data).toEqual({
            token: 'test-token',
            distinct_id: 'person-1',
            nested: { approved: true },
        })
        expect(send.mock.calls[0][0].data).not.toHaveProperty('$token')
        expect(send.mock.calls[0][0].data).not.toHaveProperty('api_key')
        expect(body).toEqual(originalBody)
        expect(send.mock.calls[1][0].data).toEqual({ distinct_id: 'person-2', token: 'test-token' })
        expect(send.mock.calls[2][0].data).toEqual({ token: 'test-token' })

        const url = new URL(send.mock.calls[0][0].url)
        expect(url.searchParams.getAll('token')).toEqual(['test-token'])
        expect(url.searchParams.get('keep')).toBe('yes')
        expect(url.searchParams.get('extra')).toBe('value')
        await host.dispose()
    })

    it.each([null, [], 'invalid', 42])('rejects an incompatible flags body without throwing (%p)', async (body) => {
        const instance = createMockPostHog()
        const send = instance._send_request as jest.MockedFunction<(options: QueuedRequestWithOptions) => void>
        const host = new BrowserExtensionHost(instance)
        let client: Client | undefined
        await host.add(testExtension('test', (value) => (client = value)))

        await expect(client!.apiRequest('/flags/', { body })).resolves.toEqual({
            statusCode: 0,
            error: expect.any(TypeError),
        })
        expect(send).not.toHaveBeenCalled()
        await host.dispose()
    })

    it.each([
        {
            path: '/api/surveys/?survey_id=1&token=wrong&%74oken=encoded#section',
            query: { keep: 'a b', token: 'query-wrong', '%74oken': 'encoded-query-wrong' },
            expectedPath: '/api/surveys/',
            expectedQuery: { survey_id: '1', keep: 'a b' },
        },
        {
            path: '/flags/#section',
            query: { keep: 'fragment-only' },
            expectedPath: '/flags/',
            expectedQuery: { keep: 'fragment-only' },
        },
    ])(
        'strips URL fragments before appending host auth for $path',
        async ({ path, query, expectedPath, expectedQuery }) => {
            const instance = createMockPostHog()
            instance.config.token = 'host project/+?'
            const send = instance._send_request as jest.MockedFunction<(options: QueuedRequestWithOptions) => void>
            send.mockImplementation((options) => options.callback?.({ statusCode: 200 }))
            const host = new BrowserExtensionHost(instance)
            let client: Client | undefined
            await host.add(testExtension('test', (value) => (client = value)))

            await expect(client!.apiRequest(path, { query })).resolves.toEqual({ statusCode: 200 })

            const url = new URL(send.mock.calls[0][0].url)
            expect(url.hash).toBe('')
            expect(url.pathname).toBe(expectedPath)
            expect(url.searchParams.getAll('token')).toEqual(['host project/+?'])
            Object.entries(expectedQuery).forEach(([key, value]) => expect(url.searchParams.get(key)).toBe(value))
            await host.dispose()
        }
    )

    it('serializes the canonical flags body through the browser request encoder', async () => {
        const open = jest.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(() => undefined)
        const setRequestHeader = jest
            .spyOn(XMLHttpRequest.prototype, 'setRequestHeader')
            .mockImplementation(() => undefined)
        const sendRequest = jest.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(() => undefined)
        try {
            const instance = createMockPostHog()
            instance._send_request = jest.fn((options: QueuedRequestWithOptions) => {
                request({ ...options, transport: 'XHR' })
                options.callback?.({ statusCode: 200 })
            })
            const host = new BrowserExtensionHost(instance)
            let client: Client | undefined
            await host.add(testExtension('test', (value) => (client = value)))
            const body = {
                token: 'body-project',
                $token: 'body-alias',
                api_key: 'api-key-alias',
                distinct_id: 'person-1',
            }

            await client!.apiRequest('/flags/', { body })

            expect(open).toHaveBeenCalled()
            expect(setRequestHeader).toHaveBeenCalledWith('Content-Type', 'application/json')
            expect(JSON.parse(sendRequest.mock.calls[0][0] as string)).toEqual({
                distinct_id: 'person-1',
                token: 'test-token',
            })
            expect(body).toEqual({
                token: 'body-project',
                $token: 'body-alias',
                api_key: 'api-key-alias',
                distinct_id: 'person-1',
            })
            await host.dispose()
        } finally {
            open.mockRestore()
            setRequestHeader.mockRestore()
            sendRequest.mockRestore()
        }
    })

    it('uses host persistence exposure, collision, and reset policy for direct keys', async () => {
        const captured: Properties[] = []
        const posthog = await createPosthogInstance(undefined, {
            before_send: (event) => {
                if (event) {
                    captured.push(event.properties)
                }
                return event
            },
        })
        let client: Client | undefined
        await posthog._getBrowserExtensionHost().add(testExtension('test', (value) => (client = value)))

        const extensionKey = 'posthog.test.opaqueState'
        await client?.kv.set(extensionKey, 'visible')
        await client?.kv.set(AUTOCAPTURE_DISABLED_SERVER_SIDE, false)
        await client?.kv.set(HEATMAPS_ENABLED_SERVER_SIDE, true)
        await client?.kv.set('distinct_id', 'extension-collision')
        posthog.capture('kv-exposure')

        expect(captured.at(-1)).toMatchObject({
            [extensionKey]: 'visible',
            [AUTOCAPTURE_DISABLED_SERVER_SIDE]: false,
            distinct_id: 'extension-collision',
        })
        expect(captured.at(-1)).not.toHaveProperty(HEATMAPS_ENABLED_SERVER_SIDE)
        expect(posthog.get_distinct_id()).toBe('extension-collision')

        posthog.reset()
        expect(await client?.kv.get(extensionKey)).toBeUndefined()
        await posthog.shutdown()
    })

    it('uses normal batching when Core capture options are omitted and preserves explicit mappings', async () => {
        const posthog = await createPosthogInstance(undefined, {
            request_batching: true,
            before_send: (event) => event,
        })
        const enqueue = jest.spyOn(posthog._requestQueue!, 'enqueue')
        const send = jest.spyOn(posthog, '_send_retriable_request')
        let core: CoreExtension | undefined
        await posthog
            ._getBrowserExtensionHost()
            .add(testExtension('capture-test', (client) => (core = client.getExtension(CoreExtensionToken))))

        await core?.capture('batched-core-event', { source: 'core' })
        expect(enqueue).toHaveBeenCalledTimes(1)
        expect(send).not.toHaveBeenCalled()

        const timestamp = new Date('2026-01-01T00:00:00Z')
        await core?.capture('mapped-core-event', {}, { timestamp, uuid: 'mapped', set: { a: 1 }, setOnce: { b: 2 } })
        expect(send).toHaveBeenLastCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    timestamp,
                    $set: { a: 1 },
                    $set_once: { b: 2 },
                }),
            })
        )
        await posthog.shutdown()
    })

    it.each([true, false])('keeps outbound event data detached from Core observers (batching=%s)', async (batching) => {
        const posthog = await createPosthogInstance(undefined, {
            request_batching: batching,
            before_send: (event) => event,
        })
        const enqueue = jest.spyOn(posthog._requestQueue!, 'enqueue')
        const send = jest.spyOn(posthog, '_send_retriable_request')
        let core: CoreExtension | undefined
        await posthog
            ._getBrowserExtensionHost()
            .add(testExtension('observer-test', (client) => (core = client.getExtension(CoreExtensionToken))))
        core?.onEvent((event) => {
            event.properties.approved = 'mutated'
            ;(event.properties.nested as { value: string }).value = 'mutated'
            event.properties.added = 'after-before-send'
        })

        await core?.capture('observer-isolation', { approved: 'yes', nested: { value: 'yes' } })
        const outbound = batching ? enqueue.mock.calls.at(-1)?.[0].data : send.mock.calls.at(-1)?.[0].data
        expect(outbound?.properties).toMatchObject({ approved: 'yes', nested: { value: 'yes' } })
        expect(outbound?.properties).not.toHaveProperty('added')
        await posthog.shutdown()
    })

    it('applies core remote config before detached pre-DOM publication and hands cached config to a lazy host', async () => {
        const posthog = await createPosthogInstance(undefined)
        const legacyConsumer = jest.spyOn(posthog.autocapture!, 'onRemoteConfig')
        const body = document.body
        body.remove()
        jest.useFakeTimers()
        try {
            const canonicalConfig = {
                supportedCompression: ['base64'],
                analytics: { endpoint: '/new-endpoint/' },
                nested: { approved: true },
                autocapture_opt_out: true,
            } as any
            posthog._onRemoteConfig({ ok: true, config: canonicalConfig })

            const host = posthog._getBrowserExtensionHost()
            let core: CoreExtension | undefined
            await host.add(
                testExtension('remote-config-test', (client) => (core = client.getExtension(CoreExtensionToken)))
            )
            const cached = await core?.getRemoteConfig()
            expect(posthog.analyticsDefaultEndpoint).toBe('/new-endpoint/')
            expect(posthog.compression).toBe('base64')
            expect(cached).toEqual(canonicalConfig)
            ;(cached!.nested as { approved: boolean }).approved = false
            await expect(core?.getRemoteConfig()).resolves.toEqual(canonicalConfig)

            const first = jest.fn((config: any) => {
                expect(posthog.analyticsDefaultEndpoint).toBe('/new-endpoint/')
                config.nested.approved = false
                config.autocapture_opt_out = false
            })
            const second = jest.fn()
            core?.onRemoteConfig(first)
            core?.onRemoteConfig(second)
            const nextConfig = { ...canonicalConfig, marker: 'next', nested: { approved: true } }
            const pending = core?.getRemoteConfig()
            posthog._onRemoteConfig({ ok: true, config: nextConfig })

            expect(first).toHaveBeenCalledTimes(1)
            expect(second).toHaveBeenCalledWith(nextConfig)
            await expect(pending).resolves.toEqual(canonicalConfig)
            expect(nextConfig).toEqual(
                expect.objectContaining({ nested: { approved: true }, autocapture_opt_out: true })
            )
            expect(legacyConsumer).not.toHaveBeenCalledWith(expect.objectContaining({ config: nextConfig }))

            document.documentElement.appendChild(body)
            jest.advanceTimersByTime(500)
            expect(first).toHaveBeenCalledTimes(1)
            expect(second).toHaveBeenCalledTimes(1)
            expect(legacyConsumer).toHaveBeenCalledWith({ ok: true, config: nextConfig })
        } finally {
            if (!document.body) {
                document.documentElement.appendChild(body)
            }
            jest.useRealTimers()
            await posthog.shutdown(0)
        }
    })

    it('reports proactive session idle expiry as an idle timeout', async () => {
        jest.useFakeTimers()
        let posthog: PostHog | undefined
        try {
            posthog = await createPosthogInstance(undefined, {
                capture_pageview: false,
                session_idle_timeout_seconds: 60,
            })
            const host = posthog._getBrowserExtensionHost()
            let core: CoreExtension | undefined
            await host.add(
                testExtension('idle-session-test', (client) => (core = client.getExtension(CoreExtensionToken)))
            )
            const sessions: NewSessionInfo[] = []
            core?.onNewSession((session) => sessions.push(session))

            posthog.capture('establish-session')
            const initialSessionId = sessions.at(-1)?.sessionId
            expect(sessions.map(({ reason }) => reason)).toEqual(['initial'])

            jest.advanceTimersByTime(60_000 * 1.1 + 1)
            posthog.capture('after-idle-expiry')

            expect(sessions.map(({ reason }) => reason)).toEqual(['initial', 'idleTimeout'])
            expect(sessions.at(-1)?.sessionId).not.toBe(initialSessionId)
            expect(sessions.at(-1)).toEqual(
                expect.objectContaining({
                    sessionId: expect.any(String),
                    windowId: expect.any(String),
                    sessionStartTimestamp: expect.any(Number),
                })
            )
        } finally {
            posthog?.sessionManager?.destroy()
            await posthog?.shutdown(0)
            jest.useRealTimers()
        }
    })

    it('continues host capture, config, and session work after shared listener failures', async () => {
        const posthog = await createPosthogInstance(undefined, {
            request_batching: true,
            capture_pageview: false,
            before_send: (event) => event,
        })
        const host = posthog._getBrowserExtensionHost()
        let core: CoreExtension | undefined
        await host.add(testExtension('continuation-test', (client) => (core = client.getExtension(CoreExtensionToken))))
        const error = jest.spyOn(host.logger, 'error').mockImplementation()
        const enqueue = jest.spyOn(posthog._requestQueue!, 'enqueue')
        const eventSibling = jest.fn()
        const configSibling = jest.fn()
        const sessionSibling = jest.fn()
        const legacyConfig = jest.spyOn(posthog.autocapture!, 'onRemoteConfig')

        core?.onEvent(() => {
            throw new Error('event failed')
        })
        core?.onEvent(eventSibling)
        core?.onRemoteConfig(() => {
            throw new Error('config failed')
        })
        core?.onRemoteConfig(configSibling)
        core?.onNewSession(() => {
            throw new Error('session failed')
        })
        core?.onNewSession(sessionSibling)

        expect(() => posthog.capture('must-send')).not.toThrow()
        expect(enqueue).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ event: 'must-send' }) })
        )
        expect(eventSibling).toHaveBeenCalled()

        const result = { ok: true, config: { analytics: { endpoint: '/continued/' } } as any } as const
        expect(() => posthog._onRemoteConfig(result)).not.toThrow()
        expect(posthog.analyticsDefaultEndpoint).toBe('/continued/')
        expect(configSibling).toHaveBeenCalled()
        expect(legacyConfig).toHaveBeenCalledWith(result)

        posthog.reset()
        expect(() => posthog.capture('after-reset')).not.toThrow()
        expect(sessionSibling).toHaveBeenCalled()
        expect(enqueue).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ event: 'after-reset' }) })
        )
        expect(error).toHaveBeenCalledWith('Browser extension event listener failed', expect.any(Error))
        expect(error).toHaveBeenCalledWith('Browser extension remote config listener failed', expect.any(Error))
        expect(error).toHaveBeenCalledWith('Browser extension new session listener failed', expect.any(Error))
        await posthog.shutdown()
    })

    it('rebinds Core session delivery after cookieless opt-out and opt-in and removes it on shutdown', async () => {
        const posthog = await createPosthogInstance(undefined, {
            cookieless_mode: 'on_reject',
            capture_pageview: false,
        })
        const originalOnSessionId = posthog.onSessionId.bind(posthog)
        const originalOnForcedIdleReset = SessionIdManager.prototype.on
        const removeSessionListener = jest.fn()
        const removeForcedIdleResetListener = jest.fn()
        jest.spyOn(posthog, 'onSessionId').mockImplementation((callback) => {
            const remove = originalOnSessionId(callback)
            return () => {
                removeSessionListener()
                remove()
            }
        })
        const onForcedIdleReset = jest.spyOn(SessionIdManager.prototype, 'on').mockImplementation(function (
            this: SessionIdManager,
            event,
            handler
        ) {
            const remove = originalOnForcedIdleReset.call(this, event, handler)
            return () => {
                removeForcedIdleResetListener()
                remove()
            }
        })

        try {
            const host = posthog._getBrowserExtensionHost()
            let core: CoreExtension | undefined
            await host.add(testExtension('session-test', (client) => (core = client.getExtension(CoreExtensionToken))))
            const sessions: NewSessionInfo[] = []
            core?.onNewSession((session) => sessions.push(session))

            posthog.opt_out_capturing()
            posthog.opt_in_capturing({ captureEventName: false })
            posthog.capture('first-after-opt-in')

            const current = posthog.sessionManager?.checkAndGetSessionAndWindowId(true)
            expect(sessions.at(-1)).toEqual({
                sessionId: current?.sessionId,
                windowId: current?.windowId,
                sessionStartTimestamp: current?.sessionStartTimestamp,
                reason: 'reset',
            })
            expect(sessions.at(-1)?.sessionId).not.toBe('')
            expect(sessions.at(-1)?.windowId).not.toBe('')
            expect(sessions.at(-1)?.sessionStartTimestamp).toBeGreaterThan(0)

            await posthog.shutdown()
            const delivered = sessions.length
            posthog.sessionManager?.resetSessionId()
            posthog.sessionManager?.checkAndGetSessionAndWindowId()
            expect(sessions).toHaveLength(delivered)
            expect(removeSessionListener).toHaveBeenCalledTimes(2)
            expect(onForcedIdleReset).toHaveBeenCalledTimes(2)
            expect(removeForcedIdleResetListener).toHaveBeenCalledTimes(2)
        } finally {
            onForcedIdleReset.mockRestore()
        }
    })

    it('bridges PostHog remote config, finalized events, reset sessions, and shutdown', async () => {
        const posthog = await createPosthogInstance(undefined, { before_send: (event) => event })
        const host = posthog._getBrowserExtensionHost()
        const extensionDispose = jest.fn()
        let client: Client | undefined
        host.add(testExtension('lifecycle', (value) => (client = value), extensionDispose))
        const remoteConfigs: unknown[] = []
        const events: Array<{ event: string; properties: Record<string, unknown> }> = []
        const sessionReasons: string[] = []
        const core = client?.getExtension(CoreExtensionToken)
        core?.onRemoteConfig((config) => remoteConfigs.push(config))
        core?.onEvent((event) => events.push(event))
        core?.onNewSession(({ reason }) => sessionReasons.push(reason))

        posthog.capture('finalized-event', { explicit: true })
        expect(events.at(-1)).toEqual({
            event: 'finalized-event',
            properties: expect.objectContaining({ explicit: true, token: posthog.config.token }),
        })

        const body = document.body
        body.remove()
        jest.useFakeTimers()
        try {
            posthog._onRemoteConfig({
                ok: true,
                config: { supportedCompression: [], lifecycle: true } as any,
            })
            expect(remoteConfigs).toEqual([expect.objectContaining({ lifecycle: true })])
            document.documentElement.appendChild(body)
            jest.advanceTimersByTime(500)
            expect(remoteConfigs).toHaveLength(1)
        } finally {
            if (!document.body) {
                document.documentElement.appendChild(body)
            }
            jest.useRealTimers()
        }

        await client?.kv.set('state', 'before-reset')
        await client?.kv.set(AUTOCAPTURE_DISABLED_SERVER_SIDE, false)
        posthog.reset()
        expect(await client?.kv.get('state')).toBeUndefined()
        expect(await client?.kv.get(AUTOCAPTURE_DISABLED_SERVER_SIDE)).toBeUndefined()
        posthog.capture('after-reset')
        expect(sessionReasons).toContain('reset')

        await posthog.shutdown()
        expect(extensionDispose).toHaveBeenCalledTimes(1)
    })
})

describe('PostHog extension dynamic properties', () => {
    it('merges producers before explicit properties, disposes them, and isolates producer errors', async () => {
        const beforeSend = jest.fn((event) => event)
        const posthog = await createPosthogInstance(undefined, { before_send: beforeSend })
        const error = jest.spyOn(logger, 'error').mockImplementation()
        const calculateEventProperties = jest.spyOn(posthog, 'calculateEventProperties')
        const removeDynamic = posthog._registerExtensionEventProperties(() => ({
            dynamic: 'value',
            overridden: 'dynamic',
            overriddenWithUndefined: 'dynamic',
        }))
        posthog._registerExtensionEventProperties(() => {
            throw new Error('producer failed')
        })
        const duplicateProducer = jest.fn(() => ({ duplicated: true }))
        const removeFirstDuplicate = posthog._registerExtensionEventProperties(duplicateProducer)
        posthog._registerExtensionEventProperties(duplicateProducer)

        posthog.capture('with-dynamic', { overridden: 'explicit', overriddenWithUndefined: undefined })
        expect(calculateEventProperties.mock.calls[0][1]).toEqual(
            expect.objectContaining({
                dynamic: 'value',
                overridden: 'explicit',
                overriddenWithUndefined: undefined,
            })
        )
        expect(beforeSend).toHaveBeenLastCalledWith(
            expect.objectContaining({
                properties: expect.objectContaining({ dynamic: 'value', overridden: 'explicit' }),
            })
        )

        expect(duplicateProducer).toHaveBeenCalledTimes(2)
        removeFirstDuplicate()
        posthog.capture('with-one-duplicate')
        expect(duplicateProducer).toHaveBeenCalledTimes(3)

        removeDynamic()
        posthog.capture('without-dynamic')
        expect(beforeSend).toHaveBeenLastCalledWith(
            expect.objectContaining({ properties: expect.not.objectContaining({ dynamic: 'value' }) })
        )
        expect(error).toHaveBeenCalled()
        await posthog.shutdown()
    })
})
