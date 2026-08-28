import { analytics as createAnalytics } from '../src/analytics'
import { createPostHog, type NewSessionInfo, type StorageLike } from '../src/core'
import { createFetch, MemoryStorage, type SentRequest } from './helpers'

const analytics = () => createAnalytics({ flushAt: 1, flushInterval: 0 })
const EMPTY_SESSION = { sessionId: '', windowId: '', sessionStartTimestamp: 0 }
const STATE_KEY = 'ph_ph_test_posthog_browser_v2'
const WINDOW_KEY = 'ph_ph_test_window_id'
const PRIMARY_WINDOW_KEY = 'ph_ph_test_primary_window_exists'
const START = new Date('2026-01-01T00:00:00.000Z').getTime()

class FailingStorage extends MemoryStorage {
    failReads = false
    failReadsRemaining = 0

    override getItem(key: string): string | null {
        if (key === STATE_KEY && (this.failReads || this.failReadsRemaining > 0)) {
            this.failReadsRemaining--
            throw new Error('state read failed')
        }
        return super.getItem(key)
    }
}

describe('browser-next session state', () => {
    const descriptors = new Map<PropertyKey, PropertyDescriptor | undefined>()
    let events: EventTarget

    beforeEach(() => {
        jest.useFakeTimers({ now: START })
        events = new EventTarget()
        for (const [key, value] of [
            ['addEventListener', events.addEventListener.bind(events)],
            ['removeEventListener', events.removeEventListener.bind(events)],
            ['dispatchEvent', events.dispatchEvent.bind(events)],
        ] as const) {
            descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
            Object.defineProperty(globalThis, key, { configurable: true, value, writable: true })
        }
        for (const key of ['localStorage', 'sessionStorage', 'performance']) {
            descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
        }
    })

    afterEach(() => {
        jest.restoreAllMocks()
        for (const key of [
            'addEventListener',
            'removeEventListener',
            'dispatchEvent',
            'localStorage',
            'sessionStorage',
            'performance',
        ]) {
            const descriptor = descriptors.get(key)
            if (descriptor) {
                Object.defineProperty(globalThis, key, descriptor)
            } else {
                delete (globalThis as Record<string, unknown>)[key]
            }
        }
        descriptors.clear()
        jest.useRealTimers()
    })

    const setDefaultStorage = (local: StorageLike, session: StorageLike): void => {
        Object.defineProperties(globalThis, {
            localStorage: { configurable: true, value: local },
            sessionStorage: { configurable: true, value: session },
        })
    }

    const createMemoryClient = (storage: StorageLike | false = new MemoryStorage()) =>
        createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch: false })

    it('does not materialize a session for construction, reads, listeners, or invalid capture', async () => {
        const storage = new MemoryStorage()
        const posthog = await createMemoryClient(storage)
        const listener = jest.fn()
        posthog.onNewSession(listener)

        expect(posthog.session).toEqual(EMPTY_SESSION)
        await posthog.capture('')
        expect(posthog.session).toEqual(EMPTY_SESSION)
        expect(listener).not.toHaveBeenCalled()
        expect(JSON.parse(storage.values.get(STATE_KEY) ?? '{}')).not.toHaveProperty('session')
    })

    it('does not materialize session or tab state for an oversized first capture', async () => {
        const local = new MemoryStorage()
        const tab = new MemoryStorage()
        const tabRead = jest.spyOn(tab, 'getItem')
        setDefaultStorage(local, tab)
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            capturePageview: false,
            navigator: false,
            fetch: false,
        })

        await posthog.capture('oversized', { value: 'a'.repeat(8 * 1024 * 1024) })

        expect(posthog.session).toEqual(EMPTY_SESSION)
        expect(JSON.parse(local.values.get(STATE_KEY) ?? '{}')).not.toHaveProperty('session')
        expect(tabRead).not.toHaveBeenCalled()
        expect(tab.values.size).toBe(0)
    })

    it('does not rotate or advance activity until an idle capture is admitted', async () => {
        const storage = new MemoryStorage()
        const posthog = await createMemoryClient(storage)
        const changes: NewSessionInfo[] = []
        posthog.onNewSession((change) => changes.push(change))
        await posthog.capture('first')
        const first = posthog.session
        const persisted = storage.values.get(STATE_KEY)
        jest.setSystemTime(START + 1_800_001)

        await posthog.capture('oversized', { value: 'a'.repeat(8 * 1024 * 1024) })

        expect(posthog.session).toEqual(first)
        expect(storage.values.get(STATE_KEY)).toBe(persisted)
        expect(changes).toEqual([])
        await posthog.capture('admitted')
        expect(posthog.session.sessionId).not.toBe(first.sessionId)
        expect(changes.map(({ reason }) => reason)).toEqual(['idleTimeout'])
    })

    it('does not advance session activity for active-capacity rejection', async () => {
        const storage = new MemoryStorage()
        let finish: ((response: Response) => void) | undefined
        const response = new Promise<Response>((resolve) => {
            finish = resolve
        })
        const fetch = jest
            .fn()
            .mockImplementationOnce(() => response)
            .mockResolvedValue(new Response('{}', { status: 200 }))
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            capturePageview: false,
            storage,
            navigator: false,
            fetch,
            extensions: [analytics()],
        })
        const observed: string[] = []
        posthog.onEvent(({ event }) => observed.push(event))
        await posthog.capture('large', { value: 'a'.repeat(8_387_700) })
        await Promise.resolve()
        expect(fetch).toHaveBeenCalledTimes(1)
        const session = posthog.session
        jest.setSystemTime(START + 120_000)

        await posthog.capture('rejected', { value: 'a'.repeat(1_000) })

        expect(observed).toEqual(['large'])
        expect(posthog.session).toEqual(session)
        expect(JSON.parse(storage.values.get(STATE_KEY) ?? '{}').session.lastActivityTimestamp).toBe(START)
        finish?.(new Response('{}', { status: 200 }))
        await posthog.flush()
        await posthog.capture('admitted')
        expect(observed).toEqual(['large', 'admitted'])
        expect(JSON.parse(storage.values.get(STATE_KEY) ?? '{}').session.lastActivityTimestamp).toBe(START + 120_000)
    })

    it('preserves a reset tombstone until a replacement capture is admitted', async () => {
        const storage = new MemoryStorage()
        const posthog = await createMemoryClient(storage)
        const changes: NewSessionInfo[] = []
        posthog.onNewSession((change) => changes.push(change))
        await posthog.capture('first')
        posthog.reset()
        const resetState = storage.values.get(STATE_KEY)

        await posthog.capture('oversized', { value: 'a'.repeat(8 * 1024 * 1024) })

        expect(posthog.session).toEqual(EMPTY_SESSION)
        expect(storage.values.get(STATE_KEY)).toBe(resetState)
        expect(changes).toEqual([])
        await posthog.capture('admitted')
        expect(posthog.session.sessionId).not.toBe('')
        expect(changes.map(({ reason }) => reason)).toEqual(['reset'])
    })

    it('materializes and persists session and window together on the first valid capture without a notification', async () => {
        const storage = new MemoryStorage()
        const posthog = await createMemoryClient(storage)
        const listener = jest.fn()
        posthog.onNewSession(listener)

        await posthog.capture('first')

        expect(posthog.session.sessionId).not.toBe('')
        expect(posthog.session.windowId).not.toBe('')
        expect(posthog.session.sessionStartTimestamp).toBe(START)
        expect(JSON.parse(storage.values.get(STATE_KEY) ?? '{}')).toMatchObject({
            session: {
                sessionId: posthog.session.sessionId,
                sessionStartTimestamp: START,
                lastActivityTimestamp: START,
            },
        })
        expect(listener).not.toHaveBeenCalled()
    })

    it('reads an embedded version-1 session on the first eligible capture', async () => {
        const storage = new MemoryStorage()
        storage.values.set(
            STATE_KEY,
            JSON.stringify({
                version: 1,
                deviceId: 'device',
                anonymousId: 'anonymous',
                distinctId: 'anonymous',
                isIdentified: false,
                groups: {},
                session: {
                    sessionId: 'persisted-session',
                    sessionStartTimestamp: START,
                    lastActivityTimestamp: START,
                },
                extensionData: {},
            })
        )
        const posthog = await createMemoryClient(storage)
        expect(posthog.session).toEqual(EMPTY_SESSION)

        await posthog.capture('first')

        expect(posthog.session.sessionId).toBe('persisted-session')
        expect(posthog.session.windowId).not.toBe('')
    })

    it('uses strict idle boundaries and rotates both IDs after the boundary', async () => {
        const posthog = await createMemoryClient(false)
        const changes: NewSessionInfo[] = []
        posthog.onNewSession((change) => changes.push(change))
        await posthog.capture('first')
        const first = posthog.session

        jest.setSystemTime(START + 1_800_000)
        await posthog.capture('at-boundary')
        expect(posthog.session).toEqual(first)

        jest.setSystemTime(START + 3_600_001)
        await posthog.capture('after-boundary')
        expect(posthog.session.sessionId).not.toBe(first.sessionId)
        expect(posthog.session.windowId).not.toBe(first.windowId)
        expect(changes.map(({ reason }) => reason)).toEqual(['idleTimeout'])
    })

    it('keeps rotation and reset revisions strictly increasing', async () => {
        const storage = new MemoryStorage()
        const posthog = await createMemoryClient(storage)
        await posthog.capture('first')
        const firstRevision = JSON.parse(storage.values.get(STATE_KEY) ?? '{}').session.revision

        jest.setSystemTime(START + 1_800_001)
        await posthog.capture('rotated')
        const rotatedRevision = JSON.parse(storage.values.get(STATE_KEY) ?? '{}').session.revision
        posthog.reset()
        const resetRevision = JSON.parse(storage.values.get(STATE_KEY) ?? '{}').sessionReset
        await posthog.capture('after-reset')
        const replacementRevision = JSON.parse(storage.values.get(STATE_KEY) ?? '{}').session.revision

        expect(BigInt(rotatedRevision)).toBeGreaterThan(BigInt(firstRevision))
        expect(BigInt(resetRevision)).toBeGreaterThan(BigInt(rotatedRevision))
        expect(BigInt(replacementRevision)).toBeGreaterThan(BigInt(resetRevision))
    })

    it('increments and reloads revisions beyond the safe-integer boundary', async () => {
        const storage = new MemoryStorage()
        const largeRevision = Number.MAX_SAFE_INTEGER
        storage.values.set(
            STATE_KEY,
            JSON.stringify({
                version: 1,
                deviceId: 'device',
                anonymousId: 'anonymous',
                distinctId: 'anonymous',
                isIdentified: false,
                groups: {},
                session: {
                    sessionId: 'large-revision',
                    sessionStartTimestamp: START,
                    lastActivityTimestamp: START,
                    revision: largeRevision,
                },
                extensionData: {},
            })
        )
        const posthog = await createMemoryClient(storage)
        await posthog.capture('adopt')
        jest.setSystemTime(START + 1_800_001)
        await posthog.capture('rotate')
        const rotated = posthog.session
        const persistedRevision = JSON.parse(storage.values.get(STATE_KEY) ?? '{}').session.revision
        expect(typeof persistedRevision).toBe('string')
        expect(persistedRevision).toBe('9007199254740992')

        const reloaded = await createMemoryClient(storage)
        await reloaded.capture('reload')
        expect(reloaded.session.sessionId).toBe(rotated.sessionId)
    })

    it('carries decimal revisions and preserves the newer reset across a stale write', async () => {
        const storage = new MemoryStorage()
        storage.values.set(
            STATE_KEY,
            JSON.stringify({
                version: 1,
                deviceId: 'device',
                anonymousId: 'anonymous',
                distinctId: 'anonymous',
                isIdentified: false,
                groups: {},
                session: {
                    sessionId: 'large-revision',
                    sessionStartTimestamp: START,
                    lastActivityTimestamp: START,
                    revision: '9999999999999999',
                },
                extensionData: {},
            })
        )
        const first = await createMemoryClient(storage)
        const stale = await createMemoryClient(storage)
        await first.capture('first')
        await stale.capture('stale')

        first.reset()
        stale.kv.set('stale', true)
        expect(JSON.parse(storage.values.get(STATE_KEY) ?? '{}')).toMatchObject({
            sessionReset: '10000000000000000',
        })
        await stale.capture('after-reset')
        expect(JSON.parse(storage.values.get(STATE_KEY) ?? '{}')).toMatchObject({
            session: { revision: '10000000000000001' },
        })
    })

    it('uses a strict 24-hour maximum while continuous activity keeps the session fresh', async () => {
        const posthog = await createMemoryClient(false)
        const changes: NewSessionInfo[] = []
        posthog.onNewSession((change) => changes.push(change))
        await posthog.capture('first')
        const first = posthog.session

        for (let interval = 1; interval <= 72; interval++) {
            jest.setSystemTime(START + interval * 20 * 60 * 1000)
            await posthog.capture(`tick-${interval}`)
        }
        expect(posthog.session).toEqual(first)

        jest.setSystemTime(START + 86_400_001)
        await posthog.capture('after-maximum')
        expect(posthog.session.sessionId).not.toBe(first.sessionId)
        expect(posthog.session.windowId).not.toBe(first.windowId)
        expect(changes.map(({ reason }) => reason)).toEqual(['maxLength'])
    })

    it('does no time-driven work across multiple idle days', async () => {
        const storage = new MemoryStorage()
        const posthog = await createMemoryClient(storage)
        const changes = jest.fn()
        posthog.onNewSession(changes)
        await posthog.capture('first')
        const first = posthog.session
        const persisted = storage.values.get(STATE_KEY)

        jest.setSystemTime(START + 3 * 86_400_000)
        await jest.advanceTimersByTimeAsync(0)

        expect(posthog.session).toEqual(first)
        expect(storage.values.get(STATE_KEY)).toBe(persisted)
        expect(changes).not.toHaveBeenCalled()
        expect(jest.getTimerCount()).toBe(0)
    })

    it('defers reset session creation and notification until the next capture', async () => {
        const posthog = await createMemoryClient(false)
        await posthog.capture('before-reset')
        const before = posthog.session
        const changes: NewSessionInfo[] = []
        posthog.onNewSession((change) => changes.push(change))

        posthog.reset()
        expect(posthog.session).toEqual(EMPTY_SESSION)
        expect(changes).toEqual([])

        await posthog.capture('after-reset')
        expect(posthog.session.sessionId).not.toBe(before.sessionId)
        expect(posthog.session.windowId).not.toBe(before.windowId)
        expect(changes).toEqual([{ ...posthog.session, reason: 'reset' }])
    })

    it('reuses recent sibling activity and avoids false idle rotation', async () => {
        const storage = new MemoryStorage()
        const first = await createMemoryClient(storage)
        const second = await createMemoryClient(storage)
        await first.capture('first')
        await second.capture('second')
        const shared = second.session.sessionId
        const secondWindow = second.session.windowId

        jest.setSystemTime(START + 29 * 60 * 1000)
        await first.capture('recent-sibling-activity')
        jest.setSystemTime(START + 31 * 60 * 1000)
        await second.capture('after-local-idle')

        expect(second.session.sessionId).toBe(shared)
        expect(second.session.windowId).toBe(secondWindow)
    })

    it('adopts a sibling rotation while retaining the local window', async () => {
        const storage = new MemoryStorage()
        const first = await createMemoryClient(storage)
        const second = await createMemoryClient(storage)
        await first.capture('first')
        await second.capture('second')
        const oldSession = first.session.sessionId
        const secondWindow = second.session.windowId

        jest.setSystemTime(START + 1_800_001)
        await first.capture('rotated')
        expect(first.session.sessionId).not.toBe(oldSession)
        await second.capture('adopt')

        expect(second.session.sessionId).toBe(first.session.sessionId)
        expect(second.session.windowId).toBe(secondWindow)
    })

    it('discards an event when tab-state hooks write newer authority during commit', async () => {
        const local = new MemoryStorage()
        const tab = new MemoryStorage()
        setDefaultStorage(local, tab)
        const sibling = await createMemoryClient(local)
        const requests: SentRequest[] = []
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            capturePageview: false,
            navigator: false,
            fetch: createFetch(requests),
            extensions: [analytics()],
        })
        const observed: string[] = []
        posthog.onEvent(({ event }) => observed.push(event))
        const set = tab.setItem.bind(tab)
        let reset = false
        tab.setItem = (key, value) => {
            set(key, value)
            if (key === WINDOW_KEY && !reset) {
                reset = true
                sibling.reset()
            }
        }

        await posthog.capture('racy')

        const durableReset = JSON.parse(local.values.get(STATE_KEY) ?? '{}')
        expect(reset).toBe(true)
        expect(observed).toEqual([])
        expect(posthog.session).toEqual(EMPTY_SESSION)
        expect(durableReset.session).toBeUndefined()
        expect(durableReset.sessionReset).toEqual(expect.any(String))
        expect(tab.values.has(WINDOW_KEY)).toBe(false)
        expect(tab.values.has(PRIMARY_WINDOW_KEY)).toBe(false)

        await posthog.capture('after-race')
        await posthog.flush()
        const delivered = requests.flatMap(
            ({ body }) => (body?.batch as Array<{ event: string }> | undefined)?.map(({ event }) => event) ?? []
        )
        expect(observed).toEqual(['after-race'])
        expect(delivered).toEqual(['after-race'])
    })

    it('does not overwrite newer session authority written between preview and admission commit', async () => {
        const storage = new MemoryStorage()
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            capturePageview: false,
            storage,
            navigator: false,
            fetch: false,
            debug: true,
        })
        const sibling = await createMemoryClient(storage)
        await posthog.capture('first')
        await sibling.capture('adopt')
        for (let index = 0; index < 999; index++) {
            jest.setSystemTime(START + (index + 1) * 100)
            await posthog.capture(`queued-${index}`)
        }
        const observed: string[] = []
        posthog.onEvent(({ event }) => observed.push(event))
        let reset = false
        jest.spyOn(console, 'warn').mockImplementation(() => {
            if (!reset) {
                reset = true
                sibling.reset()
            }
        })

        await posthog.capture('racy')

        const durableReset = JSON.parse(storage.values.get(STATE_KEY) ?? '{}')
        expect(reset).toBe(true)
        expect(durableReset.session).toBeUndefined()
        expect(durableReset.sessionReset).toEqual(expect.any(String))
        expect(observed).toEqual([])

        await posthog.capture('after-race')
        const durableSession = JSON.parse(storage.values.get(STATE_KEY) ?? '{}')
        expect(BigInt(durableSession.session.revision)).toBeGreaterThan(BigInt(durableReset.sessionReset))
        expect(observed).toEqual(['after-race'])
    })

    it('does not let sequential stale identity, group, or KV writes restore an older session', async () => {
        const storage = new MemoryStorage()
        const first = await createMemoryClient(storage)
        const staleKv = await createMemoryClient(storage)
        const staleIdentity = await createMemoryClient(storage)
        const staleGroup = await createMemoryClient(storage)
        await first.capture('first')
        await staleKv.capture('stale-kv')
        await staleIdentity.capture('stale-identity')
        await staleGroup.capture('stale-group')
        const oldSessionId = first.session.sessionId

        jest.setSystemTime(START + 1_800_001)
        await first.capture('rotate')
        const rotatedSessionId = first.session.sessionId
        expect(rotatedSessionId).not.toBe(oldSessionId)

        staleKv.kv.set('key', true)
        expect(JSON.parse(storage.values.get(STATE_KEY) ?? '{}').session.sessionId).toBe(rotatedSessionId)
        await staleIdentity.identify('identified-user')
        expect(JSON.parse(storage.values.get(STATE_KEY) ?? '{}').session.sessionId).toBe(rotatedSessionId)
        await staleGroup.group('organization', 'group')
        expect(JSON.parse(storage.values.get(STATE_KEY) ?? '{}').session.sessionId).toBe(rotatedSessionId)

        await staleKv.capture('adopt')
        expect(staleKv.session.sessionId).toBe(rotatedSessionId)
    })

    it('preserves an explicit reset tombstone across a stale whole-record write', async () => {
        const storage = new MemoryStorage()
        const first = await createMemoryClient(storage)
        const stale = await createMemoryClient(storage)
        await first.capture('first')
        await stale.capture('stale')
        const oldSessionId = first.session.sessionId

        first.reset()
        stale.kv.set('key', true)
        const resetState = JSON.parse(storage.values.get(STATE_KEY) ?? '{}')
        expect(resetState.session).toBeUndefined()
        expect(resetState.sessionReset).toEqual(expect.any(String))

        await stale.capture('after-reset')
        expect(stale.session.sessionId).not.toBe(oldSessionId)
        expect(stale.session.windowId).not.toBe('')
    })

    it('does not treat lazy absence or malformed session values as a reset', async () => {
        const storage = new MemoryStorage()
        const posthog = await createMemoryClient(storage)
        const observed = jest.fn()
        posthog.onEvent(observed)
        await posthog.capture('first')
        const first = posthog.session
        const base = JSON.parse(storage.values.get(STATE_KEY) ?? '{}')

        const lazy = { ...base }
        delete lazy.session
        storage.values.set(STATE_KEY, JSON.stringify(lazy))
        await posthog.capture('lazy-absence')
        expect(posthog.session).toEqual(first)

        for (const malformed of [
            null,
            { sessionId: '', sessionStartTimestamp: START, lastActivityTimestamp: START, revision: START },
            { sessionId: 'bad', sessionStartTimestamp: null, lastActivityTimestamp: START, revision: START },
            { sessionId: 'bad', sessionStartTimestamp: START, lastActivityTimestamp: START, revision: null },
            {
                sessionId: 'bad',
                sessionStartTimestamp: START,
                lastActivityTimestamp: START,
                revision: 1.5,
            },
        ]) {
            storage.values.set(STATE_KEY, JSON.stringify({ ...base, session: malformed }))
            await posthog.capture('malformed')
            expect(posthog.session).toEqual(first)
        }
        expect(observed.mock.calls.every(([payload]) => payload.properties.$session_id !== '')).toBe(true)
    })

    it('retries a failed initial state read before exposing or overwriting state', async () => {
        const storage = new FailingStorage()
        const seed = await createMemoryClient(storage)
        await seed.capture('seed')
        const persisted = storage.values.get(STATE_KEY)
        const identity = seed.anonymousId
        const sessionId = seed.session.sessionId
        storage.failReadsRemaining = 1

        const posthog = await createMemoryClient(storage)
        expect(storage.values.get(STATE_KEY)).toBe(persisted)
        expect(posthog.anonymousId).toBe(identity)
        await posthog.capture('recovered')
        expect(posthog.session.sessionId).toBe(sessionId)
    })

    it('retains safe local session state when shared-state reads fail', async () => {
        const storage = new FailingStorage()
        const posthog = await createMemoryClient(storage)
        await posthog.capture('first')
        const first = posthog.session
        storage.failReads = true

        await expect(posthog.capture('after-read-failure')).resolves.toBeUndefined()
        expect(posthog.session).toEqual(first)
    })

    it('retains session state across denial and regrant', async () => {
        const local = new MemoryStorage()
        const tab = new MemoryStorage()
        setDefaultStorage(local, tab)
        const posthog = await createPostHog({ projectToken: 'ph_test', navigator: false, fetch: false })
        await posthog.capture('before-denial')
        const before = posthog.session
        const changes = jest.fn()
        posthog.onNewSession(changes)
        expect(tab.values.has(WINDOW_KEY)).toBe(true)

        posthog.optOut()
        expect(posthog.session).toEqual(before)
        expect(tab.values.has(WINDOW_KEY)).toBe(true)
        expect(tab.values.has(PRIMARY_WINDOW_KEY)).toBe(true)
        posthog.optIn()
        expect(posthog.session).toEqual(before)
        await posthog.capture('after-grant')

        expect(posthog.session).toEqual(before)
        expect(changes).not.toHaveBeenCalled()
    })

    it('reuses a default tab window across ordinary reload disposal', async () => {
        const local = new MemoryStorage()
        const tab = new MemoryStorage()
        setDefaultStorage(local, tab)
        const first = await createPostHog({ projectToken: 'ph_test', navigator: false, fetch: false })
        await first.capture('first')
        const firstSession = first.session
        expect(tab.values.get(PRIMARY_WINDOW_KEY)).toBe('1')
        await first.dispose()
        expect(tab.values.has(PRIMARY_WINDOW_KEY)).toBe(false)
        expect(tab.values.get(WINDOW_KEY)).toBe(firstSession.windowId)

        const reloaded = await createPostHog({ projectToken: 'ph_test', navigator: false, fetch: false })
        expect(reloaded.session).toEqual(EMPTY_SESSION)
        await reloaded.capture('reload')
        expect(reloaded.session).toEqual(firstSession)
    })

    it('derives tab-window keys from a custom persistence key', async () => {
        const local = new MemoryStorage()
        const tab = new MemoryStorage()
        setDefaultStorage(local, tab)
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            persistenceKey: 'custom-state',
            navigator: false,
            fetch: false,
        })

        await posthog.capture('first')

        expect(tab.values.get('custom-state_window_id')).toBe(posthog.session.windowId)
        expect(tab.values.get('custom-state_primary_window_exists')).toBe('1')
    })

    it('recognizes reload navigation when Firefox retains the primary marker', async () => {
        const local = new MemoryStorage()
        const tab = new MemoryStorage()
        setDefaultStorage(local, tab)
        const first = await createPostHog({ projectToken: 'ph_test', navigator: false, fetch: false })
        await first.capture('first')
        const firstSession = first.session
        Object.defineProperty(globalThis, 'performance', {
            configurable: true,
            value: { getEntriesByType: () => [{ type: 'reload' }] },
        })

        const reloaded = await createPostHog({ projectToken: 'ph_test', navigator: false, fetch: false })
        await reloaded.capture('reload')

        expect(reloaded.session).toEqual(firstSession)
    })

    it('separates a copied tab window while retaining the shared session', async () => {
        const local = new MemoryStorage()
        const originalTab = new MemoryStorage()
        setDefaultStorage(local, originalTab)
        const first = await createPostHog({ projectToken: 'ph_test', navigator: false, fetch: false })
        await first.capture('first')
        const firstSession = first.session

        const copiedTab = new MemoryStorage()
        originalTab.values.forEach((value, key) => copiedTab.values.set(key, value))
        Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: copiedTab })
        Object.defineProperty(globalThis, 'performance', {
            configurable: true,
            get() {
                throw new Error('performance unavailable')
            },
        })
        const duplicate = await createPostHog({ projectToken: 'ph_test', navigator: false, fetch: false })
        await duplicate.capture('duplicate')

        expect(duplicate.session.sessionId).toBe(firstSession.sessionId)
        expect(duplicate.session.windowId).not.toBe(firstSession.windowId)
        expect(copiedTab.values.get(WINDOW_KEY)).toBe(duplicate.session.windowId)
    })

    it('flushes pending activity and removes the primary marker during beforeunload', async () => {
        const local = new MemoryStorage()
        const tab = new MemoryStorage()
        setDefaultStorage(local, tab)
        const posthog = await createPostHog({ projectToken: 'ph_test', navigator: false, fetch: false })
        await posthog.capture('first')
        jest.setSystemTime(START + 30_000)
        await posthog.capture('activity')
        expect(JSON.parse(local.values.get(STATE_KEY) ?? '{}').session.lastActivityTimestamp).toBe(START)

        globalThis.dispatchEvent(new Event('beforeunload'))

        expect(JSON.parse(local.values.get(STATE_KEY) ?? '{}').session.lastActivityTimestamp).toBe(START + 30_000)
        expect(tab.values.has(PRIMARY_WINDOW_KEY)).toBe(false)
    })

    it('does not move shared activity backwards during unload', async () => {
        const local = new MemoryStorage()
        const firstTab = new MemoryStorage()
        setDefaultStorage(local, firstTab)
        const first = await createPostHog({ projectToken: 'ph_test', navigator: false, fetch: false })
        await first.capture('first')

        const secondTab = new MemoryStorage()
        Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: secondTab })
        const second = await createPostHog({ projectToken: 'ph_test', navigator: false, fetch: false })
        await second.capture('second')
        jest.setSystemTime(START + 30_000)
        await second.capture('pending-older-activity')
        jest.setSystemTime(START + 120_000)
        await first.capture('persisted-newer-activity')

        globalThis.dispatchEvent(new Event('beforeunload'))

        expect(JSON.parse(local.values.get(STATE_KEY) ?? '{}').session.lastActivityTimestamp).toBe(START + 120_000)
    })

    it('does not flush stale activity over a sibling rotation during unload', async () => {
        const local = new MemoryStorage()
        const firstTab = new MemoryStorage()
        setDefaultStorage(local, firstTab)
        const first = await createPostHog({ projectToken: 'ph_test', navigator: false, fetch: false })
        await first.capture('first')

        const secondTab = new MemoryStorage()
        Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: secondTab })
        const second = await createPostHog({ projectToken: 'ph_test', navigator: false, fetch: false })
        await second.capture('second')
        jest.setSystemTime(START + 30_000)
        await second.capture('pending-activity')
        jest.setSystemTime(START + 1_800_001)
        await first.capture('rotated')
        const rotatedSession = first.session.sessionId

        globalThis.dispatchEvent(new Event('beforeunload'))

        expect(JSON.parse(local.values.get(STATE_KEY) ?? '{}').session.sessionId).toBe(rotatedSession)
    })

    it('does not access default tab storage for custom, disabled, denied, or blocked storage', async () => {
        const getter = jest.fn(() => {
            throw new Error('session storage unavailable')
        })
        Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get: getter })

        const custom = await createMemoryClient(new MemoryStorage())
        await custom.capture('custom')
        const disabled = await createMemoryClient(false)
        await disabled.capture('disabled')
        const deniedStorage = new MemoryStorage()
        deniedStorage.values.set('__ph_opt_in_out_ph_test', '0')
        Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: deniedStorage })
        const denied = await createPostHog({
            projectToken: 'ph_test',
            navigator: false,
            fetch: false,
        })
        await denied.capture('denied')
        const blocked = await createPostHog({
            projectToken: 'ph_test',
            navigator: { webdriver: true },
            fetch: false,
        })
        await blocked.capture('blocked')

        expect(getter).not.toHaveBeenCalled()
    })

    it('falls back to memory without leaving tab markers when lifecycle registration fails', async () => {
        const local = new MemoryStorage()
        const tab = new MemoryStorage()
        setDefaultStorage(local, tab)
        Object.defineProperty(globalThis, 'addEventListener', {
            configurable: true,
            value: () => {
                throw new Error('listener')
            },
        })
        const posthog = await createPostHog({ projectToken: 'ph_test', navigator: false, fetch: false })

        await posthog.capture('safe')

        expect(posthog.session.windowId).not.toBe('')
        expect(tab.values.has(WINDOW_KEY)).toBe(false)
        expect(tab.values.has(PRIMARY_WINDOW_KEY)).toBe(false)
    })

    it('contains default tab-storage and lifecycle-listener failures', async () => {
        const local = new MemoryStorage()
        const tab: StorageLike = {
            getItem() {
                throw new Error('read')
            },
            setItem() {
                throw new Error('write')
            },
            removeItem() {
                throw new Error('remove')
            },
        }
        setDefaultStorage(local, tab)
        Object.defineProperty(globalThis, 'addEventListener', {
            configurable: true,
            value: () => {
                throw new Error('listener')
            },
        })
        const posthog = await createPostHog({ projectToken: 'ph_test', navigator: false, fetch: false })

        await expect(posthog.capture('safe')).resolves.toBeUndefined()
        expect(posthog.session.sessionId).not.toBe('')
        await expect(posthog.dispose()).resolves.toBeUndefined()
    })

    it('removes the tab lifecycle listener during disposal', async () => {
        const local = new MemoryStorage()
        const tab = new MemoryStorage()
        setDefaultStorage(local, tab)
        const remove = jest.spyOn(globalThis, 'removeEventListener')
        const posthog = await createPostHog({ projectToken: 'ph_test', navigator: false, fetch: false })
        await posthog.capture('first')

        await posthog.dispose()

        expect(remove.mock.calls.some(([type]) => type === 'beforeunload')).toBe(true)
        expect(tab.values.has(PRIMARY_WINDOW_KEY)).toBe(false)
    })
})
