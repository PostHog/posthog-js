import type { SessionContext } from '@posthog/browser-common'
import type { IPostHog } from '../src/core/types'
import { createClient, MemoryStorage } from './identity-fixtures'

const clients: IPostHog[] = []
const create = async (...args: Parameters<typeof createClient>): Promise<IPostHog> => {
    const client = await createClient(...args)
    clients.push(client)
    return client
}

afterEach(async () => {
    vi.useRealTimers()
    await Promise.all(clients.splice(0).map((client) => client.shutdown()))
    vi.restoreAllMocks()
})

const ids = (sessions: SessionContext[]): Array<[string, string]> =>
    sessions.map(({ sessionId, windowId }) => [sessionId, windowId])

describe('session ID subscriptions', () => {
    it('does not start a session to notify a new subscriber', async () => {
        const posthog = await create(new MemoryStorage())
        const sessions: SessionContext[] = []
        posthog.onSessionId((session) => sessions.push(session))
        expect(sessions).toEqual([])
        expect(posthog.session).toBeUndefined()
    })

    it('notifies when the first admitted event starts a session', async () => {
        const posthog = await create(new MemoryStorage())
        const sessions: SessionContext[] = []
        posthog.onSessionId((session) => sessions.push(session))
        posthog.capture('first')
        posthog.capture('second')
        expect(ids(sessions)).toEqual([[posthog.session!.sessionId, posthog.session!.windowId]])
    })

    it('replays the current session to a new subscriber', async () => {
        const posthog = await create(new MemoryStorage())
        posthog.capture('first')
        const sessions: SessionContext[] = []
        posthog.onSessionId((session) => sessions.push(session))
        expect(sessions).toEqual([posthog.session])
    })

    it('notifies after reset and idle rotation', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        const posthog = await create(new MemoryStorage())
        const sessions: SessionContext[] = []
        posthog.capture('first')
        posthog.onSessionId((session) => sessions.push(session))
        posthog.reset()
        expect(sessions).toHaveLength(1)
        posthog.capture('after_reset')
        vi.setSystemTime(Date.now() + 31 * 60_000)
        posthog.capture('after_idle')
        expect(new Set(sessions.map((session) => session.sessionId)).size).toBe(3)
        expect(sessions.at(-1)).toEqual(posthog.session)
    })

    it('notifies when this tab adopts a sibling session and keeps its window', async () => {
        const storage = new MemoryStorage()
        const tab = await create(storage)
        const sibling = await create(storage)
        tab.capture('tab')
        sibling.capture('sibling')
        sibling.reset()
        sibling.capture('sibling_after_reset')
        const sessions: SessionContext[] = []
        tab.onSessionId((session) => sessions.push(session))
        const windowId = tab.session!.windowId
        tab.capture('tab_after_sibling_reset')
        expect(ids(sessions.slice(1))).toEqual([[sibling.session!.sessionId, windowId]])
    })

    it('does not notify for an event that is not admitted', async () => {
        const posthog = await create(new MemoryStorage())
        const sessions: SessionContext[] = []
        posthog.onSessionId((session) => sessions.push(session))
        posthog.optOut()
        posthog.capture('denied')
        expect(sessions).toEqual([])
    })

    it('stops after disposal and isolates listener failures', async () => {
        const posthog = await create(new MemoryStorage())
        const sessions: SessionContext[] = []
        posthog.onSessionId(() => {
            throw new Error('listener failed')
        })
        const subscription = posthog.onSessionId((session) => sessions.push(session))
        posthog.capture('first')
        subscription.dispose()
        posthog.reset()
        posthog.capture('after_reset')
        expect(sessions).toHaveLength(1)
    })
})
