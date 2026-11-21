import { createPostHog } from '../src/composition/npm/index'
import { analyticsOf } from '../src/products/analytics/analytics-core'
import type { IPostHog, StorageLike } from '../src/core/types'
import {
    clientOptions,
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

    it('serves bootstrapped feature flags and payloads for the new identity', async () => {
        const posthog = await createPostHog({
            ...clientOptions(new MemoryStorage(), []),
            flags: { featureFlagEvaluation: false, bootstrap: { featureFlags: { previous: true } } },
        })
        clients.push(posthog)
        expect(posthog.featureFlags!.getFeatureFlag('previous')?.enabled).toBe(true)
        posthog.reset({
            bootstrap: {
                distinctId: 'user-2',
                isIdentifiedId: true,
                featureFlags: { next: 'blue', disabled: false },
                featureFlagPayloads: { next: { color: 'blue' }, disabled: { color: 'red' } },
            },
        })
        expect(posthog.featureFlags!.getFeatureFlag('previous')).toBeUndefined()
        expect(posthog.featureFlags!.getFeatureFlag('next')).toMatchObject({
            enabled: true,
            variant: 'blue',
            payload: { color: 'blue' },
        })
        expect(posthog.featureFlags!.getFeatureFlag('disabled')?.payload).toBeUndefined()
    })

    it('reports bootstrapped flag values only for the reset that supplied them', async () => {
        const sent: SentEvent[] = []
        const posthog = await createPostHog({
            ...clientOptions(new MemoryStorage(), sent),
            flags: { featureFlagEvaluation: false },
        })
        clients.push(posthog)
        posthog.reset({ bootstrap: { featureFlags: { next: 'blue' } } })
        posthog.featureFlags!.getFeatureFlag('next')
        posthog.reset()
        posthog.featureFlags!.updateFlags({ next: 'red' })
        posthog.featureFlags!.getFeatureFlag('next')
        await posthog.flush()
        expect(
            sent
                .filter((event) => event.event === '$feature_flag_called')
                .map((event) => event.properties.$feature_flag_bootstrapped_response)
        ).toEqual(['blue', undefined])
    })

    it('clears the stored consent choice, as posthog-js, iOS and Android do', async () => {
        const storage = new MemoryStorage()
        const posthog = await create(storage)
        posthog.optOut()
        posthog.reset({ resetDeviceId: true, bootstrap: { distinctId: 'anon-2' } })
        expect(storage.getItem(CONSENT_KEY)).toBeNull()
        expect(posthog.getExplicitConsentStatus()).toBe('pending')
        expect(posthog.hasOptedOut()).toBe(false)
    })

    it('keeps an opt-out that an onReset listener applies again', async () => {
        const sent: SentEvent[] = []
        const posthog = await create(new MemoryStorage(), sent)
        posthog.optOut()
        posthog.onReset(() => posthog.optOut())
        posthog.reset()
        posthog.capture('after_reset')
        await posthog.flush()
        expect(posthog.hasOptedOut()).toBe(true)
        expect(sent).toEqual([])
    })

    it('runs before-reset hooks under the previous identity and consent, then onReset listeners after consent clears', async () => {
        const posthog = await create(new MemoryStorage(), [], { optOutByDefault: true })
        posthog.optIn()
        const previousId = posthog.distinctId
        const seen: string[] = []
        const observe = (hook: string) => () =>
            seen.push(
                `${hook}:${posthog.getExplicitConsentStatus()}:${posthog.distinctId === previousId ? 'old' : 'new'}`
            )
        analyticsOf(posthog)!.onBeforeReset(observe('before'))
        posthog.onReset(observe('onReset'))
        posthog.reset()
        expect(seen).toEqual(['before:granted:old', 'onReset:pending:new'])
    })

    it('keeps an opt-in that an onReset listener applies again when capture is opted out by default', async () => {
        const posthog = await create(new MemoryStorage(), [], { optOutByDefault: true })
        posthog.optIn()
        posthog.onReset(() => posthog.optIn())
        posthog.reset()
        expect(posthog.hasOptedOut()).toBe(false)
    })

    it('rejects an event an onReset listener captures when capture is opted out by default', async () => {
        const sent: SentEvent[] = []
        const posthog = await create(new MemoryStorage(), sent, { optOutByDefault: true })
        posthog.optIn()
        posthog.onReset(() => posthog.capture('captured_on_reset'))
        posthog.reset()
        await posthog.flush()
        expect(sent).toEqual([])
    })

    it('attributes an event a consent listener captures during reset to the new identity', async () => {
        const sent: SentEvent[] = []
        const posthog = await create(new MemoryStorage(), sent)
        posthog.identify('user-1')
        posthog.optOut()
        posthog.onConsentChange(({ current }) => {
            if (current !== 'denied') posthog.capture('consent_granted')
        })
        posthog.reset()
        await posthog.flush()
        expect(sent.map((event) => [event.event, event.distinct_id])).toEqual([['consent_granted', posthog.distinctId]])
    })

    it('keeps person properties a consent listener sets during reset off the opted-out user', async () => {
        const sent: SentEvent[] = []
        const posthog = await create(new MemoryStorage(), sent)
        posthog.identify('user-1')
        posthog.optOut()
        posthog.onConsentChange(({ current }) => posthog.setPersonProperties({ analytics_consent: current }))
        posthog.reset()
        await posthog.flush()
        expect(sent.filter((event) => event.distinct_id === 'user-1')).toEqual([])
    })

    it('tells consent listeners about an onReset opt-in after the clear, in order', async () => {
        const posthog = await create(new MemoryStorage(), [])
        posthog.optOut()
        const seen: string[] = []
        posthog.onConsentChange(({ current, previous }) => seen.push(`${previous}->${current}`))
        posthog.onReset(() => posthog.optIn())
        posthog.reset()
        expect(seen).toEqual(['denied->implicit', 'implicit->granted'])
    })

    it('leaves consent listeners at denied when an onReset listener opts out under optOutByDefault', async () => {
        const posthog = await create(new MemoryStorage(), [], { optOutByDefault: true })
        posthog.optIn()
        const seen: string[] = []
        posthog.onConsentChange(({ current, previous }) => seen.push(`${previous}->${current}`))
        posthog.onReset(() => posthog.optOut())
        posthog.reset()
        expect(seen).toEqual(['granted->denied'])
    })

    it('delivers events captured before it when capture is opted out by default', async () => {
        const sent: SentEvent[] = []
        const posthog = await create(new MemoryStorage(), sent, { optOutByDefault: true })
        posthog.optIn()
        posthog.capture('logged_out')
        posthog.reset()
        posthog.capture('after_reset')
        await posthog.flush()
        expect(posthog.hasOptedOut()).toBe(true)
        expect(sent.map((event) => event.event)).toEqual(['logged_out'])
    })

    it('delivers events captured before it when consent is granted again before flush', async () => {
        const sent: SentEvent[] = []
        const posthog = await create(new MemoryStorage(), sent, { optOutByDefault: true })
        posthog.optIn()
        posthog.capture('logged_out')
        posthog.reset()
        posthog.optIn()
        await posthog.flush()
        expect(sent.map((event) => event.event)).toEqual(['logged_out'])
    })

    it('purges events captured before it when the user then opts out', async () => {
        const sent: SentEvent[] = []
        const posthog = await create(new MemoryStorage(), sent, { optOutByDefault: true })
        posthog.optIn()
        posthog.capture('logged_out')
        posthog.reset()
        posthog.optOut()
        posthog.optIn()
        await posthog.flush()
        expect(sent).toEqual([])
    })

    it('rejects group identify while only events captured before it may deliver', async () => {
        const storage = new MemoryStorage()
        const sent: SentEvent[] = []
        const posthog = await create(storage, sent, { optOutByDefault: true })
        posthog.optIn()
        posthog.capture('logged_out')
        posthog.reset()
        posthog.groupIdentify('company', 'acme', { name: 'Acme' })
        await posthog.flush()
        expect(sent.map((event) => event.event)).toEqual(['logged_out'])
        expect(JSON.stringify(storedState(storage).extensionData ?? {})).not.toContain('personProcessingEnabled')
    })

    it('keeps the stored consent choice while shutdown is pending', async () => {
        const storage = new MemoryStorage()
        const posthog = await createClient(storage, [], { fetch: () => new Promise<Response>(() => {}) })
        posthog.identify('user-a')
        posthog.optOut()
        void posthog.shutdown()
        posthog.reset()
        expect(storage.getItem(CONSENT_KEY)).toBe('0')
        expect(storedState(storage).distinctId).toBe('user-a')
    })
})

