import type { AnalyticsOptions } from '../src/core/types'
import type { IPostHog } from '../src/core/types'
import { analyticsOf } from '../src/products/analytics/analytics-of'
import { BrowserState } from '../src/core/state/state'
import { EventBuffer } from '../src/products/analytics/admission/event-buffer'
import { ClientRateLimiter } from '../src/products/analytics/admission/rate-limiter'
import { createPostHog } from '../src/composition/npm/core'
import { createPostHog as createRootPostHog } from '../src/composition/npm'
import { createFetch, localRemoteConfig, MemoryStorage, type SentRequest } from './helpers'

const TOKEN = 'ph_session_properties'
const START = new Date('2026-01-01T00:00:00Z').getTime()
interface Event {
    event: string
    session_id?: string
    properties: Record<string, unknown>
}
const events = (requests: SentRequest[]): Event[] =>
    requests.flatMap((request) => (request.body?.batch ?? []) as Event[])
const clients: IPostHog[] = []
let local: MemoryStorage
let tab: MemoryStorage
const storedSessionProperty = (client: IPostHog, property: string): unknown => {
    const store = analyticsOf(client)?._core._sessionKv
    if (!store) throw new Error('Expected a client session store')
    const properties = store.get<Record<string, unknown>>('superProperties')
    return properties && Object.prototype.hasOwnProperty.call(properties, property) ? properties[property] : undefined
}

const create = async (memory = false, config: AnalyticsOptions = {}, projectToken = TOKEN) => {
    const requests: SentRequest[] = []
    const client = await createPostHog({
        projectToken,
        ...(memory ? { storage: false as const } : {}),
        navigator: false,
        fetch: createFetch(requests),
        capturePageview: false,
        remoteConfig: localRemoteConfig,
        analytics: { flushInterval: 0, ...config },
    })
    clients.push(client)
    return { client, requests }
}

beforeEach(() => {
    vi.useFakeTimers({ now: START })
    local = new MemoryStorage()
    tab = new MemoryStorage()
    const target = new EventTarget()
    vi.stubGlobal('localStorage', local)
    vi.stubGlobal('sessionStorage', tab)
    vi.stubGlobal('addEventListener', target.addEventListener.bind(target))
    vi.stubGlobal('removeEventListener', target.removeEventListener.bind(target))
    vi.stubGlobal('dispatchEvent', target.dispatchEvent.bind(target))
})
afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.dispose()))
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
})

