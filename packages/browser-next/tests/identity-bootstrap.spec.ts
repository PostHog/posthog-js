import type { IPostHog } from '../src/core/types'
import {
    CONSENT_KEY,
    createClient,
    MemoryStorage,
    STATE_KEY,
    storedState,
    uuidv7,
    type SentEvent,
} from './identity-fixtures'

const clients: IPostHog[] = []
const create = async (...args: Parameters<typeof createClient>): Promise<IPostHog> => {
    const client = await createClient(...args)
    clients.push(client)
    return client
}

afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.shutdown()))
    vi.restoreAllMocks()
})

const eventNamed = (sent: SentEvent[], name: string): SentEvent | undefined =>
    sent.find((event) => event.event === name)

describe('reset options', () => {
    it('keeps the device ID by default', async () => {
        const posthog = await create(new MemoryStorage())
        const deviceId = posthog.deviceId
        const distinctId = posthog.distinctId
        posthog.reset()
        expect(posthog.deviceId).toBe(deviceId)
        expect(posthog.distinctId).not.toBe(distinctId)
    })

    it('replaces the device ID on request', async () => {
        const storage = new MemoryStorage()
        const sent: SentEvent[] = []
        const posthog = await create(storage, sent)
        const deviceId = posthog.deviceId
        posthog.reset({ resetDeviceId: true })
        posthog.capture('after_reset')
        await posthog.flush()
        expect(posthog.deviceId).not.toBe(deviceId)
        expect(storedState(storage).deviceId).toBe(posthog.deviceId)
        expect(eventNamed(sent, 'after_reset')?.properties.$device_id).toBe(posthog.deviceId)
    })

    it('accepts the posthog-js boolean form', async () => {
        const posthog = await create(new MemoryStorage())
        const deviceId = posthog.deviceId
        posthog.reset(false)
        expect(posthog.deviceId).toBe(deviceId)
        posthog.reset(true)
        expect(posthog.deviceId).not.toBe(deviceId)
    })

    it('uses a bootstrapped session when a sibling admits an event first', async () => {
        const storage = new MemoryStorage()
        const sent: SentEvent[] = []
        const posthog = await create(storage, sent)
        const sibling = await create(storage)
        posthog.capture('before_reset')
        const sessionId = uuidv7(Date.now() - 60_000)
        posthog.reset({ bootstrap: { sessionId } })
        sibling.capture('sibling_after_reset')
        posthog.capture('after_reset')
        sibling.capture('sibling_adopts')
        await posthog.flush()
        expect(eventNamed(sent, 'after_reset')?.session_id).toBe(sessionId)
        expect(sibling.session?.sessionId).toBe(sessionId)
    })

    it('seeds an anonymous identity', async () => {
        const sent: SentEvent[] = []
        const posthog = await create(new MemoryStorage(), sent)
        const deviceId = posthog.deviceId
        posthog.identify('user-1')
        posthog.reset({ bootstrap: { distinctId: 'anon-2' } })
        expect(posthog.distinctId).toBe('anon-2')
        expect(posthog.anonymousId).toBe('anon-2')
        expect(posthog.deviceId).toBe(deviceId)
        posthog.identify('user-2')
        await posthog.flush()
        expect(sent.filter((event) => event.event === '$identify').at(-1)?.properties).toMatchObject({
            $anon_distinct_id: 'anon-2',
        })
    })

    it('seeds an identified identity without emitting an event', async () => {
        const storage = new MemoryStorage()
        const sent: SentEvent[] = []
        const posthog = await create(storage, sent)
        posthog.reset({ bootstrap: { distinctId: 'user-1', isIdentifiedId: true } })
        await posthog.flush()
        expect(posthog.distinctId).toBe('user-1')
        expect(posthog.anonymousId).not.toBe('user-1')
        expect(storedState(storage)).toMatchObject({ distinctId: 'user-1', isIdentified: true })
        expect(sent).toEqual([])
    })

    it('ignores an invalid bootstrapped distinct ID', async () => {
        const posthog = await create(new MemoryStorage())
        posthog.reset({ bootstrap: { distinctId: 'undefined' } })
        expect(posthog.distinctId).not.toBe('undefined')
        expect(posthog.distinctId).toBe(posthog.anonymousId)
    })

    it('continues a bootstrapped session after reset', async () => {
        const sent: SentEvent[] = []
        const posthog = await create(new MemoryStorage(), sent)
        const reasons: string[] = []
        posthog.onNewSession(({ reason }) => reasons.push(reason))
        posthog.capture('before_reset')
        const sessionId = uuidv7(Date.now() - 60_000)
        posthog.reset({ bootstrap: { sessionId } })
        posthog.capture('after_reset')
        await posthog.flush()
        expect(eventNamed(sent, 'after_reset')?.session_id).toBe(sessionId)
        expect(posthog.session?.sessionStartTimestamp).toBe(parseInt(sessionId.replace(/-/g, '').slice(0, 12), 16))
        expect(reasons).toEqual(['reset'])
    })

    it.each([
        ['is not a UUIDv7', '0194b2a0-0000-4000-8000-000000000001'],
        ['is in the future', uuidv7(Date.now() + 3_600_000)],
    ])('rejects a bootstrapped session ID that %s', async (_case, sessionId) => {
        const sent: SentEvent[] = []
        const posthog = await create(new MemoryStorage(), sent, { debug: true })
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        posthog.reset({ bootstrap: { sessionId } })
        posthog.capture('after_reset')
        await posthog.flush()
        expect(eventNamed(sent, 'after_reset')?.session_id).not.toBe(sessionId)
        expect(error).toHaveBeenCalled()
    })

    it('does not continue a bootstrapped session past the maximum session length', async () => {
        const sent: SentEvent[] = []
        const posthog = await create(new MemoryStorage(), sent)
        const sessionId = uuidv7(Date.now() - 25 * 3_600_000)
        posthog.reset({ bootstrap: { sessionId } })
        posthog.capture('after_reset')
        await posthog.flush()
        expect(eventNamed(sent, 'after_reset')?.session_id).not.toBe(sessionId)
    })

    it('retains consent', async () => {
        const storage = new MemoryStorage()
        const posthog = await create(storage)
        posthog.optOut()
        posthog.reset({ resetDeviceId: true, bootstrap: { distinctId: 'anon-2' } })
        expect(storage.getItem(CONSENT_KEY)).toBe('0')
        expect(posthog.hasOptedOut()).toBe(true)
    })
})

