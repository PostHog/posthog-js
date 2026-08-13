import { createPostHog, type BrowserFetch, type RemoteConfig } from '../src'
import { createFetch, MemoryStorage, type SentRequest } from './helpers'

const createRemoteConfig = (overrides: Partial<RemoteConfig> = {}): RemoteConfig =>
    ({
        supportedCompression: [],
        toolbarParams: {},
        toolbarVersion: 'toolbar',
        isAuthenticated: false,
        siteApps: [],
        ...overrides,
    }) as RemoteConfig

describe('@posthog/browser core', () => {
    it('requires a project token in options', async () => {
        // @ts-expect-error Verify the runtime guard for untyped JavaScript consumers.
        await expect(createPostHog()).rejects.toThrow('A PostHog project token is required')
        // @ts-expect-error Verify the runtime guard for untyped JavaScript consumers.
        await expect(createPostHog({})).rejects.toThrow('A PostHog project token is required')
        await expect(createPostHog({ projectToken: '' })).rejects.toThrow('A PostHog project token is required')
    })

    it('builds and sends a protected event envelope', async () => {
        const requests: SentRequest[] = []
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
        })
        const observed: Array<{ event: string; properties: Record<string, unknown> }> = []
        posthog.onEvent((event) => observed.push(event))
        posthog.registerDynamicEventProperties(() => ({ dynamic: 'yes', token: 'bad-token' }))

        await posthog.capture(
            'signed_up',
            { plan: 'pro', distinct_id: 'bad-id' },
            {
                uuid: 'event-uuid',
                timestamp: new Date('2026-01-02T03:04:05.000Z'),
                set: { email: 'person@example.com' },
                setOnce: { source: 'docs' },
            }
        )

        expect(requests).toHaveLength(1)
        expect(requests[0]?.url.pathname).toBe('/e/')
        expect(requests[0]?.url.searchParams.get('token')).toBe('ph_test')
        expect(requests[0]?.body).toMatchObject({
            uuid: 'event-uuid',
            event: 'signed_up',
            timestamp: '2026-01-02T03:04:05.000Z',
            properties: {
                dynamic: 'yes',
                plan: 'pro',
                token: 'ph_test',
                distinct_id: posthog.distinctId,
                $device_id: posthog.deviceId,
                $set: { email: 'person@example.com' },
                $set_once: { source: 'docs' },
                $lib: 'web',
            },
        })
        expect(observed).toHaveLength(1)
    })

    it('waits for active capture delivery when flush runs', async () => {
        let finishRequest: ((response: Response) => void) | undefined
        const fetch: BrowserFetch = () =>
            new Promise<Response>((resolve) => {
                finishRequest = resolve
            })
        const posthog = await createPostHog({ projectToken: 'ph_test', storage: false, navigator: false, fetch })

        const capture = posthog.capture('pending')
        let flushed = false
        const flush = posthog.flush().then(() => {
            flushed = true
        })
        await Promise.resolve()
        expect(flushed).toBe(false)

        finishRequest?.(new Response('{}', { status: 200 }))
        await capture
        await flush
        expect(flushed).toBe(true)
    })

    it('migrates persisted version-1 state without a device ID', async () => {
        const storage = new MemoryStorage()
        const stateKey = 'ph_ph_test_posthog_browser_v2'
        storage.setItem(
            stateKey,
            JSON.stringify({
                version: 1,
                anonymousId: 'legacy-anonymous',
                distinctId: 'legacy-user',
                isIdentified: true,
                groups: {},
                session: {
                    sessionId: 'legacy-session',
                    sessionStartTimestamp: 1,
                    lastActivityTimestamp: 1,
                },
                extensionData: {},
            })
        )

        const posthog = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch: false })

        expect(posthog.deviceId).toBe('legacy-anonymous')
        expect(posthog.anonymousId).toBe('legacy-anonymous')
        expect(posthog.distinctId).toBe('legacy-user')
        expect(JSON.parse(storage.getItem(stateKey) ?? '{}')).toMatchObject({ deviceId: 'legacy-anonymous' })
    })

    it('persists identity, groups, and core key-value data', async () => {
        const storage = new MemoryStorage()
        const requests: SentRequest[] = []
        const first = await createPostHog({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: createFetch(requests),
        })

        await first.identify('user-123')
        await first.group('organization', 'org-123')
        first.kv.set('key', { value: 1 })
        const anonymousId = first.anonymousId
        await first.dispose()

        const second = await createPostHog({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: createFetch(requests),
        })
        expect(second.anonymousId).toBe(anonymousId)
        expect(second.deviceId).toBe(anonymousId)
        expect(second.distinctId).toBe('user-123')
        expect(second.groups).toEqual({ organization: 'org-123' })
        expect(second.kv.get('key')).toEqual({ value: 1 })
    })

    it('implements synchronous key-value initialization and batch operations', async () => {
        const posthog = await createPostHog({ projectToken: 'ph_test', storage: false, navigator: false, fetch: false })

        expect(posthog.kv.initialize()).toBeUndefined()
        posthog.kv.set({ first: true, second: 'value', ['__proto__']: { safe: true } })
        expect(
            posthog.kv.get<{ first: boolean; second: string; missing: unknown }>(['first', 'missing', 'second'])
        ).toEqual({
            first: true,
            second: 'value',
        })
        const prototypeKey = posthog.kv.get<{ __proto__: { safe: boolean } }>(['__proto__'])
        expect(Object.prototype.hasOwnProperty.call(prototypeKey, '__proto__')).toBe(true)
        expect(prototypeKey['__proto__']).toEqual({ safe: true })
        expect(Object.getPrototypeOf(prototypeKey)).toBeNull()
        posthog.kv.remove(['first', 'second', '__proto__'])
        expect(posthog.kv.get<{ first: boolean; second: string }>(['first', 'second'])).toEqual({})
    })

    it('copies key-value data at the storage boundary', async () => {
        const posthog = await createPostHog({ projectToken: 'ph_test', storage: false, navigator: false, fetch: false })
        const input = { nested: { value: 1 } }
        posthog.kv.set('object', input)
        input.nested.value = 2

        const firstRead = posthog.kv.get<typeof input>('object')
        expect(firstRead).toEqual({ nested: { value: 1 } })
        if (firstRead) {
            firstRead.nested.value = 3
        }
        expect(posthog.kv.get('object')).toEqual({ nested: { value: 1 } })
    })

    it('does not turn default capture into explicit consent', async () => {
        const storage = new MemoryStorage()
        const first = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch: false })
        await first.dispose()

        expect(storage.values.has('ph_ph_test_posthog_browser_v2_consent')).toBe(false)

        const second = await createPostHog({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: false,
            optOutByDefault: true,
        })
        expect(second.hasOptedOut()).toBe(true)
    })

    it('ignores identity changes and analytics persistence before explicit opt-in', async () => {
        const requests: SentRequest[] = []
        const storage = new MemoryStorage()
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: createFetch(requests),
            optOutByDefault: true,
        })
        const anonymousId = posthog.anonymousId

        await posthog.identify('user-before-consent')
        await posthog.group('organization', 'group-before-consent')
        await posthog.capture('before_consent')
        expect(requests).toHaveLength(0)
        expect(storage.values.size).toBe(0)

        posthog.optIn()
        await posthog.capture('after_consent')

        expect(requests[0]?.body?.properties).toMatchObject({ distinct_id: anonymousId, $groups: {} })
    })

    it('persists opt-out without retaining identity state', async () => {
        const storage = new MemoryStorage()
        const requests: SentRequest[] = []
        const first = await createPostHog({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: createFetch(requests),
        })
        const firstAnonymousId = first.anonymousId

        first.optOut()
        await first.capture('blocked')
        expect(requests).toHaveLength(0)
        expect([...storage.values.keys()]).toEqual(['ph_ph_test_posthog_browser_v2_consent'])

        const second = await createPostHog({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: createFetch(requests),
        })
        expect(second.hasOptedOut()).toBe(true)
        expect(second.anonymousId).not.toBe(firstAnonymousId)
    })

    it('drops capture for a blocked user agent without writing persistence', async () => {
        const requests: SentRequest[] = []
        const storage = new MemoryStorage()
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage,
            navigator: { userAgent: 'Googlebot/2.1' },
            fetch: createFetch(requests),
        })

        const distinctId = posthog.distinctId
        const session = posthog.session
        await posthog.capture('blocked')
        await posthog.identify('blocked-user')
        await posthog.group('organization', 'blocked-org')
        posthog.reset()
        posthog.kv.set('blocked', true)

        expect(requests).toHaveLength(0)
        expect(posthog.distinctId).toBe(distinctId)
        expect(posthog.groups).toEqual({})
        expect(posthog.session).toEqual(session)
        expect(posthog.kv.get('blocked')).toBeUndefined()
        expect(storage.values.size).toBe(0)
    })

    it('falls back to keepalive fetch when sendBeacon rejects a payload', async () => {
        const requests: SentRequest[] = []
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            fetch: createFetch(requests),
            navigator: { sendBeacon: () => false },
        })

        const response = await posthog.sendRequest('/e/', {
            method: 'POST',
            body: { event: 'unload' },
            transport: 'sendBeacon',
        })
        expect(response.statusCode).toBe(200)
        expect(requests).toHaveLength(1)
        expect(requests[0]?.init.keepalive).toBe(true)
    })

    it('rejects request URLs outside the configured API origin', async () => {
        const requests: SentRequest[] = []
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
        })

        await expect(posthog.sendRequest('https://example.com/collect')).resolves.toMatchObject({ statusCode: 0 })
        await expect(posthog.sendRequest('//example.com/collect')).resolves.toMatchObject({ statusCode: 0 })
        await expect(posthog.sendRequest('/\\example.com/collect')).resolves.toMatchObject({ statusCode: 0 })
        expect(requests).toHaveLength(0)
    })

    it('routes requests through the configured target host', async () => {
        const requests: SentRequest[] = []
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            apiHost: 'https://api.example.com',
            flagsHost: 'https://flags.example.com',
            assetsHost: 'https://assets.example.com',
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
        })

        await posthog.sendRequest('/decide/', { target: 'flags' })
        await posthog.sendRequest('/static/extension.js', { target: 'assets' })

        expect(requests.map(({ url }) => url.origin)).toEqual([
            'https://flags.example.com',
            'https://assets.example.com',
        ])
    })

    it('does not let event observers mutate caller-owned nested properties', async () => {
        const posthog = await createPostHog({ projectToken: 'ph_test', storage: false, navigator: false, fetch: false })
        const properties = { nested: { value: 1 } }
        posthog.onEvent((event) => {
            const nested = event.properties.nested as { value: number }
            nested.value = 2
        })

        await posthog.capture('event', properties)
        expect(properties).toEqual({ nested: { value: 1 } })
    })

    it('does not let event observers replace protected delivery fields', async () => {
        const requests: SentRequest[] = []
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
        })
        posthog.onEvent(({ properties }) => {
            const mutableProperties = properties as Record<string, unknown>
            mutableProperties.token = 'replaced'
            mutableProperties.distinct_id = 'replaced'
        })

        await posthog.capture('event')

        expect(requests[0]?.body?.properties).toMatchObject({
            token: 'ph_test',
            distinct_id: posthog.distinctId,
        })
    })

    it('continues event notification after one observer throws', async () => {
        const posthog = await createPostHog({ projectToken: 'ph_test', storage: false, navigator: false, fetch: false })
        const events: string[] = []
        posthog.onEvent(() => {
            throw new Error('listener failed')
        })
        posthog.onEvent(({ event }) => events.push(event))

        await posthog.capture('event')
        expect(events).toEqual(['event'])
    })

    it.each(['', '   ', '\t', '$posthog_cookieless', 'distinct_id', 'DISTINCTID', 'undefined', 'NULL'])(
        'rejects invalid distinct ID %j without state or delivery changes',
        async (distinctId) => {
            const requests: SentRequest[] = []
            const posthog = await createPostHog({
                projectToken: 'ph_test',
                storage: false,
                navigator: false,
                fetch: createFetch(requests),
            })
            const identity = {
                anonymousId: posthog.anonymousId,
                distinctId: posthog.distinctId,
            }

            await posthog.identify(distinctId)

            expect(requests).toHaveLength(0)
            expect(posthog.anonymousId).toBe(identity.anonymousId)
            expect(posthog.distinctId).toBe(identity.distinctId)
        }
    )

    it.each(['', '   ', '\t'])('rejects invalid group type %j without state or delivery changes', async (type) => {
        const requests: SentRequest[] = []
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
        })

        await posthog.group(type, 'group-key')

        expect(requests).toHaveLength(0)
        expect(posthog.groups).toEqual({})
    })

    it.each(['', '   ', '\t'])('rejects invalid group key %j without state or delivery changes', async (key) => {
        const requests: SentRequest[] = []
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
        })

        await posthog.group('organization', key)

        expect(requests).toHaveLength(0)
        expect(posthog.groups).toEqual({})
    })

    it.each(['', '   ', '\t'])('rejects invalid event name %j without session or delivery changes', async (event) => {
        const requests: SentRequest[] = []
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
        })
        const session = posthog.session

        await posthog.capture(event)

        expect(requests).toHaveLength(0)
        expect(posthog.session).toEqual(session)
    })

    it('marks same-ID anonymous identify as identified without later relinking it', async () => {
        const requests: SentRequest[] = []
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
        })
        const anonymousId = posthog.distinctId

        await posthog.identify(anonymousId)
        await posthog.identify('later-user')

        expect(requests).toHaveLength(1)
        expect(requests[0]?.body).toMatchObject({
            event: '$set',
            properties: { distinct_id: anonymousId, $set: {}, $set_once: {} },
        })
        expect(posthog.distinctId).toBe('later-user')
    })

    it('does not repeat group-identify for an unchanged group without properties', async () => {
        const requests: SentRequest[] = []
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
        })

        await posthog.group('organization', 'org-123')
        await posthog.group('organization', 'org-123')
        await posthog.group('organization', 'org-123', { name: 'Acme' })

        expect(requests.map(({ body }) => body?.event)).toEqual(['$groupidentify', '$groupidentify'])
        expect(requests[0]?.body?.properties).not.toHaveProperty('$group_set')
        expect(requests[1]?.body?.properties).toMatchObject({ $group_set: { name: 'Acme' } })
    })

    it('does not merge a second identified user with the anonymous id', async () => {
        const requests: SentRequest[] = []
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
        })

        await posthog.identify('user-one')
        await posthog.identify('user-two')

        expect(requests).toHaveLength(1)
        expect(requests[0]?.body).toMatchObject({
            event: '$identify',
            properties: { distinct_id: 'user-one' },
        })
        expect(posthog.distinctId).toBe('user-two')
    })

    it('stops waiting for remote configuration after the timeout', async () => {
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: false,
            remoteConfigTimeoutMs: 1,
            remoteConfigLoader: () => new Promise(() => {}),
        })

        await expect(posthog.getRemoteConfig()).resolves.toBeUndefined()
    })

    it('turns a synchronous remote configuration failure into undefined', async () => {
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: false,
            remoteConfigLoader: () => {
                throw new Error('sync failure')
            },
        })

        await expect(posthog.getRemoteConfig()).resolves.toBeUndefined()
    })

    it('loads remote configuration once and publishes it', async () => {
        const remoteConfig = createRemoteConfig({ hasFeatureFlags: true })
        const loader = jest.fn(async () => remoteConfig)
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: false,
            remoteConfigLoader: loader,
        })
        const changes: unknown[] = []
        posthog.onRemoteConfig((value) => changes.push(value))

        await expect(posthog.getRemoteConfig()).resolves.toBe(remoteConfig)
        await expect(posthog.getRemoteConfig()).resolves.toBe(remoteConfig)
        expect(loader).toHaveBeenCalledTimes(1)
        expect(changes).toEqual([{ ok: true, config: remoteConfig }])
    })

    it('loads remote configuration when an extension-facing listener subscribes', async () => {
        const remoteConfig = createRemoteConfig({ hasFeatureFlags: true })
        const loader = jest.fn(async () => remoteConfig)
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: false,
            remoteConfigLoader: loader,
        })

        const notification = new Promise<unknown>((resolve) => posthog.onRemoteConfig(resolve))
        await expect(notification).resolves.toEqual({ ok: true, config: remoteConfig })
        expect(loader).toHaveBeenCalledTimes(1)
    })

    it('blocks registration, requests, and persisted key-value mutation after disposal', async () => {
        const requests: SentRequest[] = []
        const storage = new MemoryStorage()
        const remoteConfigLoader = jest.fn(async () => createRemoteConfig())
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: createFetch(requests),
            remoteConfigLoader,
        })
        const events: string[] = []
        posthog.kv.set('before_dispose', true)
        await posthog.dispose()

        posthog.onEvent(({ event }) => events.push(event))
        posthog.registerDynamicEventProperties(() => ({ after_dispose: true }))
        await expect(posthog.sendRequest('/flags/')).resolves.toMatchObject({ statusCode: 0 })
        await expect(posthog.getRemoteConfig()).resolves.toBeUndefined()
        await posthog.capture('after_dispose')
        posthog.kv.set('after_dispose', true)
        posthog.kv.remove('before_dispose')

        expect(posthog.kv.get('before_dispose')).toBeUndefined()
        expect(posthog.kv.get('after_dispose')).toBeUndefined()
        const reloaded = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch: false })
        expect(reloaded.kv.get('before_dispose')).toBe(true)
        expect(reloaded.kv.get('after_dispose')).toBeUndefined()
        expect(requests).toHaveLength(0)
        expect(remoteConfigLoader).not.toHaveBeenCalled()
        expect(events).toHaveLength(0)
    })

    it('uses sendBeacon for unload requests', async () => {
        const sent: Array<{ url: string; data: BodyInit | null | undefined }> = []
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            fetch: false,
            navigator: {
                sendBeacon: (url, data) => {
                    sent.push({ url, data })
                    return true
                },
            },
        })

        const response = await posthog.sendRequest('/e/', {
            method: 'POST',
            body: { event: 'unload' },
            transport: 'sendBeacon',
        })
        expect(response).toMatchObject({ statusCode: 202 })
        expect(sent).toHaveLength(1)
        expect(new URL(sent[0]?.url ?? '').searchParams.get('token')).toBe('ph_test')
    })

    it('uses a different window id for each client in the same session', async () => {
        const storage = new MemoryStorage()
        const first = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch: false })
        const second = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch: false })

        expect(second.session.sessionId).toBe(first.session.sessionId)
        expect(second.session.windowId).not.toBe(first.session.windowId)
    })

    it('rotates an idle session when capture runs', async () => {
        const now = Date.now()
        const clock = jest.spyOn(Date, 'now').mockReturnValue(now)
        const posthog = await createPostHog({ projectToken: 'ph_test', storage: false, navigator: false, fetch: false })
        const sessions: string[] = []
        posthog.onNewSession((session) => sessions.push(session.reason))

        clock.mockReturnValue(now + 31 * 60 * 1000)
        await posthog.capture('after_idle')

        expect(sessions).toEqual(['idleTimeout'])
        clock.mockRestore()
    })

    it('preserves the device ID while rotating the anonymous ID on reset', async () => {
        const posthog = await createPostHog({ projectToken: 'ph_test', storage: false, navigator: false, fetch: false })
        const deviceId = posthog.deviceId

        posthog.reset()

        expect(posthog.deviceId).toBe(deviceId)
        expect(posthog.anonymousId).not.toBe(deviceId)
    })

    it('rotates identity and publishes reset session details', async () => {
        const posthog = await createPostHog({ projectToken: 'ph_test', storage: false, navigator: false, fetch: false })
        const originalId = posthog.anonymousId
        const sessions: string[] = []
        posthog.onNewSession((session) => sessions.push(`${session.reason}:${session.sessionId}`))

        posthog.reset()

        expect(posthog.anonymousId).not.toBe(originalId)
        expect(posthog.distinctId).toBe(posthog.anonymousId)
        expect(sessions).toEqual([`reset:${posthog.session.sessionId}`])
    })
})