describe('session registered properties', () => {
    it.each(['return', 'throw'] as const)(
        'preserves completed nested registration when an instrumented native read will %s',
        async (completion) => {
            const requests: SentRequest[] = []
            const client = await createRootPostHog({
                projectToken: TOKEN,
                navigator: false,
                fetch: createFetch(requests),
                capturePageview: false,
                remoteConfig: localRemoteConfig,
                analytics: { flushInterval: 0 },
                flags: false,
                logs: false,
                surveys: false,
                autocapture: false,
            })
            clients.push(client)
            const key = `ph_${TOKEN}_posthog_browser_v2_tab_analytics`
            tab.setItem(key, JSON.stringify({ superProperties: { nested: 'stale', retained: true } }))
            const read = tab.getItem.bind(tab)
            let callbacks = 0
            let armed = true
            vi.spyOn(tab, 'getItem').mockImplementation((storageKey) => {
                const raw = read(storageKey)
                if (storageKey === key && armed) {
                    armed = false
                    callbacks++
                    client.registerForSession({ nested: true })
                    if (completion === 'throw') throw new Error('Instrumented read failed after registration')
                }
                return raw
            })
            client.registerForSession({ outer: true })
            expect(callbacks).toBe(1)
            client.capture('reentrant_read')
            await client.flush()
            expect(events(requests)).toMatchObject([
                { event: 'reentrant_read', properties: { nested: true, outer: true, retained: true } },
            ])
        }
    )

    it('registers local context without creating a session or writing window identity', async () => {
        const { client, requests } = await create()
        client.registerForSession({ session_only: 'tab', nested: { value: 1 } })
        expect(storedSessionProperty(client, 'session_only')).toBe('tab')
        expect(client.session).toBeUndefined()
        expect(requests).toHaveLength(0)
        expect(tab.values.has(`ph_${TOKEN}_window_id`)).toBe(false)
        expect([...local.values.values()].join('')).not.toContain('session_only')
        expect(storedSessionProperty(client, 'nested')).toEqual({ value: 1 })
    })

    it('merges persistent, session, dynamic and caller context in order with SDK metadata last', async () => {
        const { client, requests } = await create()
        client.register({ context: 'persistent', fallback: 'persistent', nullable: 'persistent' })
        client.registerForSession({ context: 'session', fallback: 'session', nullable: null, $session_id: 'wrong' })
        client.registerDynamicEventProperties(() => ({ context: 'dynamic' }))
        client.capture('layered', { context: 'caller', removed: undefined })
        await client.flush()
        expect(events(requests)[0]?.properties).toMatchObject({
            context: 'caller',
            fallback: 'session',
        })
        expect(events(requests)[0]?.session_id).toBe(client.session?.sessionId)
        expect(events(requests)[0]?.properties).not.toHaveProperty('nullable')
        expect(events(requests)[0]?.properties).not.toHaveProperty('removed')
    })

    it.each([false, true])('survives reload with an admitted session=%s', async (admitted) => {
        const first = await create()
        first.client.registerForSession({ session_only: 'reload' })
        if (admitted) first.client.capture('before')
        await first.client.dispose()
        const second = await create()
        expect(storedSessionProperty(second.client, 'session_only')).toBe('reload')
        second.client.capture('reloaded')
        await second.client.flush()
        expect(events(second.requests)[0]?.properties.session_only).toBe('reload')
        second.client.unregisterForSession('session_only')
        await second.client.dispose()
        const third = await create()
        expect(storedSessionProperty(third.client, 'session_only')).toBeUndefined()
    })

    it('removes a session override without changing persistent fallback or other session keys', async () => {
        const { client, requests } = await create()
        client.register({ context: 'persistent' })
        client.registerForSession({ context: 'session', retained: true })
        client.unregisterForSession('context')
        client.unregisterForSession('missing')
        expect(storedSessionProperty(client, 'context')).toBeUndefined()
        expect(client.getProperty('context')).toBe('persistent')
        expect(storedSessionProperty(client, 'retained')).toBe(true)
        client.capture('fallback')
        await client.flush()
        expect(events(requests)[0]?.properties).toMatchObject({ context: 'persistent', retained: true })
    })

    it('isolates independent tabs while sharing persistent properties', async () => {
        const first = await create()
        first.client.register({ shared: true })
        first.client.registerForSession({ owner: 'first' })
        first.client.capture('first')
        vi.stubGlobal('sessionStorage', new MemoryStorage())
        const second = await create()
        expect(second.client.getProperty('shared')).toBe(true)
        expect(storedSessionProperty(second.client, 'owner')).toBeUndefined()
        second.client.registerForSession({ owner: 'second' })
        second.client.capture('second')
        expect(storedSessionProperty(first.client, 'owner')).toBe('first')
        await second.client.flush()
        expect(events(second.requests)[0]?.properties.owner).toBe('second')
    })

    it.each(['idle', 'maximum'] as const)(
        'excludes old session context from the first event after %s rotation',
        async (kind) => {
            const { client, requests } = await create()
            client.register({ persistent: true })
            client.registerForSession({ old_session: true })
            client.capture('before')
            const old = client.session?.sessionId
            if (kind === 'maximum') {
                for (let minute = 20; minute <= 1440; minute += 20) {
                    vi.setSystemTime(START + minute * 60_000 - 1)
                    client.capture('active')
                }
                expect(storedSessionProperty(client, 'old_session')).toBe(true)
                vi.setSystemTime(START + 86_400_001)
            } else vi.setSystemTime(START + 1_800_001)
            client.capture('rotated')
            await client.flush()
            expect(client.session?.sessionId).not.toBe(old)
            expect(events(requests).at(-1)?.properties).toMatchObject({ persistent: true })
            expect(events(requests).at(-1)?.properties).not.toHaveProperty('old_session')
            expect(storedSessionProperty(client, 'old_session')).toBeUndefined()
        }
    )

    it.each(['idle', 'maximum'] as const)(
        'keeps fresh registrations pending after %s expiry without advancing the session',
        async (kind) => {
            const { client, requests } = await create()
            client.registerForSession({ old_session: true })
            client.capture('first')
            if (kind === 'maximum') {
                for (let minute = 20; minute <= 1440; minute += 20) {
                    vi.setSystemTime(START + minute * 60_000 - 1)
                    client.capture('active')
                }
            }
            const previous = client.session
            vi.setSystemTime(START + (kind === 'idle' ? 1_800_001 : 86_400_001))
            client.registerForSession({ flow: 'checkout', discarded: true })
            client.registerForSession({ fresh: true })
            client.unregisterForSession('discarded')
            expect(client.session).toEqual(previous)
            client.capture('checkout_started')
            await client.flush()
            expect(client.session?.sessionId).not.toBe(previous?.sessionId)
            expect(events(requests).at(-1)?.properties).toMatchObject({ flow: 'checkout', fresh: true })
            expect(events(requests).at(-1)?.properties).not.toHaveProperty('old_session')
            expect(events(requests).at(-1)?.properties).not.toHaveProperty('discarded')
        }
    )

    it('retains fresh pending registration through a rejected expired-session capture', async () => {
        const { client, requests } = await create()
        client.capture('first')
        await client.flush()
        const previous = client.session
        vi.setSystemTime(START + 1_800_001)
        client.optOut()
        client.registerForSession({ flow: 'checkout' })
        client.capture('denied')
        expect(client.session).toEqual(previous)
        client.optIn()
        client.capture('admitted')
        await client.flush()
        expect(events(requests).map(({ event }) => event)).toEqual(['first', 'admitted'])
        expect(events(requests).at(-1)?.properties.flow).toBe('checkout')
    })

    it('binds fresh pending properties to an active session adopted from another tab', async () => {
        const first = await create()
        first.client.registerForSession({ old_session: true })
        first.client.capture('first')
        vi.setSystemTime(START + 1_800_001)
        vi.stubGlobal('sessionStorage', new MemoryStorage())
        const second = await create()
        second.client.capture('other_tab')
        const adopted = second.client.session?.sessionId
        first.client.registerForSession({ flow: 'checkout' })
        first.client.capture('adopted')
        await first.client.flush()
        expect(first.client.session?.sessionId).toBe(adopted)
        expect(events(first.requests).at(-1)?.properties.flow).toBe('checkout')
        expect(events(first.requests).at(-1)?.properties).not.toHaveProperty('old_session')
    })

    it("uses another tab's activity before treating the shared session as expired", async () => {
        const first = await create()
        first.client.registerForSession({ retained: true })
        first.client.capture('first')
        const sessionId = first.client.session?.sessionId
        vi.setSystemTime(START + 1_200_000)
        vi.stubGlobal('sessionStorage', new MemoryStorage())
        const second = await create()
        second.client.capture('active_elsewhere')
        vi.setSystemTime(START + 1_800_001)
        first.client.registerForSession({ flow: 'checkout' })
        first.client.capture('checkout_started')
        await first.client.flush()
        expect(first.client.session?.sessionId).toBe(sessionId)
        expect(events(first.requests).at(-1)?.properties).toMatchObject({ retained: true, flow: 'checkout' })
    })

    it('registers fresh properties for a newer active session from another tab', async () => {
        const first = await create()
        first.client.registerForSession({ old_session: true })
        first.client.capture('first')
        vi.setSystemTime(START + 60_000)
        vi.stubGlobal('sessionStorage', new MemoryStorage())
        const second = await create()
        second.client.reset()
        second.client.capture('new')
        first.client.registerForSession({ flow: 'checkout' })
        first.client.capture('checkout_started')
        await first.client.flush()
        expect(first.client.session?.sessionId).toBe(second.client.session?.sessionId)
        expect(events(first.requests).at(-1)?.properties.flow).toBe('checkout')
        expect(events(first.requests).at(-1)?.properties).not.toHaveProperty('old_session')
    })

    it('drops old context when adopting another tab session', async () => {
        const first = await create()
        first.client.registerForSession({ old_session: true })
        first.client.capture('old')
        vi.stubGlobal('sessionStorage', new MemoryStorage())
        const second = await create()
        second.client.reset()
        second.client.capture('new')
        await second.client.flush()
        first.client.capture('adopted')
        await first.client.flush()
        expect(events(first.requests).at(-1)?.properties).not.toHaveProperty('old_session')
    })

    it('preserves scope on rejected captures and clears it only after an admitted rotation', async () => {
        const { client, requests } = await create()
        client.registerForSession({ old_session: true })
        client.capture('first')
        const old = client.session
        const persisted = [...tab.values.entries()]
        vi.setSystemTime(START + 1_800_001)
        client.capture('oversized', { value: 'a'.repeat(8 * 1024 * 1024) })
        expect(client.session).toEqual(old)
        expect([...tab.values.entries()]).toEqual(persisted)
        expect(storedSessionProperty(client, 'old_session')).toBe(true)
        client.capture('admitted')
        await client.flush()
        expect(events(requests).at(-1)?.properties).not.toHaveProperty('old_session')
    })

    it('preserves group-only context cleanup and clears session properties on full reset', async () => {
        const { client, requests } = await create()
        client.registerForSession({ session_only: true })
        client.resetGroups()
        expect(storedSessionProperty(client, 'session_only')).toBe(true)
        client.reset()
        expect(storedSessionProperty(client, 'session_only')).toBeUndefined()
        client.capture('reset')
        await client.flush()
        expect(events(requests)[0]?.properties).not.toHaveProperty('session_only')
    })

    it('uses the post-serialization session authority and keeps explicit undefined overrides', async () => {
        const { client, requests } = await create()
        client.registerForSession({ old_session: true, removed: 'session' })
        client.capture('reentrant', {
            get value() {
                client.reset()
                client.registerForSession({ fresh: true, removed: 'session' })
                return 'caller'
            },
            removed: undefined,
        })
        await client.flush()
        expect(events(requests)[0]?.properties).toMatchObject({ fresh: true, value: 'caller' })
        expect(events(requests)[0]?.properties).not.toHaveProperty('old_session')
        expect(events(requests)[0]?.properties).not.toHaveProperty('removed')
    })

    it('does not persist an unused session-property namespace', async () => {
        const { client } = await create()
        client.capture('ordinary')
        await client.flush()
        expect(
            [...tab.values.keys()].every((key) => key.endsWith('_window_id') || key.endsWith('_primary_window_exists'))
        ).toBe(true)
    })

    it('ignores a throwing root serializer without rejecting ordinary properties', async () => {
        const { client, requests } = await create()
        const serialize = vi.fn(() => {
            throw new Error('unavailable serializer')
        })
        client.capture('ordinary', { caller: true, toJSON: serialize })
        await client.flush()
        expect(serialize).not.toHaveBeenCalled()
        expect(events(requests)).toMatchObject([{ event: 'ordinary', properties: { caller: true } }])
        expect(events(requests)[0]?.properties).not.toHaveProperty('toJSON')
    })

    it('allows a session value to shrink an oversized persistent default', async () => {
        const { client, requests } = await create()
        client.register({ value: 'a'.repeat(8 * 1024 * 1024) })
        client.registerForSession({ value: 'small' })
        client.capture('small')
        await client.flush()
        expect(events(requests)[0]?.properties.value).toBe('small')
    })

    it.each(['capture', 'captureImmediate'] as const)(
        '%s admits exactly the byte limit when a session value removes a persistent default',
        async (method) => {
            const { client, requests } = await create()
            const uuid = '12345678-1234-4234-8234-123456789abc'
            const timestamp = new Date(START)
            const observed: Record<string, unknown>[] = []
            client.onEvent(({ properties }) => observed.push(properties))
            client.capture('exact', { value: '' }, { uuid, timestamp })
            await client.flush()
            const base = JSON.stringify({
                uuid,
                event: 'exact',
                distinct_id: client.distinctId,
                properties: observed[0],
                timestamp: timestamp.toISOString(),
            }).length
            client.register({ extra: 'discard' })
            client.registerForSession({ extra: null })
            const value = 'a'.repeat(8 * 1024 * 1024 - base)
            await client[method]('exact', { value }, { uuid, timestamp })
            expect(observed).toHaveLength(2)
            await client.flush()
            expect(events(requests).at(-1)?.properties.value).toBe(value)
            expect(events(requests).at(-1)?.properties).not.toHaveProperty('extra')
            await client[method]('exact', { value: value + 'a' }, { uuid, timestamp })
            await client.flush()
            expect(observed).toHaveLength(2)
            expect(events(requests)).toHaveLength(2)
        }
    )

    it.each([
        ['capture', 'caller'],
        ['capture', 'dynamic'],
        ['captureImmediate', 'caller'],
        ['captureImmediate', 'dynamic'],
    ] as const)('%s ignores a %s root serializer while retaining context', async (method, source) => {
        const { client, requests } = await create()
        client.register({ persistent: true })
        client.registerForSession({ session_default: true })
        const serialize = vi.fn(() => ({ custom: true }))
        client.registerDynamicEventProperties(() => ({
            dynamic: true,
            ...(source === 'dynamic' ? { toJSON: serialize } : {}),
        }))
        await client[method]('custom', { caller: true, ...(source === 'caller' ? { toJSON: serialize } : {}) })
        await client.flush()
        expect(serialize).not.toHaveBeenCalled()
        expect(events(requests)[0]?.properties).toMatchObject({
            persistent: true,
            session_default: true,
            dynamic: true,
            caller: true,
        })
        expect(events(requests)[0]?.properties).not.toHaveProperty('toJSON')
        expect(events(requests)[0]?.properties).not.toHaveProperty('custom')
    })

    it('keeps session storage optional for memory-only clients and failed native access', async () => {
        const memory = await create(true)
        memory.client.registerForSession({ ephemeral: true })
        expect(storedSessionProperty(memory.client, 'ephemeral')).toBe(true)
        expect(tab.values.size).toBe(0)
        await memory.client.dispose()
        const fresh = await create(true)
        expect(storedSessionProperty(fresh.client, 'ephemeral')).toBeUndefined()
        vi.stubGlobal('sessionStorage', {
            getItem() {
                throw new Error('denied')
            },
            setItem() {
                throw new Error('denied')
            },
            removeItem() {
                throw new Error('denied')
            },
        })
        const denied = await create()
        expect(() => denied.client.registerForSession({ fallback: true })).not.toThrow()
        denied.client.capture('fallback')
        await denied.client.flush()
        expect(events(denied.requests)[0]?.properties.fallback).toBe(true)
    })

    it('does not send an immediate capture when caller serialization shuts the client down', async () => {
        const { client, requests } = await create()
        const disposal: Promise<void>[] = []
        const summary = await client.captureImmediate('disposed_during_serialization', {
            value: {
                toJSON() {
                    disposal.push(client.dispose())
                    return 'caller'
                },
            },
        })
        await Promise.all(disposal)
        expect(disposal).toHaveLength(1)
        expect(summary.error).toBeDefined()
        expect(summary.submitted).toBe(0)
        expect(requests).toHaveLength(0)
        expect(client.canCapture).toBe(false)
    })

    it.each(['capture', 'reset'] as const)('contains disposal from a storage callback during %s', async (operation) => {
        const backing = new MemoryStorage()
        let armed = false
        const client = await createPostHog({
            projectToken: TOKEN,
            navigator: false,
            fetch: false,
            capturePageview: false,
            remoteConfig: localRemoteConfig,
            analytics: { flushInterval: 0 },
            storage: {
                getItem: (key) => backing.getItem(key),
                removeItem: (key) => backing.removeItem(key),
                setItem(key, value) {
                    backing.setItem(key, value)
                    if (armed) {
                        armed = false
                        void client.dispose()
                    }
                },
            },
        })
        clients.push(client)
        armed = true
        expect(() => {
            if (operation === 'capture') client.capture('during_dispose')
            else client.reset()
        }).not.toThrow()
        expect(armed).toBe(false)
    })

    it('contains malformed input and makes a disposed client inert', async () => {
        const { client } = await create()
        const revoked = Proxy.revocable({}, {})
        revoked.revoke()
        expect(() => client.registerForSession(revoked.proxy)).not.toThrow()
        client.registerForSession({ retained: true })
        expect(storedSessionProperty(client, 'toString')).toBeUndefined()
        await client.dispose()
        expect(() => client.unregisterForSession('retained')).not.toThrow()
        expect(storedSessionProperty(client, 'retained')).toBeUndefined()
    })
})