describe('setup bootstrap', () => {
    it('seeds a fresh anonymous identity and device', async () => {
        const storage = new MemoryStorage()
        const posthog = await create(storage, [], { bootstrap: { distinctId: 'anon-1' } })
        expect(posthog.distinctId).toBe('anon-1')
        expect(posthog.anonymousId).toBe('anon-1')
        expect(posthog.deviceId).toBe('anon-1')
        expect(storedState(storage)).toMatchObject({ distinctId: 'anon-1', isIdentified: false })
    })

    it('seeds a fresh identified identity with a generated device', async () => {
        const storage = new MemoryStorage()
        const sent: SentEvent[] = []
        const posthog = await create(storage, sent, { bootstrap: { distinctId: 'user-1', isIdentifiedId: true } })
        await posthog.flush()
        expect(posthog.distinctId).toBe('user-1')
        expect(posthog.deviceId).not.toBe('user-1')
        expect(storedState(storage)).toMatchObject({ distinctId: 'user-1', isIdentified: true })
        expect(sent).toEqual([])
    })

    it('does not replace a stored anonymous identity with an anonymous one', async () => {
        const storage = new MemoryStorage()
        const original = await create(storage)
        const distinctId = original.distinctId
        const posthog = await create(storage, [], { bootstrap: { distinctId: 'anon-2' } })
        expect(posthog.distinctId).toBe(distinctId)
    })

    it('identifies a stored anonymous user', async () => {
        const storage = new MemoryStorage()
        const anonymousId = (await create(storage)).distinctId
        const sent: SentEvent[] = []
        const posthog = await create(storage, sent, { bootstrap: { distinctId: 'user-1', isIdentifiedId: true } })
        await posthog.flush()
        expect(posthog.distinctId).toBe('user-1')
        expect(eventNamed(sent, '$identify')).toMatchObject({
            distinct_id: 'user-1',
            properties: { $anon_distinct_id: anonymousId },
        })
    })

    it('identifies a stored anonymous user without capture while opted out', async () => {
        const storage = new MemoryStorage()
        storage.setItem(CONSENT_KEY, '0')
        await create(storage)
        const sent: SentEvent[] = []
        const posthog = await create(storage, sent, { bootstrap: { distinctId: 'user-1', isIdentifiedId: true } })
        await posthog.flush()
        expect(storedState(storage)).toMatchObject({ distinctId: 'user-1', isIdentified: true })
        expect(sent).toEqual([])
    })

    it('marks a matching anonymous ID identified without an event', async () => {
        const storage = new MemoryStorage()
        const distinctId = (await create(storage)).distinctId
        const sent: SentEvent[] = []
        const posthog = await create(storage, sent, { bootstrap: { distinctId, isIdentifiedId: true } })
        await posthog.flush()
        expect(storedState(storage)).toMatchObject({ distinctId, isIdentified: true })
        expect(sent).toEqual([])
        expect(posthog.distinctId).toBe(distinctId)
    })

    it('keeps a different identified user and warns', async () => {
        const storage = new MemoryStorage()
        ;(await create(storage)).identify('user-1')
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const posthog = await create(storage, [], {
            debug: true,
            bootstrap: { distinctId: 'user-2', isIdentifiedId: true },
        })
        expect(posthog.distinctId).toBe('user-1')
        expect(warn).toHaveBeenCalled()
    })

    it('continues a bootstrapped session from the first event', async () => {
        const storage = new MemoryStorage()
        const sent: SentEvent[] = []
        const existing = await create(storage)
        existing.capture('earlier')
        const sessionId = uuidv7(Date.now() - 60_000)
        const posthog = await create(storage, sent, { bootstrap: { sessionId } })
        const newSessions: unknown[] = []
        posthog.onNewSession((session) => newSessions.push(session))
        posthog.capture('first')
        posthog.capture('second')
        await posthog.flush()
        expect(sent.map((event) => event.session_id)).toEqual([sessionId, sessionId])
        expect(storedState(storage).session.sessionId).toBe(sessionId)
        expect(newSessions).toEqual([])
        expect(storage.getItem(STATE_KEY)).toContain(sessionId)
    })
})
