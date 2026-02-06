import { EventTrigger } from '../../../../extensions/exception-autocapture/controls/triggers/event-trigger'
import { PersistenceHelper } from '../../../../extensions/exception-autocapture/controls/triggers/persistence'
import type { TriggerOptions } from '../../../../extensions/exception-autocapture/controls/triggers/types'

type EventCallback = (event: { event: string }) => void

const createMockPosthog = (sessionId: string): {
    posthog: any
    fireEvent: (name: string) => void
} => {
    const callbacks: EventCallback[] = []

    const posthog = {
        get_session_id: jest.fn(() => sessionId),
        on: jest.fn((eventName: string, callback: EventCallback) => {
            if (eventName === 'eventCaptured') {
                callbacks.push(callback)
            }
            return () => {
                const index = callbacks.indexOf(callback)
                if (index > -1) {
                    callbacks.splice(index, 1)
                }
            }
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
        persistedData: Record<string, string> = {},
        sessionId: string = SESSION_ID
    ) => {
        const { posthog, fireEvent } = createMockPosthog(sessionId)
        const storage: Record<string, string> = { ...persistedData }

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

        return { trigger, fireEvent, storage, options, posthog }
    }

    it('returns null when no event triggers are configured', () => {
        const { trigger } = createTrigger([])

        expect(trigger.matches(SESSION_ID)).toBeNull()
    })

    it('returns false initially when triggers are configured but none fired', () => {
        const { trigger } = createTrigger(['my-trigger-event'])

        expect(trigger.matches(SESSION_ID)).toBe(false)
    })

    it('returns true after a matching event is captured', () => {
        const { trigger, fireEvent } = createTrigger(['my-trigger-event'])

        fireEvent('my-trigger-event')

        expect(trigger.matches(SESSION_ID)).toBe(true)
    })

    it('ignores non-matching events', () => {
        const { trigger, fireEvent } = createTrigger(['my-trigger-event'])

        fireEvent('some-other-event')

        expect(trigger.matches(SESSION_ID)).toBe(false)
    })

    it('triggers on any matching event from the list', () => {
        const { trigger, fireEvent } = createTrigger(['event-a', 'event-b', 'event-c'])

        fireEvent('event-b')

        expect(trigger.matches(SESSION_ID)).toBe(true)
    })

    it('stays triggered once triggered', () => {
        const { trigger, fireEvent } = createTrigger(['my-trigger-event'])

        fireEvent('my-trigger-event')
        expect(trigger.matches(SESSION_ID)).toBe(true)

        fireEvent('some-other-event')
        expect(trigger.matches(SESSION_ID)).toBe(true)
    })

    describe('session stickiness', () => {
        it('persists session ID when event fires', () => {
            const { fireEvent, storage } = createTrigger(['my-event'])

            expect(storage['$error_tracking_event_session']).toBeUndefined()

            fireEvent('my-event')

            expect(storage['$error_tracking_event_session']).toBe(SESSION_ID)
        })

        it('returns true for same session if previously persisted', () => {
            const { trigger } = createTrigger(['my-event'], {
                '$error_tracking_event_session': SESSION_ID,
            })

            expect(trigger.matches(SESSION_ID)).toBe(true)
        })

        it('returns false for different session even if previously persisted', () => {
            const { trigger } = createTrigger(['my-event'], {
                '$error_tracking_event_session': OTHER_SESSION_ID,
            })

            expect(trigger.matches(SESSION_ID)).toBe(false)
        })
    })
})