describe('generated session IDs', () => {
    const versionOf = (uuid: string | undefined): string | undefined => uuid?.replace(/-/g, '')[12]

    it('are UUIDv7 IDs that encode the session start', async () => {
        const sent: SentEvent[] = []
        const posthog = await create(new MemoryStorage(), sent)
        posthog.capture('first')
        await posthog.flush()
        const sessionId = sent[0]?.session_id
        expect(versionOf(sessionId)).toBe('7')
        expect(parseInt(sessionId!.replace(/-/g, '').slice(0, 12), 16)).toBe(posthog.session?.sessionStartTimestamp)
    })

    it('generates UUIDv7 window IDs', async () => {
        const posthog = await create(new MemoryStorage())
        posthog.capture('first')
        expect(versionOf(posthog.session?.windowId)).toBe('7')
    })

    it('can be continued by another client through bootstrap', async () => {
        const first = await create(new MemoryStorage())
        first.capture('on_first')
        const sessionId = first.session!.sessionId
        const sent: SentEvent[] = []
        const second = await create(new MemoryStorage(), sent, { bootstrap: { sessionId } })
        second.capture('on_second')
        await second.flush()
        expect(sent[0]?.session_id).toBe(sessionId)
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

    it('does not replace a stored identity that a retried read recovers', async () => {
        const storage = new MemoryStorage()
        const original = await create(storage)
        original.identify('persisted-user')
        await original.shutdown()

        let fail = true
        const flaky: StorageLike = {
            getItem(key) {
                if (key === STATE_KEY && fail) {
                    fail = false
                    throw new Error('unavailable once')
                }
                return storage.getItem(key)
            },
            setItem: (key, value) => storage.setItem(key, value),
            removeItem: (key) => storage.removeItem(key),
        }
        const sent: SentEvent[] = []
        const posthog = await create(flaky, sent, { bootstrap: { distinctId: 'new-anonymous' } })
        posthog.capture('after_recovery')
        await posthog.flush()

        expect([
            posthog.distinctId,
            storedState(storage).distinctId,
            eventNamed(sent, 'after_recovery')?.distinct_id,
        ]).toEqual(Array(3).fill('persisted-user'))
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
