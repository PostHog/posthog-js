import type { Client, Extension } from '@posthog/browser-common'

import { logger } from '@posthog/browser-common/utils/logger'
import { SimpleEventEmitter } from '@posthog/browser-common/utils/simple-event-emitter'

import { AUTOCAPTURE_DISABLED_SERVER_SIDE, DEVICE_ID, HEATMAPS_ENABLED_SERVER_SIDE } from '../../constants'
import { BrowserClientAdapter } from '../../extensions/browser-client'
import { request } from '../../request'
import type { PostHog } from '../../posthog-core'
import type { PostHogPersistence } from '../../posthog-persistence'
import type { CaptureOptions, Properties, Property, QueuedRequestWithOptions, RemoteConfigResult } from '../../types'
import { createPosthogInstance } from '../helpers/posthog-instance'

interface MockPostHog extends PostHog {
    emitEvent(event: string, properties?: Properties): void
}

function createMockPostHog(
    options: {
        remoteConfigResult?: RemoteConfigResult
        flagsDisabled?: boolean
    } = {}
): MockPostHog {
    const props: Properties = {
        distinct_id: 'distinct-id',
        [DEVICE_ID]: 'anonymous-id',
        $groups: { organization: 'org-id' },
    }
    const eventHandlers = new Set<(event: { event: string; properties: Properties }) => void>()
    const currentSession = { sessionId: 'session-id', windowId: 'window-id', sessionStartTimestamp: 123 }

    const persistence = {
        props,
        get_property: jest.fn((prop: string) => props[prop]),
        set_property: jest.fn((prop: string, value: Property) => (props[prop] = value)),
        unregister: jest.fn((prop: string) => delete props[prop]),
        get_initial_props: jest.fn(() => ({ initial: 'person-property' })),
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
            checkAndGetSessionAndWindowId: jest.fn(() => currentSession),
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
        emitEvent(event, properties = {}) {
            eventHandlers.forEach((handler) => handler({ event, properties }))
        },
    } as unknown as MockPostHog

    return instance
}

function testExtension(
    name: string,
    setup: (client: Client) => void | Promise<void>,
    dispose: () => void = jest.fn()
): Extension {
    return { name, setup, dispose }
}