describe('session property admission and lifecycle', () => {
    const TAB_KEY = `ph_${TOKEN}_posthog_browser_v2_tab_analytics`

    it.each(['invalid', 'serialization', 'rate', 'buffer', 'oversize', 'commit'] as const)(
        'retains pending and current scopes on %s rejection',
        async (reason) => {
            const { client, requests } = await create()
            const reject = () => {
                if (reason === 'rate')
                    return vi.spyOn(ClientRateLimiter.prototype, 'consume').mockReturnValue({ allowed: false })
                if (reason === 'buffer') return vi.spyOn(EventBuffer.prototype, 'enqueue').mockReturnValue(false)
                if (reason === 'commit')
                    return vi.spyOn(BrowserState.prototype, 'sessionAdmitted').mockReturnValue(false)
                return undefined
            }
            const capture = () => {
                if (reason === 'invalid') client.capture('')
                else if (reason === 'serialization') client.capture('invalid', { value: 1n })
                else if (reason === 'oversize') client.capture('oversize', { value: 'a'.repeat(8 * 1024 * 1024) })
                else client.capture('rejected')
            }
            client.registerForSession({ pending: true })
            const pending = tab.getItem(TAB_KEY)
            let fault = reject()
            capture()
            expect(client.session).toBeUndefined()
            expect(tab.getItem(TAB_KEY)).toBe(pending)
            expect(storedSessionProperty(client, 'pending')).toBe(true)
            fault?.mockRestore()
            client.capture('first')
            const current = client.session
            const labelled = tab.getItem(TAB_KEY)
            expect(JSON.parse(labelled ?? '{}')).toEqual({
                superProperties: { pending: true },
                sessionId: current?.sessionId,
            })
            vi.setSystemTime(START + 1_800_001)
            fault = reject()
            capture()
            expect(client.session).toEqual(current)
            expect(tab.getItem(TAB_KEY)).toBe(labelled)
            expect(storedSessionProperty(client, 'pending')).toBe(true)
            fault?.mockRestore()
            client.capture('rotated')
            await client.flush()
            expect(events(requests).map(({ event }) => event)).toEqual(['first', 'rotated'])
            expect(events(requests).at(-1)?.properties).not.toHaveProperty('pending')
            expect(storedSessionProperty(client, 'pending')).toBeUndefined()
            expect(JSON.parse(tab.getItem(TAB_KEY) ?? '{}')).toEqual({
                superProperties: {},
                sessionId: client.session?.sessionId,
            })
        }
    )

    it('labels pending values before session observers and preserves their nested updates', async () => {
        const { client, requests } = await create()
        client.reset()
        client.registerForSession({ pending: true })
        let first = true
        client.onNewSession(() => {
            if (!first) return
            first = false
            expect(JSON.parse(tab.getItem(TAB_KEY) ?? '{}').sessionId).toBe(client.session?.sessionId)
            expect(storedSessionProperty(client, 'pending')).toBe(true)
            client.unregisterForSession('pending')
            client.registerForSession({ nested: true })
            client.capture('nested')
        })
        client.capture('outer')
        await client.flush()
        expect(first).toBe(false)
        expect(events(requests)).toMatchObject([
            { event: 'outer', properties: { pending: true } },
            { event: 'nested', properties: { nested: true } },
        ])
        expect(storedSessionProperty(client, 'pending')).toBeUndefined()
        expect(storedSessionProperty(client, 'nested')).toBe(true)
    })

    it('clears rotated scope before session and event observers, without overwriting reentrant registration', async () => {
        const { client, requests } = await create()
        client.registerForSession({ old: true })
        client.capture('first')
        vi.setSystemTime(START + 1_800_001)
        client.onNewSession(() => {
            expect(storedSessionProperty(client, 'old')).toBeUndefined()
            client.registerForSession({ fresh: true })
        })
        client.onEvent(({ event }) => {
            if (event !== 'outer') return
            expect(storedSessionProperty(client, 'fresh')).toBe(true)
            client.capture('nested')
        })
        client.capture('outer')
        await client.flush()
        expect(events(requests).map(({ event }) => event)).toEqual(['first', 'outer', 'nested'])
        expect(events(requests)[1]?.properties).not.toHaveProperty('old')
        expect(events(requests)[1]?.properties).not.toHaveProperty('fresh')
        expect(events(requests)[2]?.properties.fresh).toBe(true)
        expect(storedSessionProperty(client, 'fresh')).toBe(true)
    })

    it.each(['capture', 'captureImmediate'] as const)('%s retains finalized session snapshots', async (method) => {
        const { client, requests } = await create()
        const value = { count: 1 }
        client.registerForSession({ value, removed: true, $set: { wrong: true } })
        const observed: Record<string, unknown>[] = []
        client.onEvent(({ properties }) => {
            observed.push(properties)
            client.registerForSession({ value: { count: 9 } })
            client.unregisterForSession('removed')
        })
        const pending = client[method]('snapshot', null, { set: { correct: true } })
        value.count = 7
        await pending
        await client.flush()
        expect(events(requests)).toMatchObject([
            { event: 'snapshot', properties: { value: { count: 1 }, removed: true, $set: { correct: true } } },
        ])
        expect(observed).toMatchObject([{ value: { count: 1 }, removed: true, $set: { correct: true } }])
        expect(storedSessionProperty(client, 'value')).toEqual({ count: 9 })
    })

    it('keeps local session context under denial and never mode without reading or creating session/window context', async () => {
        const { client, requests } = await create(false, { personProfiles: 'never' })
        client.optOut()
        const read = vi.spyOn(BrowserState.prototype, 'session', 'get')
        const prepare = vi.spyOn(BrowserState.prototype, 'prepareSessionForEvent')
        client.registerForSession({ retained: true, removed: true })
        client.unregisterForSession('removed')
        expect(storedSessionProperty(client, 'retained')).toBe(true)
        client.capture('denied')
        expect(read).not.toHaveBeenCalled()
        expect(prepare).not.toHaveBeenCalled()
        expect(requests).toHaveLength(0)
        expect(tab.values.has(`ph_${TOKEN}_window_id`)).toBe(false)
        client.optIn()
        client.capture('allowed')
        await client.flush()
        expect(events(requests)).toMatchObject([{ event: 'allowed', properties: { retained: true } }])
        await client.dispose()
        client.registerForSession({ late: true })
        client.unregisterForSession('retained')
        expect(storedSessionProperty(client, 'late')).toBeUndefined()
    })

    it('rechecks readiness and ownership after registration serialization', async () => {
        const { client } = await create()
        const prepare = vi.spyOn(BrowserState.prototype, 'prepare').mockReturnValue(false)
        const skipped = vi.fn(() => ({ skipped: true }))
        client.registerForSession({ toJSON: skipped })
        expect(skipped).not.toHaveBeenCalled()
        prepare.mockReturnValue(true)
        client.registerForSession({
            toJSON() {
                prepare.mockReturnValue(false)
                return { late: true }
            },
        })
        prepare.mockRestore()
        expect(storedSessionProperty(client, 'late')).toBeUndefined()
        const disposing: Promise<void>[] = []
        client.registerForSession({
            toJSON() {
                disposing.push(client.dispose())
                return { late: true }
            },
        })
        await Promise.all(disposing)
        const fresh = await create()
        expect(storedSessionProperty(fresh.client, 'late')).toBeUndefined()
    })

    it('serializes registration once and merges nested local mutations with own prototype keys', async () => {
        const { client } = await create()
        client.registerForSession({ removed: true })
        const serialize = vi.fn(() => {
            client.unregisterForSession('removed')
            client.registerForSession({ nested: true })
            return JSON.parse('{"__proto__":{"own":true},"constructor":"application","prototype":"own","":"empty"}')
        })
        client.registerForSession({ toJSON: serialize })
        expect(serialize).toHaveBeenCalledTimes(1)
        expect(storedSessionProperty(client, 'removed')).toBeUndefined()
        expect(storedSessionProperty(client, 'nested')).toBe(true)
        expect(storedSessionProperty(client, '__proto__')).toEqual({ own: true })
        expect(storedSessionProperty(client, 'constructor')).toBe('application')
        expect(storedSessionProperty(client, 'prototype')).toBe('own')
        expect(storedSessionProperty(client, '')).toBe('empty')
        expect(storedSessionProperty(client, 'toString')).toBeUndefined()
        client.unregisterForSession('__proto__')
        client.unregisterForSession('')
        expect(storedSessionProperty(client, '__proto__')).toBeUndefined()
        expect(storedSessionProperty(client, '')).toBeUndefined()
    })

    it('isolates projects and lets copied tabs inherit then diverge without sharing window identity', async () => {
        const first = await create()
        first.client.registerForSession({ owner: 'opener' })
        first.client.capture('opener')
        const copied = new MemoryStorage()
        for (const [key, value] of tab.values) copied.setItem(key, value)
        vi.stubGlobal('sessionStorage', copied)
        const duplicate = await create()
        expect(storedSessionProperty(duplicate.client, 'owner')).toBe('opener')
        duplicate.client.capture('duplicate')
        expect(duplicate.client.session?.sessionId).toBe(first.client.session?.sessionId)
        expect(duplicate.client.session?.windowId).not.toBe(first.client.session?.windowId)
        duplicate.client.registerForSession({ owner: 'copied' })
        expect(storedSessionProperty(first.client, 'owner')).toBe('opener')
        const other = await create(false, {}, 'ph_other_project')
        expect(storedSessionProperty(other.client, 'owner')).toBeUndefined()
        other.client.registerForSession({ owner: 'other' })
        expect(storedSessionProperty(duplicate.client, 'owner')).toBe('copied')
    })

    it.each(['read', 'write', 'malformed'] as const)(
        'keeps the tab buffer usable after native %s failure',
        async (failure) => {
            if (failure === 'malformed') tab.setItem(TAB_KEY, '{broken')
            const fault =
                failure === 'read'
                    ? vi.spyOn(tab, 'getItem').mockImplementation(() => {
                          throw new Error('denied')
                      })
                    : failure === 'write'
                      ? vi.spyOn(tab, 'setItem').mockImplementation(() => {
                            throw new Error('denied')
                        })
                      : undefined
            const { client, requests } = await create()
            client.registerForSession({ first: { count: 1 } })
            client.unregisterForSession('missing')
            expect(storedSessionProperty(client, 'first')).toEqual({ count: 1 })
            fault?.mockRestore()
            client.registerForSession({ second: true })
            client.capture('fallback')
            await client.flush()
            expect(events(requests)).toMatchObject([{ properties: { first: { count: 1 }, second: true } }])
        }
    )
})

