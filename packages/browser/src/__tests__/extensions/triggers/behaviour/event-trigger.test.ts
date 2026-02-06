import { EventTrigger } from '../../../../extensions/triggers/behaviour/event-trigger'
import { PersistenceHelper, TriggerState } from '../../../../extensions/triggers/behaviour/persistence'
import type { TriggerOptions } from '../../../../extensions/triggers/behaviour/types'

type EventCallback = (event: { event: string }) => void

const createMockPosthog = (sessionId: string) => {
    const callbacks: EventCallback[] = []

    const posthog = {
        get_session_id: jest.fn(() => sessionId),
        on: jest.fn((eventName: string, callback: EventCallback) => {
            if (eventName === 'eventCaptured') {
                callbacks.push(callback)
            }
            return () => { }
        }),
    }

    const fireEvent = (name: string) => {
        callbacks.forEach((cb) => cb({ event: name }))
    }

    return { posthog, fireEvent }
}

describe('EventTrigger', () => {
    const SESSION_ID = 'session-123'
    const OTHER_SESSION_ID = 'session-456'

    const createTrigger = (
        eventTriggers: string[],
        persistedDecision?: { sessionId: string; result: TriggerState },
        sessionId: string = SESSION_ID
    ) => {
        const { posthog, fireEvent } = createMockPosthog(sessionId)
        const storage: Record<string, unknown> = {}
        if (persistedDecision) {
            storage['$error_tracking_event_decision'] = persistedDecision
        }

        const persistence = new PersistenceHelper(
            (key) => storage[key] ?? null,
            (key, value) => {
                storage[key] = value
            }
        ).withPrefix('error_tracking')

        const options: TriggerOptions = {
            posthog: posthog as any,
            window: undefined,
            log: jest.fn(),
            persistence,
        }

        const trigger = new EventTrigger(options, eventTriggers)

        return { trigger, fireEvent, storage }
    }

    it('returns null when not configured', () => {
        const { trigger, storage } = createTrigger([])

        expect(trigger.matches(SESSION_ID)).toBeNull()
        expect(storage['$error_tracking_event_decision']).toBeUndefined()
    })

    it('returns false when no matching event fired', () => {
        const { trigger, fireEvent, storage } = createTrigger(['my-event'])

        fireEvent('other-event')

        expect(trigger.matches(SESSION_ID)).toBe(false)
        expect(storage['$error_tracking_event_decision']).toBeUndefined()
    })

    it('returns true after matching event fires', () => {
        const { trigger, fireEvent, storage } = createTrigger(['my-event'])

        fireEvent('my-event')

        expect(trigger.matches(SESSION_ID)).toBe(true)
        expect(storage['$error_tracking_event_decision']).toEqual({
            sessionId: SESSION_ID,
            result: TriggerState.Triggered,
        })
    })

    it('restores from persistence for same session', () => {
        const { trigger, storage } = createTrigger(['my-event'], {
            sessionId: SESSION_ID,
            result: TriggerState.Triggered,
        })

        expect(trigger.matches(SESSION_ID)).toBe(true)
        expect(storage['$error_tracking_event_decision']).toEqual({
            sessionId: SESSION_ID,
            result: TriggerState.Triggered,
        })
    })

    it('does not restore for different session', () => {
        const { trigger, storage } = createTrigger(['my-event'], {
            sessionId: OTHER_SESSION_ID,
            result: TriggerState.Triggered,
        })

        expect(trigger.matches(SESSION_ID)).toBe(false)
        expect(storage['$error_tracking_event_decision']).toEqual({
            sessionId: OTHER_SESSION_ID,
            result: TriggerState.Triggered,
        })
    })

    it('stays triggered after subsequent events', () => {
        const { trigger, fireEvent, storage } = createTrigger(['my-event'])

        fireEvent('my-event')
        fireEvent('other-event')

        expect(trigger.matches(SESSION_ID)).toBe(true)
        expect(storage['$error_tracking_event_decision']).toEqual({
            sessionId: SESSION_ID,
            result: TriggerState.Triggered,
        })
    })
})