describe('BrowserClientAdapter', () => {
    it('shares one Client with core analytics behavior across extensions', async () => {
        const instance = createMockPostHog()
        const host = new BrowserClientAdapter(instance)
        let client: Client | undefined
        let secondClient: Client | undefined
        host.add(testExtension('test', (value) => (client = value)))
        host.add(testExtension('second', (value) => (secondClient = value)))

        expect(client).toBe(host)
        expect(secondClient).toBe(client)
        expect(client?.distinctId).toBe('distinct-id')
        expect(client?.anonymousId).toBe('anonymous-id')
        expect(client?.deviceId).toBe('anonymous-id')
        expect(client?.library).toEqual(
            expect.objectContaining({ name: expect.any(String), version: expect.any(String) })
        )
        expect(client?.initialPersonProperties).toEqual({ initial: 'person-property' })
        expect(client?.groups).toEqual({ organization: 'org-id' })
        expect(client?.session).toEqual({
            sessionId: 'session-id',
            windowId: 'window-id',
            sessionStartTimestamp: 123,
        })
        expect(instance.sessionManager?.checkAndGetSessionAndWindowId).toHaveBeenCalledWith(true)
        expect(client?.logger).toBeDefined()

        const timestamp = new Date('2026-01-01T00:00:00Z')
        await client?.capture(
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
        const host = new BrowserClientAdapter(instance)
        let client: Client | undefined
        host.add(testExtension('test', (value) => (client = value)))

        expect(client?.anonymousId).toBe('distinct-id')
        expect(client?.deviceId).toBeUndefined()
        expect(client?.session).toEqual({ sessionId: '', windowId: '', sessionStartTimestamp: 0 })
        await host.dispose()
    })

    it('reads, writes, and removes persistence keys directly', async () => {
        const instance = createMockPostHog()
        const host = new BrowserClientAdapter(instance)
        let client: Client | undefined
        host.add(testExtension('test', (value) => (client = value)))

        const key = '$extension_state'
        instance.persistence!.props[key] = { prepopulated: true }
        expect(client?.kv.get(key)).toEqual({ prepopulated: true })

        expect(client?.kv.set(key, { enabled: true })).toBeUndefined()
        expect(instance.persistence?.set_property).toHaveBeenCalledWith(key, { enabled: true })
        expect(instance.persistence?.props[key]).toEqual({ enabled: true })

        client?.kv.set(key, null)
        client?.kv.set(key, undefined)
        expect(instance.persistence?.set_property).toHaveBeenNthCalledWith(2, key, null)
        expect(instance.persistence?.set_property).toHaveBeenNthCalledWith(3, key, undefined)
        expect(instance.persistence?.unregister).not.toHaveBeenCalled()

        instance.persistence!.props[key] = { externallyUpdated: true }
        expect(await client?.kv.get(key)).toEqual({ externallyUpdated: true })

        await client?.kv.remove(key)
        expect(instance.persistence?.unregister).toHaveBeenCalledWith(key)
        expect(instance.persistence?.props[key]).toBeUndefined()
        await host.dispose()
    })

    it('publishes every remote-config outcome and replays the latest result to late listeners', async () => {
        const host = new BrowserClientAdapter(createMockPostHog())
        let client: Client | undefined
        host.add(testExtension('test', (value) => (client = value)))
        const changes: RemoteConfigResult[] = []
        client?.onRemoteConfig((result) => changes.push(result as RemoteConfigResult))

        host.handleRemoteConfig({ ok: false })
        expect(changes).toEqual([{ ok: false }])

        const successfulConfig = {
            supportedCompression: [],
            marker: 'current',
            nested: { approved: true },
        } as any
        const success = { ok: true, config: successfulConfig } as const
        host.handleRemoteConfig(success)
        expect(changes).toEqual([{ ok: false }, success])

        const lateListener = jest.fn()
        client?.onRemoteConfig(lateListener)
        expect(lateListener).toHaveBeenCalledWith(success)
        await host.dispose()
    })

    it('publishes each remote-config result to every listener', async () => {
        const host = new BrowserClientAdapter(createMockPostHog())
        let client: Client | undefined
        await host.add(testExtension('test', (value) => (client = value)))
        const firstListener = jest.fn()
        const secondListener = jest.fn()
        client?.onRemoteConfig(firstListener)
        client?.onRemoteConfig(secondListener)
        const result = { ok: true, config: { nested: { approved: true } } as any } as const

        host.handleRemoteConfig(result)
        expect(firstListener).toHaveBeenCalledWith(result)
        expect(secondListener).toHaveBeenCalledWith(result)
        await host.dispose()
    })

    it('stops publishing remote config after disposal', async () => {
        const host = new BrowserClientAdapter(createMockPostHog())
        let client: Client | undefined
        await host.add(testExtension('test', (value) => (client = value)))
        const listener = jest.fn()
        client!.onRemoteConfig(listener)

        host.dispose()
        host.handleRemoteConfig({ ok: false })

        expect(listener).not.toHaveBeenCalled()
        expect(client!.onRemoteConfig(jest.fn()).dispose).toEqual(expect.any(Function))
    })

    it('replays only canonical cached remote-config outcomes', async () => {
        const cachedResult = {
            ok: true,
            config: { supportedCompression: [], cached: true } as any,
        } as const
        const cachedHost = new BrowserClientAdapter(createMockPostHog({ remoteConfigResult: cachedResult }))
        let cachedClient: Client | undefined
        cachedHost.add(testExtension('cached', (client) => (cachedClient = client)))
        const cachedListener = jest.fn()
        cachedClient?.onRemoteConfig(cachedListener)
        expect(cachedListener).toHaveBeenCalledWith(cachedResult)
        await cachedHost.dispose()

        const disabledHost = new BrowserClientAdapter(createMockPostHog({ flagsDisabled: true }))
        let disabledClient: Client | undefined
        disabledHost.add(testExtension('disabled', (client) => (disabledClient = client)))
        const disabledListener = jest.fn()
        disabledClient?.onRemoteConfig(disabledListener)
        expect(disabledListener).not.toHaveBeenCalled()
        await disabledHost.dispose()
    })

    it('adapts captured events and disposes subscriptions', async () => {
        const instance = createMockPostHog()
        const host = new BrowserClientAdapter(instance)
        let client: Client | undefined
        host.add(testExtension('test', (value) => (client = value)))
        const events: unknown[] = []
        const eventSubscription = client!.onEvent((event) => events.push(event))

        instance.emitEvent('captured', { answer: 42 })
        expect(events).toEqual([{ event: 'captured', properties: { answer: 42 } }])

        eventSubscription.dispose()
        instance.emitEvent('ignored')
        expect(events).toHaveLength(1)
        host.dispose()
    })

    it('isolates shared listener failures and continues sibling event and config delivery', async () => {
        const instance = createMockPostHog()
        const host = new BrowserClientAdapter(instance)
        let client: Client | undefined
        await host.add(testExtension('test', (value) => (client = value)))
        const error = jest.spyOn(host.logger, 'error').mockImplementation()
        const eventSibling = jest.fn()
        const configSibling = jest.fn()

        client?.onEvent(() => {
            throw new Error('event listener failed')
        })
        client?.onEvent(eventSibling)
        client?.onRemoteConfig(() => {
            throw new Error('config listener failed')
        })
        client?.onRemoteConfig(configSibling)

        expect(() => instance.emitEvent('continues', { nested: { approved: true } })).not.toThrow()
        expect(() => host.handleRemoteConfig({ ok: true, config: { nested: { approved: true } } as any })).not.toThrow()

        expect(eventSibling).toHaveBeenCalledTimes(1)
        expect(configSibling).toHaveBeenCalledTimes(1)
        expect(error).toHaveBeenCalledTimes(2)
        host.dispose()
    })

    it('delegates dynamic properties and returns an idempotent disposable', async () => {
        const instance = createMockPostHog()
        const remove = jest.fn()
        instance._registerExtensionEventProperties = jest.fn(() => remove)
        const host = new BrowserClientAdapter(instance)
        let client: Client | undefined
        host.add(testExtension('test', (value) => (client = value)))
        const producer = () => ({ dynamic: true })

        const registration = client!.registerDynamicEventProperties(producer)
        expect(instance._registerExtensionEventProperties).toHaveBeenCalledWith(producer)
        registration.dispose()
        registration.dispose()
        expect(remove).toHaveBeenCalledTimes(1)
        await host.dispose()
    })

    it('exposes the project token and adapts caller-owned request options', async () => {
        const instance = createMockPostHog()
        const send = instance._send_request as jest.MockedFunction<(options: QueuedRequestWithOptions) => void>
        send.mockImplementation((options) =>
            options.callback?.({ statusCode: 201, json: { created: true }, text: '{"created":true}' })
        )
        const host = new BrowserClientAdapter(instance)
        let client: Client | undefined
        await host.add(testExtension('test', (value) => (client = value)))
        const body = {
            token: 'body-project',
            $token: 'body-alias',
            api_key: 'api-key-alias',
            distinct_id: 'person-1',
        }

        expect(client?.projectToken).toBe('test-token')
        const response = await client!.sendRequest('/flags/?existing=yes', {
            target: 'flags',
            method: 'POST',
            body,
            query: { token: 'query-project', extra: 'value' },
            headers: { 'X-Extension-Header': 'value' },
            transport: 'XHR',
            timeoutMs: 321,
            compression: 'base64',
            sentAt: 'body',
        })

        expect(response).toEqual({ statusCode: 201, json: { created: true }, text: '{"created":true}' })
        expect(instance.requestRouter.endpointFor).toHaveBeenCalledWith('flags', '/flags/?existing=yes')
        expect(send).toHaveBeenCalledWith(
            expect.objectContaining({
                method: 'POST',
                url: 'https://flags.example.com/flags/?existing=yes&token=query-project&extra=value',
                data: body,
                headers: { 'X-Extension-Header': 'value' },
                transport: 'XHR',
                timeout: 321,
                compression: 'base64',
                timestampMode: 'body',
                fireCallbackOnDrop: true,
                callback: expect.any(Function),
            })
        )
        expect(send.mock.calls[0][0]).not.toHaveProperty('noRetries')
        expect(body).toEqual({
            token: 'body-project',
            $token: 'body-alias',
            api_key: 'api-key-alias',
            distinct_id: 'person-1',
        })
        await host.dispose()
    })

    it('uses the regular API target by default and resolves dropped requests', async () => {
        const instance = createMockPostHog()
        const requestError = new Error('network failure')
        const send = instance._send_request as jest.MockedFunction<(options: QueuedRequestWithOptions) => void>
        send.mockImplementation((options) => options.callback?.({ statusCode: 0, error: requestError }))
        const host = new BrowserClientAdapter(instance)
        let client: Client | undefined
        await host.add(testExtension('test', (value) => (client = value)))

        await expect(client!.sendRequest('/api/surveys/', { method: 'GET' })).resolves.toEqual({
            statusCode: 0,
            error: requestError,
        })
        expect(instance.requestRouter.endpointFor).toHaveBeenCalledWith('api', '/api/surveys/')
        expect(send).toHaveBeenCalledWith(
            expect.objectContaining({ method: 'GET', url: 'https://api.example.com/api/surveys/' })
        )
        await host.dispose()
    })

    it('returns a best-effort response immediately for an explicit sendBeacon transport', async () => {
        const instance = createMockPostHog()
        const send = instance._send_request as jest.MockedFunction<(options: QueuedRequestWithOptions) => void>
        send.mockImplementation(() => undefined)
        const host = new BrowserClientAdapter(instance)
        let client: Client | undefined
        await host.add(testExtension('test', (value) => (client = value)))

        const response = await client!.sendRequest('/s/', {
            method: 'POST',
            body: { events: [] },
            query: { token: client!.projectToken },
            transport: 'sendBeacon',
        })

        expect(response).toEqual({ statusCode: 202 })
        expect(send).toHaveBeenCalledWith(
            expect.objectContaining({
                method: 'POST',
                transport: 'sendBeacon',
                data: { events: [] },
                url: 'https://api.example.com/s/?token=test-token',
            })
        )
        expect(send.mock.calls[0][0].callback).toBeUndefined()
        await host.dispose()
    })

    it('serializes the caller-owned body through the selected browser transport', async () => {
        const open = jest.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(() => undefined)
        const setRequestHeader = jest
            .spyOn(XMLHttpRequest.prototype, 'setRequestHeader')
            .mockImplementation(() => undefined)
        const sendRequest = jest.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(() => undefined)
        try {
            const instance = createMockPostHog()
            instance._send_request = jest.fn((options: QueuedRequestWithOptions) => {
                request(options)
                options.callback?.({ statusCode: 200 })
            })
            const host = new BrowserClientAdapter(instance)
            let client: Client | undefined
            await host.add(testExtension('test', (value) => (client = value)))
            const body = {
                token: 'body-project',
                $token: 'body-alias',
                api_key: 'api-key-alias',
                distinct_id: 'person-1',
            }

            await client!.sendRequest('/flags/', {
                target: 'flags',
                method: 'POST',
                body,
                transport: 'XHR',
            })

            expect(open).toHaveBeenCalled()
            expect(setRequestHeader).toHaveBeenCalledWith('Content-Type', 'application/json')
            expect(JSON.parse(sendRequest.mock.calls[0][0] as string)).toEqual(body)
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
        await posthog._getBrowserClientAdapter().add(testExtension('test', (value) => (client = value)))

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

    it('uses normal batching when Client capture options are omitted and preserves explicit mappings', async () => {
        const posthog = await createPosthogInstance(undefined, {
            request_batching: true,
            before_send: (event) => event,
        })
        const enqueue = jest.spyOn(posthog._requestQueue!, 'enqueue')
        const send = jest.spyOn(posthog, '_send_retriable_request')
        let client: Client | undefined
        await posthog._getBrowserClientAdapter().add(testExtension('capture-test', (value) => (client = value)))

        await client?.capture('batched-core-event', { source: 'core' })
        expect(enqueue).toHaveBeenCalledTimes(1)
        expect(send).not.toHaveBeenCalled()

        const timestamp = new Date('2026-01-01T00:00:00Z')
        await client?.capture('mapped-core-event', {}, { timestamp, uuid: 'mapped', set: { a: 1 }, setOnce: { b: 2 } })
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

    it('publishes remote config after DOM readiness and replays it to late subscribers', async () => {
        const posthog = await createPosthogInstance(undefined)
        const legacyConsumer = jest.spyOn(posthog.autocapture!, 'onRemoteConfig')
        const initialEndpoint = posthog.analyticsDefaultEndpoint
        const initialCompression = posthog.compression
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
            const result = { ok: true, config: canonicalConfig } as const
            posthog._onRemoteConfig(result)

            const host = posthog._getBrowserClientAdapter()
            let client: Client | undefined
            await host.add(testExtension('remote-config-test', (value) => (client = value)))
            const earlySubscriber = jest.fn()
            client?.onRemoteConfig(earlySubscriber)
            const initialCallCount = earlySubscriber.mock.calls.length

            expect(posthog.analyticsDefaultEndpoint).toBe(initialEndpoint)
            expect(posthog.compression).toBe(initialCompression)
            expect(earlySubscriber).not.toHaveBeenCalledWith(result)
            expect(legacyConsumer).not.toHaveBeenCalledWith(result)

            document.documentElement.appendChild(body)
            jest.advanceTimersByTime(500)

            expect(posthog.analyticsDefaultEndpoint).toBe('/new-endpoint/')
            expect(posthog.compression).toBe('base64')
            expect(earlySubscriber).toHaveBeenCalledTimes(initialCallCount + 1)
            expect(earlySubscriber).toHaveBeenLastCalledWith(result)
            expect(legacyConsumer).toHaveBeenCalledWith(result)

            const lateSubscriber = jest.fn()
            client?.onRemoteConfig(lateSubscriber)
            expect(lateSubscriber).toHaveBeenCalledTimes(1)
            expect(lateSubscriber).toHaveBeenCalledWith(result)
        } finally {
            if (!document.body) {
                document.documentElement.appendChild(body)
            }
            jest.useRealTimers()
            await posthog.shutdown(0)
        }
    })

    it('continues host capture and config work after shared listener failures', async () => {
        const posthog = await createPosthogInstance(undefined, {
            request_batching: true,
            capture_pageview: false,
            before_send: (event) => event,
        })
        const host = posthog._getBrowserClientAdapter()
        let client: Client | undefined
        await host.add(testExtension('continuation-test', (value) => (client = value)))
        const error = jest.spyOn(host.logger, 'error').mockImplementation()
        const enqueue = jest.spyOn(posthog._requestQueue!, 'enqueue')
        const eventSibling = jest.fn()
        const configSibling = jest.fn()
        const legacyConfig = jest.spyOn(posthog.autocapture!, 'onRemoteConfig')

        client?.onEvent(() => {
            throw new Error('event failed')
        })
        client?.onEvent(eventSibling)
        client?.onRemoteConfig(() => {
            throw new Error('config failed')
        })
        client?.onRemoteConfig(configSibling)

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
        expect(enqueue).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ event: 'after-reset' }) })
        )
        expect(error).toHaveBeenCalledWith('Browser extension event listener failed', expect.any(Error))
        expect(error).toHaveBeenCalledWith('Browser extension remote config listener failed', expect.any(Error))
        await posthog.shutdown()
    })

    it('bridges PostHog remote config, finalized events, persistence reset, and shutdown', async () => {
        const posthog = await createPosthogInstance(undefined, { before_send: (event) => event })
        const host = posthog._getBrowserClientAdapter()
        const extensionDispose = jest.fn()
        let client: Client | undefined
        host.add(testExtension('lifecycle', (value) => (client = value), extensionDispose))
        const remoteConfigs: unknown[] = []
        const events: Array<{ event: string; properties: Record<string, unknown> }> = []
        client?.onRemoteConfig((config) => remoteConfigs.push(config))
        const initialRemoteConfigCount = remoteConfigs.length
        client?.onEvent((event) => events.push(event))

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
            expect(remoteConfigs).toHaveLength(initialRemoteConfigCount)
            document.documentElement.appendChild(body)
            jest.advanceTimersByTime(500)
            expect(remoteConfigs).toHaveLength(initialRemoteConfigCount + 1)
            expect(remoteConfigs.at(-1)).toEqual({
                ok: true,
                config: expect.objectContaining({ lifecycle: true }),
            })
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