describe('session enrichment preserves person admission and caller serialization', () => {
    it.each(['onEvent', 'onNewSession'] as const)(
        'keeps nested person invalidation from %s after committing a pending scope',
        async (notification) => {
            const { client, requests } = await create()
            if (notification === 'onNewSession') client.reset()
            client.registerForSession({ context: true })
            let nested = false
            const unset = () => {
                if (nested) return
                nested = true
                expect(storedSessionProperty(client, 'context')).toBe(true)
                client.unsetPersonProperties('plan')
            }
            if (notification === 'onEvent') client.onEvent(unset)
            else client.onNewSession(unset)
            client.setPersonProperties({ plan: 'paid' })
            client.setPersonProperties({ plan: 'paid' })
            await client.flush()
            expect(nested).toBe(true)
            expect(events(requests).map(({ properties }) => [properties.$set, properties.$unset])).toEqual([
                [{ plan: 'paid' }, undefined],
                [undefined, ['plan']],
                [{ plan: 'paid' }, undefined],
            ])
            for (const event of events(requests)) expect(event.properties.context).toBe(true)
        }
    )

    it('commits person deduplication before session-storage callbacks can invalidate it', async () => {
        const { client, requests } = await create()
        client.registerForSession({ pending: true })
        const write = tab.setItem.bind(tab)
        let nested = false
        vi.spyOn(tab, 'setItem').mockImplementation((key, value) => {
            write(key, value)
            if (!key.endsWith('_tab_analytics') || nested) return
            nested = true
            client.unsetPersonProperties('plan')
        })
        client.setPersonProperties({ plan: 'paid' })
        client.setPersonProperties({ plan: 'paid' })
        await client.flush()
        expect(events(requests).map(({ properties }) => [properties.$set, properties.$unset])).toEqual([
            [{ plan: 'paid' }, undefined],
            [undefined, ['plan']],
            [{ plan: 'paid' }, undefined],
        ])
    })

    it.each(['capture', 'captureImmediate'] as const)(
        '%s preserves null, undefined and nested serializer precedence over session values',
        async (method) => {
            const { client, requests } = await create()
            client.register({ nullable: 'persistent', missing: 'persistent', dynamic: 'persistent' })
            client.registerForSession({
                nullable: 'session',
                missing: 'session',
                dynamic: 'session',
                data: { drop: null, items: [null, { drop: null }] },
            })
            client.registerDynamicEventProperties(() => ({ dynamic: null }))
            const serializer = vi.fn(() => ({ drop: null, items: [null, { drop: null }], keep: true }))
            const observed: Record<string, unknown>[] = []
            client.onEvent(({ properties }) => observed.push(properties))
            await client[method]('serialization', {
                nullable: null,
                missing: undefined,
                converted: { toJSON: serializer },
            })
            await client.flush()
            expect(serializer).toHaveBeenCalledTimes(1)
            const properties = events(requests)[0]?.properties
            expect(properties).not.toHaveProperty('nullable')
            expect(properties).not.toHaveProperty('missing')
            expect(properties).not.toHaveProperty('dynamic')
            expect(properties).toMatchObject({
                data: { items: [null, {}] },
                converted: { items: [null, {}], keep: true },
            })
            expect(observed).toMatchObject([
                {
                    nullable: null,
                    dynamic: null,
                    data: { drop: null, items: [null, { drop: null }] },
                    converted: { drop: null, items: [null, { drop: null }], keep: true },
                },
            ])
        }
    )

    it.each(['capture', 'captureImmediate'] as const)(
        '%s cannot shrink an explicit oversized caller value using session defaults',
        async (method) => {
            const { client, requests } = await create()
            client.registerForSession({ value: 'small' })
            await client[method]('oversized', { value: 'a'.repeat(8 * 1024 * 1024) })
            await client.flush()
            expect(events(requests)).toHaveLength(0)
            expect(client.session).toBeUndefined()
            expect(storedSessionProperty(client, 'value')).toBe('small')
        }
    )
})

