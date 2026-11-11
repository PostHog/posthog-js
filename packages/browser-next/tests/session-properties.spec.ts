import type { KeyValueStore } from '@posthog/browser-common'
import { analytics, type AnalyticsOptions } from '../src/products/analytics/analytics'
import { isAnalyticsExtension } from '../src/products/analytics/analytics-internal'
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
const clients: Array<Awaited<ReturnType<typeof createPostHog>>> = []
let local: MemoryStorage
let tab: MemoryStorage
const sessionStores = new WeakMap<object, KeyValueStore>()
const storedSessionProperty = (product: object, property: string): unknown => {
    const store = sessionStores.get(product)
    if (!store) throw new Error('Expected a bound session store')
    const properties = store.get<Record<string, unknown>>('superProperties')
    return properties && Object.prototype.hasOwnProperty.call(properties, property) ? properties[property] : undefined
}

const create = async (memory = false, config: AnalyticsOptions = {}, projectToken = TOKEN) => {
    const requests: SentRequest[] = []
    const product = analytics({ flushInterval: 0, ...config })
    if (!isAnalyticsExtension(product)) throw new Error('Expected an internal analytics owner')
    const bind = product.bindCaptureHost
    vi.spyOn(product, 'bindCaptureHost').mockImplementation((host) => {
        sessionStores.set(product, host.sessionKv)
        bind(host)
    })
    const client = await createPostHog({
        projectToken,
        ...(memory ? { storage: false as const } : {}),
        navigator: false,
        fetch: createFetch(requests),
        capturePageview: false,
        remoteConfig: localRemoteConfig,
        extensions: [product],
    })
    clients.push(client)
    return { client, product, requests }
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
            const product = await client.resolveExtension('analytics')
            if (!product) throw new Error('Expected acquired analytics')
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
                    product.registerForSession({ nested: true })
                    if (completion === 'throw') throw new Error('Instrumented read failed after registration')
                }
                return raw
            })
            product.registerForSession({ outer: true })
            expect(callbacks).toBe(1)
            product.capture('reentrant_read')
            await client.flush()
            expect(events(requests)).toMatchObject([
                { event: 'reentrant_read', properties: { nested: true, outer: true, retained: true } },
            ])
        }
    )

    it('registers local context without creating a session or writing window identity', async () => {
        const { product, client, requests } = await create()
        product.registerForSession({ session_only: 'tab', nested: { value: 1 } })
        expect(storedSessionProperty(product, 'session_only')).toBe('tab')
        expect(client.session).toBeUndefined()
        expect(requests).toHaveLength(0)
        expect(tab.values.has(`ph_${TOKEN}_window_id`)).toBe(false)
        expect([...local.values.values()].join('')).not.toContain('session_only')
        expect(storedSessionProperty(product, 'nested')).toEqual({ value: 1 })
    })

    it('merges persistent, session, dynamic and caller context in order with SDK metadata last', async () => {
        const { product, client, requests } = await create()
        product.register({ context: 'persistent', fallback: 'persistent', nullable: 'persistent' })
        product.registerForSession({ context: 'session', fallback: 'session', nullable: null, $session_id: 'wrong' })
        product.registerDynamicEventProperties(() => ({ context: 'dynamic' }))
        product.capture('layered', { context: 'caller', removed: undefined })
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
        first.product.registerForSession({ session_only: 'reload' })
        if (admitted) first.product.capture('before')
        await first.client.dispose()
        const second = await create()
        expect(storedSessionProperty(second.product, 'session_only')).toBe('reload')
        second.product.capture('reloaded')
        await second.client.flush()
        expect(events(second.requests)[0]?.properties.session_only).toBe('reload')
        second.product.unregisterForSession('session_only')
        await second.client.dispose()
        const third = await create()
        expect(storedSessionProperty(third.product, 'session_only')).toBeUndefined()
    })

    it('removes a session override without changing persistent fallback or other session keys', async () => {
        const { client, product, requests } = await create()
        product.register({ context: 'persistent' })
        product.registerForSession({ context: 'session', retained: true })
        product.unregisterForSession('context')
        product.unregisterForSession('missing')
        expect(storedSessionProperty(product, 'context')).toBeUndefined()
        expect(product.getProperty('context')).toBe('persistent')
        expect(storedSessionProperty(product, 'retained')).toBe(true)
        product.capture('fallback')
        await client.flush()
        expect(events(requests)[0]?.properties).toMatchObject({ context: 'persistent', retained: true })
    })

    it('isolates independent tabs while sharing persistent properties', async () => {
        const first = await create()
        first.product.register({ shared: true })
        first.product.registerForSession({ owner: 'first' })
        first.product.capture('first')
        vi.stubGlobal('sessionStorage', new MemoryStorage())
        const second = await create()
        expect(second.product.getProperty('shared')).toBe(true)
        expect(storedSessionProperty(second.product, 'owner')).toBeUndefined()
        second.product.registerForSession({ owner: 'second' })
        second.product.capture('second')
        expect(storedSessionProperty(first.product, 'owner')).toBe('first')
        await second.client.flush()
        expect(events(second.requests)[0]?.properties.owner).toBe('second')
    })

    it.each(['idle', 'maximum'] as const)(
        'excludes old session context from the first event after %s rotation',
        async (kind) => {
            const { client, product, requests } = await create()
            product.register({ persistent: true })
            product.registerForSession({ old_session: true })
            product.capture('before')
            const old = client.session?.sessionId
            if (kind === 'maximum') {
                for (let minute = 20; minute <= 1440; minute += 20) {
                    vi.setSystemTime(START + minute * 60_000 - 1)
                    product.capture('active')
                }
                expect(storedSessionProperty(product, 'old_session')).toBe(true)
                vi.setSystemTime(START + 86_400_001)
            } else vi.setSystemTime(START + 1_800_001)
            product.capture('rotated')
            await client.flush()
            expect(client.session?.sessionId).not.toBe(old)
            expect(events(requests).at(-1)?.properties).toMatchObject({ persistent: true })
            expect(events(requests).at(-1)?.properties).not.toHaveProperty('old_session')
            expect(storedSessionProperty(product, 'old_session')).toBeUndefined()
        }
    )

    it('drops old context when adopting another tab session', async () => {
        const first = await create()
        first.product.registerForSession({ old_session: true })
        first.product.capture('old')
        vi.stubGlobal('sessionStorage', new MemoryStorage())
        const second = await create()
        second.product.reset()
        second.product.capture('new')
        await second.client.flush()
        first.product.capture('adopted')
        await first.client.flush()
        expect(events(first.requests).at(-1)?.properties).not.toHaveProperty('old_session')
    })

    it('preserves scope on rejected captures and clears it only after an admitted rotation', async () => {
        const { client, product, requests } = await create()
        product.registerForSession({ old_session: true })
        product.capture('first')
        const old = client.session
        const persisted = [...tab.values.entries()]
        vi.setSystemTime(START + 1_800_001)
        product.capture('oversized', { value: 'a'.repeat(8 * 1024 * 1024) })
        expect(client.session).toEqual(old)
        expect([...tab.values.entries()]).toEqual(persisted)
        expect(storedSessionProperty(product, 'old_session')).toBe(true)
        product.capture('admitted')
        await client.flush()
        expect(events(requests).at(-1)?.properties).not.toHaveProperty('old_session')
    })

    it('preserves group-only context cleanup and clears session properties on full reset', async () => {
        const { product, client, requests } = await create()
        product.registerForSession({ session_only: true })
        product.resetGroups()
        expect(storedSessionProperty(product, 'session_only')).toBe(true)
        product.reset()
        expect(storedSessionProperty(product, 'session_only')).toBeUndefined()
        product.capture('reset')
        await client.flush()
        expect(events(requests)[0]?.properties).not.toHaveProperty('session_only')
    })

    it('uses the post-serialization session authority and keeps explicit undefined overrides', async () => {
        const { product, client, requests } = await create()
        product.registerForSession({ old_session: true, removed: 'session' })
        product.capture('reentrant', {
            get value() {
                product.reset()
                product.registerForSession({ fresh: true, removed: 'session' })
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
        const { product, client } = await create()
        product.capture('ordinary')
        await client.flush()
        expect(
            [...tab.values.keys()].every((key) => key.endsWith('_window_id') || key.endsWith('_primary_window_exists'))
        ).toBe(true)
    })

    it.each([null, [], 'invalid'])('drops non-object whole-property serialization: %j', async (result) => {
        const { product, client, requests } = await create()
        product.capture('invalid', { toJSON: () => result })
        await client.flush()
        expect(events(requests)).toHaveLength(0)
        expect(client.session).toBeUndefined()
    })

    it('allows a session value to shrink an oversized persistent default', async () => {
        const { client, product, requests } = await create()
        product.register({ value: 'a'.repeat(8 * 1024 * 1024) })
        product.registerForSession({ value: 'small' })
        product.capture('small')
        await client.flush()
        expect(events(requests)[0]?.properties.value).toBe('small')
    })

    it.each(['capture', 'captureImmediate'] as const)(
        '%s admits exactly the byte limit when a session value removes a persistent default',
        async (method) => {
            const { product, client, requests } = await create()
            const uuid = '12345678-1234-4234-8234-123456789abc'
            const timestamp = new Date(START)
            const observed: Record<string, unknown>[] = []
            product.onEvent(({ properties }) => observed.push(properties))
            product.capture('exact', { value: '' }, { uuid, timestamp })
            await client.flush()
            const base = JSON.stringify({
                uuid,
                event: 'exact',
                distinct_id: client.distinctId,
                properties: observed[0],
                timestamp: timestamp.toISOString(),
            }).length
            product.register({ extra: 'discard' })
            product.registerForSession({ extra: null })
            const value = 'a'.repeat(8 * 1024 * 1024 - base)
            await product[method]('exact', { value }, { uuid, timestamp })
            expect(observed).toHaveLength(2)
            await client.flush()
            expect(events(requests).at(-1)?.properties.value).toBe(value)
            expect(events(requests).at(-1)?.properties).not.toHaveProperty('extra')
            await product[method]('exact', { value: value + 'a' }, { uuid, timestamp })
            await client.flush()
            expect(observed).toHaveLength(2)
            expect(events(requests)).toHaveLength(2)
        }
    )

    it('preserves whole-object caller serialization and invokes it only once', async () => {
        const { client, product, requests } = await create()
        product.register({ persistent: true })
        product.registerForSession({ session_default: true })
        const serialize = vi.fn(function (this: Record<string, unknown>, key: string) {
            expect(this.persistent).toBe(true)
            expect(key).toBe('')
            return { custom: true }
        })
        product.capture('custom', { toJSON: serialize })
        await client.flush()
        expect(serialize).toHaveBeenCalledTimes(1)
        expect(events(requests)[0]?.properties).toMatchObject({ custom: true })
        expect(events(requests)[0]?.properties).not.toHaveProperty('persistent')
        expect(events(requests)[0]?.properties).not.toHaveProperty('session_default')
    })

    it('keeps session storage optional for memory-only clients and failed native access', async () => {
        const memory = await create(true)
        memory.product.registerForSession({ ephemeral: true })
        expect(storedSessionProperty(memory.product, 'ephemeral')).toBe(true)
        expect(tab.values.size).toBe(0)
        await memory.client.dispose()
        const fresh = await create(true)
        expect(storedSessionProperty(fresh.product, 'ephemeral')).toBeUndefined()
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
        expect(() => denied.product.registerForSession({ fallback: true })).not.toThrow()
        denied.product.capture('fallback')
        await denied.client.flush()
        expect(events(denied.requests)[0]?.properties.fallback).toBe(true)
    })

    it('reports unavailable immediate delivery when caller serialization disposes the product', async () => {
        const { product } = await create()
        const disposal: Promise<void>[] = []
        const summary = await product.captureImmediate('disposed_during_serialization', {
            toJSON() {
                disposal.push(Promise.resolve(product.dispose?.()))
                return { caller: true }
            },
        })
        await Promise.all(disposal)
        expect(summary.error).toBeDefined()
        expect(summary.submitted).toBe(0)
    })

    it.each(['capture', 'reset'] as const)('contains disposal from a storage callback during %s', async (operation) => {
        const product = analytics({ flushInterval: 0 })
        const backing = new MemoryStorage()
        let armed = false
        const client = await createPostHog({
            projectToken: TOKEN,
            navigator: false,
            fetch: false,
            capturePageview: false,
            remoteConfig: localRemoteConfig,
            extensions: [product],
            storage: {
                getItem: (key) => backing.getItem(key),
                removeItem: (key) => backing.removeItem(key),
                setItem(key, value) {
                    backing.setItem(key, value)
                    if (armed) {
                        armed = false
                        void product.dispose?.()
                    }
                },
            },
        })
        clients.push(client)
        armed = true
        expect(() => {
            if (operation === 'capture') product.capture('during_dispose')
            else product.reset()
        }).not.toThrow()
        expect(armed).toBe(false)
    })

    it('contains malformed input and makes unbound/disposed handles inert', async () => {
        const raw = analytics()
        expect(() => raw.registerForSession({ value: true })).not.toThrow()
        const { product, client } = await create()
        const revoked = Proxy.revocable({}, {})
        revoked.revoke()
        expect(() => product.registerForSession(revoked.proxy)).not.toThrow()
        product.registerForSession({ retained: true })
        expect(storedSessionProperty(product, 'toString')).toBeUndefined()
        await client.dispose()
        expect(() => product.unregisterForSession('retained')).not.toThrow()
        expect(storedSessionProperty(product, 'retained')).toBeUndefined()
    })
})

describe('session property admission and lifecycle', () => {
    const TAB_KEY = `ph_${TOKEN}_posthog_browser_v2_tab_analytics`

    it.each(['invalid', 'serialization', 'rate', 'buffer', 'oversize', 'commit'] as const)(
        'retains pending and current scopes on %s rejection',
        async (reason) => {
            const { client, product, requests } = await create()
            const reject = () => {
                if (reason === 'rate')
                    return vi.spyOn(ClientRateLimiter.prototype, 'consume').mockReturnValue({ allowed: false })
                if (reason === 'buffer') return vi.spyOn(EventBuffer.prototype, 'enqueue').mockReturnValue(false)
                if (reason === 'commit')
                    return vi.spyOn(BrowserState.prototype, 'sessionAdmitted').mockReturnValue(false)
                return undefined
            }
            const capture = () => {
                if (reason === 'invalid') product.capture('')
                else if (reason === 'serialization') product.capture('invalid', { value: 1n })
                else if (reason === 'oversize') product.capture('oversize', { value: 'a'.repeat(8 * 1024 * 1024) })
                else product.capture('rejected')
            }
            product.registerForSession({ pending: true })
            const pending = tab.getItem(TAB_KEY)
            let fault = reject()
            capture()
            expect(client.session).toBeUndefined()
            expect(tab.getItem(TAB_KEY)).toBe(pending)
            expect(storedSessionProperty(product, 'pending')).toBe(true)
            fault?.mockRestore()
            product.capture('first')
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
            expect(storedSessionProperty(product, 'pending')).toBe(true)
            fault?.mockRestore()
            product.capture('rotated')
            await client.flush()
            expect(events(requests).map(({ event }) => event)).toEqual(['first', 'rotated'])
            expect(events(requests).at(-1)?.properties).not.toHaveProperty('pending')
            expect(storedSessionProperty(product, 'pending')).toBeUndefined()
            expect(JSON.parse(tab.getItem(TAB_KEY) ?? '{}')).toEqual({
                superProperties: {},
                sessionId: client.session?.sessionId,
            })
        }
    )

    it('labels pending values before session observers and preserves their nested updates', async () => {
        const { client, product, requests } = await create()
        product.reset()
        product.registerForSession({ pending: true })
        let first = true
        client.onNewSession(() => {
            if (!first) return
            first = false
            expect(JSON.parse(tab.getItem(TAB_KEY) ?? '{}').sessionId).toBe(client.session?.sessionId)
            expect(storedSessionProperty(product, 'pending')).toBe(true)
            product.unregisterForSession('pending')
            product.registerForSession({ nested: true })
            product.capture('nested')
        })
        product.capture('outer')
        await client.flush()
        expect(first).toBe(false)
        expect(events(requests)).toMatchObject([
            { event: 'outer', properties: { pending: true } },
            { event: 'nested', properties: { nested: true } },
        ])
        expect(storedSessionProperty(product, 'pending')).toBeUndefined()
        expect(storedSessionProperty(product, 'nested')).toBe(true)
    })

    it('clears rotated scope before session and event observers, without overwriting reentrant registration', async () => {
        const { client, product, requests } = await create()
        product.registerForSession({ old: true })
        product.capture('first')
        vi.setSystemTime(START + 1_800_001)
        client.onNewSession(() => {
            expect(storedSessionProperty(product, 'old')).toBeUndefined()
            product.registerForSession({ fresh: true })
        })
        product.onEvent(({ event }) => {
            if (event !== 'outer') return
            expect(storedSessionProperty(product, 'fresh')).toBe(true)
            product.capture('nested')
        })
        product.capture('outer')
        await client.flush()
        expect(events(requests).map(({ event }) => event)).toEqual(['first', 'outer', 'nested'])
        expect(events(requests)[1]?.properties).not.toHaveProperty('old')
        expect(events(requests)[1]?.properties).not.toHaveProperty('fresh')
        expect(events(requests)[2]?.properties.fresh).toBe(true)
        expect(storedSessionProperty(product, 'fresh')).toBe(true)
    })

    it.each(['capture', 'captureImmediate'] as const)('%s retains finalized session snapshots', async (method) => {
        const { client, product, requests } = await create()
        const value = { count: 1 }
        product.registerForSession({ value, removed: true, $set: { wrong: true } })
        const observed: Record<string, unknown>[] = []
        product.onEvent(({ properties }) => {
            observed.push(properties)
            product.registerForSession({ value: { count: 9 } })
            product.unregisterForSession('removed')
        })
        const pending = product[method]('snapshot', null, { set: { correct: true } })
        value.count = 7
        await pending
        await client.flush()
        expect(events(requests)).toMatchObject([
            { event: 'snapshot', properties: { value: { count: 1 }, removed: true, $set: { correct: true } } },
        ])
        expect(observed).toMatchObject([{ value: { count: 1 }, removed: true, $set: { correct: true } }])
        expect(storedSessionProperty(product, 'value')).toEqual({ count: 9 })
    })

    it('keeps local session context under denial and never mode without reading or creating session/window context', async () => {
        const { client, product, requests } = await create(false, { personProfiles: 'never' })
        client.optOut()
        const read = vi.spyOn(BrowserState.prototype, 'session', 'get')
        const prepare = vi.spyOn(BrowserState.prototype, 'prepareSessionForEvent')
        const { registerForSession, unregisterForSession } = product
        const copied = { registerForSession, unregisterForSession }
        registerForSession({ retained: true, removed: true })
        copied.unregisterForSession('removed')
        expect(storedSessionProperty(product, 'retained')).toBe(true)
        product.capture('denied')
        expect(read).not.toHaveBeenCalled()
        expect(prepare).not.toHaveBeenCalled()
        expect(requests).toHaveLength(0)
        expect(tab.values.has(`ph_${TOKEN}_window_id`)).toBe(false)
        client.optIn()
        product.capture('allowed')
        await client.flush()
        expect(events(requests)).toMatchObject([{ event: 'allowed', properties: { retained: true } }])
        await client.dispose()
        copied.registerForSession({ late: true })
        copied.unregisterForSession('retained')
        expect(storedSessionProperty(product, 'late')).toBeUndefined()
    })

    it('rechecks readiness and ownership after registration serialization', async () => {
        const { product, client } = await create()
        const prepare = vi.spyOn(BrowserState.prototype, 'prepare').mockReturnValue(false)
        const skipped = vi.fn(() => ({ skipped: true }))
        product.registerForSession({ toJSON: skipped })
        expect(skipped).not.toHaveBeenCalled()
        prepare.mockReturnValue(true)
        product.registerForSession({
            toJSON() {
                prepare.mockReturnValue(false)
                return { late: true }
            },
        })
        prepare.mockRestore()
        expect(storedSessionProperty(product, 'late')).toBeUndefined()
        const disposing: Promise<void>[] = []
        product.registerForSession({
            toJSON() {
                disposing.push(client.dispose())
                return { late: true }
            },
        })
        await Promise.all(disposing)
        const fresh = await create()
        expect(storedSessionProperty(fresh.product, 'late')).toBeUndefined()
    })

    it('serializes registration once and merges nested local mutations with own prototype keys', async () => {
        const { product } = await create()
        product.registerForSession({ removed: true })
        const serialize = vi.fn(() => {
            product.unregisterForSession('removed')
            product.registerForSession({ nested: true })
            return JSON.parse('{"__proto__":{"own":true},"constructor":"application","prototype":"own","":"empty"}')
        })
        product.registerForSession({ toJSON: serialize })
        expect(serialize).toHaveBeenCalledTimes(1)
        expect(storedSessionProperty(product, 'removed')).toBeUndefined()
        expect(storedSessionProperty(product, 'nested')).toBe(true)
        expect(storedSessionProperty(product, '__proto__')).toEqual({ own: true })
        expect(storedSessionProperty(product, 'constructor')).toBe('application')
        expect(storedSessionProperty(product, 'prototype')).toBe('own')
        expect(storedSessionProperty(product, '')).toBe('empty')
        expect(storedSessionProperty(product, 'toString')).toBeUndefined()
        product.unregisterForSession('__proto__')
        product.unregisterForSession('')
        expect(storedSessionProperty(product, '__proto__')).toBeUndefined()
        expect(storedSessionProperty(product, '')).toBeUndefined()
    })

    it('isolates projects and lets copied tabs inherit then diverge without sharing window identity', async () => {
        const first = await create()
        first.product.registerForSession({ owner: 'opener' })
        first.product.capture('opener')
        const copied = new MemoryStorage()
        for (const [key, value] of tab.values) copied.setItem(key, value)
        vi.stubGlobal('sessionStorage', copied)
        const duplicate = await create()
        expect(storedSessionProperty(duplicate.product, 'owner')).toBe('opener')
        duplicate.product.capture('duplicate')
        expect(duplicate.client.session?.sessionId).toBe(first.client.session?.sessionId)
        expect(duplicate.client.session?.windowId).not.toBe(first.client.session?.windowId)
        duplicate.product.registerForSession({ owner: 'copied' })
        expect(storedSessionProperty(first.product, 'owner')).toBe('opener')
        const other = await create(false, {}, 'ph_other_project')
        expect(storedSessionProperty(other.product, 'owner')).toBeUndefined()
        other.product.registerForSession({ owner: 'other' })
        expect(storedSessionProperty(duplicate.product, 'owner')).toBe('copied')
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
            const { client, product, requests } = await create()
            product.registerForSession({ first: { count: 1 } })
            product.unregisterForSession('missing')
            expect(storedSessionProperty(product, 'first')).toEqual({ count: 1 })
            fault?.mockRestore()
            product.registerForSession({ second: true })
            product.capture('fallback')
            await client.flush()
            expect(events(requests)).toMatchObject([{ properties: { first: { count: 1 }, second: true } }])
        }
    )
})

describe('session enrichment preserves person admission and caller serialization', () => {
    it.each(['onEvent', 'onNewSession'] as const)(
        'keeps nested person invalidation from %s after committing a pending scope',
        async (notification) => {
            const { client, product, requests } = await create()
            if (notification === 'onNewSession') product.reset()
            product.registerForSession({ context: true })
            let nested = false
            const unset = () => {
                if (nested) return
                nested = true
                expect(storedSessionProperty(product, 'context')).toBe(true)
                product.unsetPersonProperties('plan')
            }
            if (notification === 'onEvent') product.onEvent(unset)
            else client.onNewSession(unset)
            product.setPersonProperties({ plan: 'paid' })
            product.setPersonProperties({ plan: 'paid' })
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
        const { client, product, requests } = await create()
        product.registerForSession({ pending: true })
        const write = tab.setItem.bind(tab)
        let nested = false
        vi.spyOn(tab, 'setItem').mockImplementation((key, value) => {
            write(key, value)
            if (!key.endsWith('_tab_analytics') || nested) return
            nested = true
            product.unsetPersonProperties('plan')
        })
        product.setPersonProperties({ plan: 'paid' })
        product.setPersonProperties({ plan: 'paid' })
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
            const { client, product, requests } = await create()
            product.register({ nullable: 'persistent', missing: 'persistent', dynamic: 'persistent' })
            product.registerForSession({
                nullable: 'session',
                missing: 'session',
                dynamic: 'session',
                data: { drop: null, items: [null, { drop: null }] },
            })
            product.registerDynamicEventProperties(() => ({ dynamic: null }))
            const serializer = vi.fn(() => ({ drop: null, items: [null, { drop: null }], keep: true }))
            const observed: Record<string, unknown>[] = []
            product.onEvent(({ properties }) => observed.push(properties))
            await product[method]('serialization', {
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
            const { client, product, requests } = await create()
            product.registerForSession({ value: 'small' })
            await product[method]('oversized', { value: 'a'.repeat(8 * 1024 * 1024) })
            await client.flush()
            expect(events(requests)).toHaveLength(0)
            expect(client.session).toBeUndefined()
            expect(storedSessionProperty(product, 'value')).toBe('small')
        }
    )
})

describe('session reset storage callbacks', () => {
    it('retains an admitted nested person setter while clearing session context', async () => {
        const { client, product, requests } = await create()
        product.registerForSession({ before: true })
        const write = tab.setItem.bind(tab)
        let nested = false
        vi.spyOn(tab, 'setItem').mockImplementation((key, value) => {
            write(key, value)
            if (!key.endsWith('_tab_analytics') || nested) return
            nested = true
            product.setPersonProperties({ plan: 'paid' })
        })
        product.reset()
        product.setPersonProperties({ plan: 'paid' })
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
            const { client, product, requests } = await create(true)
            product.registerForSession({ $groups: null })
            await product.group('organization', 'a'.repeat(8 * 1024 * 1024))
            await product[method]('oversized_metadata')
            await client.flush()
            expect(events(requests)).toHaveLength(0)
            expect(client.session).toBeUndefined()
            expect(storedSessionProperty(product, '$groups')).toBeNull()
        }
    )
})
