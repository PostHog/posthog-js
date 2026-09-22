import { createPostHog, type CorePostHogOptions, type PostHog } from '../src/core'
import type { ReplayExtension, ReplaySessionHost } from '../src/replay-internal'
import { localRemoteConfig, MemoryStorage } from './helpers'

const START = new Date('2026-01-01T00:00:00.000Z').getTime()
const IDLE = 1_800_000
const MAXIMUM = 86_400_000
const STATE_KEY = 'ph_ph_test_posthog_browser_v2'
const EMPTY_SESSION = { sessionId: '', windowId: '', sessionStartTimestamp: 0 }

// Exercise the normal first-party extension installation seam without loading a recorder.
describe('browser-next replay session host', () => {
    const clients: PostHog[] = []
    beforeEach(() => {
        vi.useFakeTimers({ now: START })
    })
    afterEach(async () => {
        await Promise.all(clients.splice(0).map((client) => client.dispose()))
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
        vi.useRealTimers()
    })

    const create = async (options: Partial<CorePostHogOptions> = {}, failSetup = false) => {
        let host!: ReplaySessionHost
        const changes = vi.fn()
        const extension: ReplayExtension = {
            name: 'sessionRecording',
            initialize(value) {
                host = value
            },
            setup() {
                host.onSessionChange(changes)
                if (failSetup) throw new Error('setup failed')
            },
        }
        const client = await createPostHog({
            projectToken: 'ph_test',
            remoteConfig: localRemoteConfig,
            capturePageview: false,
            fetch: false,
            navigator: false,
            ...options,
            extensions: [extension],
        })
        clients.push(client)
        return { client, host, changes }
    }

    it('leaves setup, subscriptions, ordinary getters, and rejected analytics session-free', async () => {
        const storage = new MemoryStorage()
        const { client, host, changes } = await create({ storage })
        host.onSessionChange(vi.fn())
        expect(host.sessionActive).toBe(true)
        expect(host.sessionTimeoutMs).toBe(IDLE)
        expect(client.session).toEqual(EMPTY_SESSION)
        client.capture('')
        client.capture('oversized', { value: 'a'.repeat(8 * 1024 * 1024) })
        expect(client.session).toEqual(EMPTY_SESSION)
        expect(JSON.parse(storage.values.get(STATE_KEY)!)).not.toHaveProperty('session')
        expect(changes).not.toHaveBeenCalled()
    })

    it('lets replay create the session before analytics and shares both IDs without synthetic capture', async () => {
        const { client, host, changes } = await create()
        const events = vi.fn()
        const publicChanges = vi.fn()
        client.onEvent(events)
        client.onNewSession(publicChanges)
        const session = host.checkSession()
        expect(session.sessionId).not.toBe('')
        expect(session.windowId).not.toBe('')
        expect(events).not.toHaveBeenCalled()
        client.capture('analytics')
        expect(client.session).toEqual(session)
        expect(events).toHaveBeenCalledWith(
            expect.objectContaining({
                properties: expect.objectContaining({ $session_id: session.sessionId, $window_id: session.windowId }),
            })
        )
        expect(changes).toHaveBeenCalledTimes(1)
        expect(changes).toHaveBeenCalledWith(session.sessionId, session.windowId, {
            noSessionId: true,
            activityTimeout: false,
            sessionPastMaximumLength: false,
            crossTabAdoption: false,
        })
        expect(publicChanges).not.toHaveBeenCalled()
    })

    it('notifies replay of the first analytics session and reuses it on recorder start', async () => {
        const { client, host, changes } = await create()
        client.capture('analytics')
        const session = client.session
        expect(host.checkSession()).toEqual(session)
        expect(changes).toHaveBeenCalledTimes(1)
        expect(changes.mock.calls[0]?.slice(0, 2)).toEqual([session.sessionId, session.windowId])
    })

    it('does not let passive events extend activity or rotate idle sessions', async () => {
        const storage = new MemoryStorage()
        const { host, changes } = await create({ storage })
        const session = host.checkSession()
        for (const elapsed of [60_000, IDLE, IDLE + 1]) {
            expect(host.checkSession({ timestamp: START + elapsed, updateActivity: false })).toEqual(session)
        }
        expect(JSON.parse(storage.values.get(STATE_KEY)!).session.lastActivityTimestamp).toBe(START)
        const rotated = host.checkSession({ timestamp: START + IDLE + 1 })
        expect(rotated.sessionId).not.toBe(session.sessionId)
        expect(rotated.windowId).not.toBe(session.windowId)
        expect(changes.mock.lastCall?.[2]).toMatchObject({ activityTimeout: true })
    })

    it('allows passive initial checks but enforces the strict maximum age even without activity', async () => {
        const { host, changes } = await create()
        const session = host.checkSession({ updateActivity: false })
        expect(session.sessionId).not.toBe('')
        expect(host.checkSession({ timestamp: START + MAXIMUM, updateActivity: false })).toEqual(session)
        const rotated = host.checkSession({ timestamp: START + MAXIMUM + 1, updateActivity: false })
        expect(rotated.sessionId).not.toBe(session.sessionId)
        expect(changes.mock.lastCall?.[2]).toMatchObject({ activityTimeout: false, sessionPastMaximumLength: true })
    })

    it('extends shared activity on active replay interactions and leaves it monotonic', async () => {
        const storage = new MemoryStorage()
        const { client, host } = await create({ storage })
        const session = host.checkSession()
        expect(host.checkSession({ timestamp: START + IDLE })).toEqual(session)
        expect(host.checkSession({ timestamp: START + IDLE - 1 })).toEqual(session)
        expect(JSON.parse(storage.values.get(STATE_KEY)!).session.lastActivityTimestamp).toBe(START + IDLE)
        vi.setSystemTime(START + IDLE + 1)
        client.capture('still-active')
        expect(client.session).toEqual(session)
    })

    it('defers reset notification until replay creates replacement IDs', async () => {
        const { client, host, changes } = await create()
        const first = host.checkSession()
        const publicChanges = vi.fn()
        client.onNewSession(publicChanges)
        client.reset()
        expect(client.session).toEqual(EMPTY_SESSION)
        expect(changes).toHaveBeenCalledTimes(1)
        const next = host.checkSession()
        expect(next.sessionId).not.toBe(first.sessionId)
        expect(next.windowId).not.toBe(first.windowId)
        expect(changes.mock.lastCall?.[2]).toMatchObject({ noSessionId: true })
        expect(publicChanges).toHaveBeenCalledTimes(1)
        expect(publicChanges).toHaveBeenCalledWith({ ...next, reason: 'reset' })
    })

    it('reports analytics idle and maximum rotations to replay', async () => {
        const { client, host, changes } = await create()
        host.checkSession()
        vi.setSystemTime(START + IDLE + 1)
        client.capture('idle-rotation')
        expect(changes.mock.lastCall?.[2]).toMatchObject({ activityTimeout: true })
        const nextStart = client.session.sessionStartTimestamp
        for (let elapsed = IDLE; elapsed <= MAXIMUM; elapsed += IDLE) {
            host.checkSession({ timestamp: nextStart + elapsed })
        }
        vi.setSystemTime(nextStart + MAXIMUM + 1)
        client.capture('max-rotation')
        expect(changes.mock.lastCall?.[2]).toMatchObject({ activityTimeout: false, sessionPastMaximumLength: true })
        expect(changes).toHaveBeenCalledTimes(3)
    })

    it('adopts sibling replay and analytics rotations without replacing the receiving window', async () => {
        const storage = new MemoryStorage()
        const first = await create({ storage })
        const second = await create({ storage })
        first.host.checkSession()
        const local = second.host.checkSession()
        const publicChanges = vi.fn()
        second.client.onNewSession(publicChanges)
        vi.setSystemTime(START + IDLE + 1)
        const replayRotation = first.host.checkSession()
        second.client.capture('adopt-replay')
        expect(second.client.session).toEqual({ ...replayRotation, windowId: local.windowId })
        expect(second.changes.mock.lastCall?.[2]).toMatchObject({ crossTabAdoption: true })
        vi.setSystemTime(START + 2 * (IDLE + 1))
        first.client.capture('analytics-rotation')
        expect(second.host.checkSession({ updateActivity: false })).toEqual({
            ...first.client.session,
            windowId: local.windowId,
        })
        expect(second.changes.mock.lastCall?.[2]).toMatchObject({ crossTabAdoption: true })
        expect(publicChanges).not.toHaveBeenCalled()
    })

    it('uses sibling activity for idle decisions without passive checks refreshing it', async () => {
        const storage = new MemoryStorage()
        const first = await create({ storage })
        const second = await create({ storage })
        const session = first.host.checkSession()
        second.host.checkSession()
        first.host.checkSession({ timestamp: START + IDLE - 1 })
        expect(second.host.checkSession({ timestamp: START + IDLE + 1 }).sessionId).toBe(session.sessionId)
    })

    it('blocks session creation and activity during consent denial, then permits explicit regrant', async () => {
        const storage = new MemoryStorage()
        const { client, host, changes } = await create({ storage, optOutByDefault: true })
        expect(host.checkSession()).toEqual(EMPTY_SESSION)
        expect(client.session).toEqual(EMPTY_SESSION)
        client.optIn()
        const session = host.checkSession()
        client.optOut()
        const persisted = storage.values.get(STATE_KEY)
        expect(host.checkSession({ timestamp: START + IDLE + 1 })).toEqual(EMPTY_SESSION)
        expect(storage.values.get(STATE_KEY)).toBe(persisted)
        expect(client.session).toEqual(session)
        expect(changes).toHaveBeenCalledTimes(1)
        client.optIn()
        expect(host.checkSession({ timestamp: START + IDLE + 1 }).sessionId).not.toBe(session.sessionId)
    })

    it('observes external denial before a replay check', async () => {
        const storage = new MemoryStorage()
        const { client, host } = await create({ storage })
        storage.setItem('__ph_opt_in_out_ph_test', '0')
        expect(host.checkSession()).toEqual(EMPTY_SESSION)
        expect(client.session).toEqual(EMPTY_SESSION)
    })

    it('rejects blocked bots and failed extension setup', async () => {
        for (const { client, host, changes } of [
            await create({ navigator: { webdriver: true } }),
            await create({}, true),
        ]) {
            expect(host.checkSession()).toEqual(EMPTY_SESSION)
            expect(client.session).toEqual(EMPTY_SESSION)
            expect(changes).not.toHaveBeenCalled()
        }
    })

    it('revokes checks and notifications as soon as shutdown begins', async () => {
        const { client, host, changes } = await create()
        const session = host.checkSession()
        const shutdown = client.shutdown()
        expect(host.sessionActive).toBe(false)
        expect(host.checkSession({ timestamp: START + IDLE + 1 })).toEqual(EMPTY_SESSION)
        await shutdown
        expect(host.checkSession()).toEqual(EMPTY_SESSION)
        expect(client.session).toEqual(session)
        expect(changes).toHaveBeenCalledTimes(1)
    })

    it.each(['shutdown', 'denial'])('returns no session after a listener triggers %s', async (stop) => {
        const { client, host } = await create()
        host.onSessionChange(() => {
            if (stop === 'shutdown') void client.shutdown()
            else client.optOut()
        })
        expect(host.checkSession()).toEqual(EMPTY_SESSION)
    })

    it('isolates listener errors, removes subscriptions, and tolerates reentrant checks', async () => {
        const { client, host } = await create()
        host.onSessionChange(() => {
            throw new Error('listener')
        })
        const removed = vi.fn()
        host.onSessionChange(removed).dispose()
        const reentrant = vi.fn(() => host.checkSession({ updateActivity: false }))
        host.onSessionChange(reentrant)
        expect(() => client.capture('analytics')).not.toThrow()
        expect(reentrant).toHaveBeenCalledTimes(1)
        expect(removed).not.toHaveBeenCalled()
    })

    it('does not publish stale IDs to later listeners after a reentrant reset and replacement', async () => {
        const { client, host } = await create()
        let reset = false
        host.onSessionChange(() => {
            if (!reset) {
                reset = true
                client.reset()
                host.checkSession()
            }
        })
        const listener = vi.fn()
        host.onSessionChange(listener)
        const current = host.checkSession()
        expect(listener).toHaveBeenCalledTimes(1)
        expect(listener.mock.calls[0]?.slice(0, 2)).toEqual([current.sessionId, current.windowId])
    })

    it('contains failing option reads without committing session state', async () => {
        const { client, host } = await create()
        expect(
            host.checkSession({
                get timestamp(): number {
                    throw new Error('timestamp')
                },
            })
        ).toEqual(EMPTY_SESSION)
        expect(client.session).toEqual(EMPTY_SESSION)
    })

    it('rechecks permission after caller options and session preparation', async () => {
        for (const stop of ['denial', 'shutdown'] as const) {
            const { client, host, changes } = await create()
            expect(
                host.checkSession({
                    get timestamp() {
                        if (stop === 'denial') client.optOut()
                        else void client.shutdown()
                        return START
                    },
                })
            ).toEqual(EMPTY_SESSION)
            expect(client.session).toEqual(EMPTY_SESSION)
            expect(changes).not.toHaveBeenCalled()
        }
    })

    it('skips stale notifications when a public rotation listener resets the session', async () => {
        const { client, host, changes } = await create()
        host.checkSession()
        client.onNewSession(() => client.reset())
        vi.setSystemTime(START + IDLE + 1)
        client.capture('rotate')
        expect(client.session).toEqual(EMPTY_SESSION)
        expect(changes).toHaveBeenCalledTimes(1)
    })

    it('preserves newer authority written by tab storage hooks during replay commit', async () => {
        const storage = new MemoryStorage()
        const tab = new MemoryStorage()
        const events = new EventTarget()
        vi.stubGlobal('localStorage', storage)
        vi.stubGlobal('sessionStorage', tab)
        vi.stubGlobal('addEventListener', events.addEventListener.bind(events))
        vi.stubGlobal('removeEventListener', events.removeEventListener.bind(events))
        const sibling = await create({ storage })
        const { client, host, changes } = await create()
        const set = tab.setItem.bind(tab)
        let reset = false
        tab.setItem = (key, value) => {
            set(key, value)
            if (key === 'ph_ph_test_window_id' && !reset) {
                reset = true
                sibling.client.reset()
            }
        }
        expect(host.checkSession()).toEqual(EMPTY_SESSION)
        expect(client.session).toEqual(EMPTY_SESSION)
        expect(changes).not.toHaveBeenCalled()
        expect(JSON.parse(storage.values.get(STATE_KEY)!)).toHaveProperty('sessionReset')
        expect(tab.values.size).toBe(0)
        expect(host.checkSession().sessionId).not.toBe('')
    })
})