describe('session reset storage callbacks', () => {
    it('retains an admitted nested person setter while clearing session context', async () => {
        const { client, requests } = await create()
        client.registerForSession({ before: true })
        const write = tab.setItem.bind(tab)
        let nested = false
        vi.spyOn(tab, 'setItem').mockImplementation((key, value) => {
            write(key, value)
            if (!key.endsWith('_tab_analytics') || nested) return
            nested = true
            client.setPersonProperties({ plan: 'paid' })
        })
        client.reset()
        client.setPersonProperties({ plan: 'paid' })
        await client.flush()
        expect(events(requests)).toHaveLength(1)
        expect(events(requests)[0]?.properties.$set).toEqual({ plan: 'paid' })
        expect(events(requests)[0]?.properties).not.toHaveProperty('before')
    })
})

describe('protected session capture metadata size', () => {
    it.each(['capture', 'captureImmediate'] as const)(
        '%s cannot shrink oversized Core group metadata using a session override',
        async (method) => {
            const { client, requests } = await create(true)
            client.registerForSession({ $groups: null })
            client.group('organization', 'a'.repeat(8 * 1024 * 1024))
            await client[method]('oversized_metadata')
            await client.flush()
            expect(events(requests)).toHaveLength(0)
            expect(client.session).toBeUndefined()
            expect(storedSessionProperty(client, '$groups')).toBeNull()
        }
    )
})
