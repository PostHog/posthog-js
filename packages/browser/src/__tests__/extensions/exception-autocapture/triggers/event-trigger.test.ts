import { EventTrigger } from '../../../../extensions/exception-autocapture/controls/triggers/event-trigger'

type EventCallback = (event: { event: string }) => void

const createMockPosthog = (): {
    posthog: any
    fireEvent: (name: string) => void
    getSubscriptionCount: () => number
} => {
    const callbacks: EventCallback[] = []

    const posthog = {
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

    const getSubscriptionCount = () => callbacks.length

    return { posthog, fireEvent, getSubscriptionCount }
}

describe('EventTrigger', () => {
    const SESSION_ID = 'session-123'
    const OTHER_SESSION_ID = 'session-456'

    const getTrigger = (
        eventTriggers: string[],
        persistedSessionId: string | null = null
    ) => {
        const { posthog, fireEvent, getSubscriptionCount } = createMockPosthog()
        let storedSessionId: string | null = persistedSessionId

        const trigger = new EventTrigger()
        trigger.init(eventTriggers, {
            posthog: posthog as any,
            log: jest.fn(),
            getPersistedSessionId: () => storedSessionId,
            setPersistedSessionId: (sessionId) => {
                storedSessionId = sessionId
            },
        })

        return { trigger, fireEvent, posthog, getSubscriptionCount, getStoredSessionId: () => storedSessionId }
    }

    it('returns null when no event triggers are configured', () => {
        const { trigger } = getTrigger([])

        expect(trigger.matches(SESSION_ID)).toBeNull()
    })

    it('returns false initially when triggers are configured but none fired', () => {
        const { trigger } = getTrigger(['my-trigger-event'])

        expect(trigger.matches(SESSION_ID)).toBe(false)
    })

    it('returns true after a matching event is captured', () => {
        const { trigger, fireEvent } = getTrigger(['my-trigger-event'])

        fireEvent('my-trigger-event')

        expect(trigger.matches(SESSION_ID)).toBe(true)
    })

    it('ignores non-matching events', () => {
        const { trigger, fireEvent } = getTrigger(['my-trigger-event'])

        fireEvent('some-other-event')

        expect(trigger.matches(SESSION_ID)).toBe(false)
    })

    it('triggers on any matching event from the list', () => {
        const { trigger, fireEvent } = getTrigger(['event-a', 'event-b', 'event-c'])

        fireEvent('event-b')

        expect(trigger.matches(SESSION_ID)).toBe(true)
    })

    it('stays triggered once triggered', () => {
        const { trigger, fireEvent } = getTrigger(['my-trigger-event'])

        fireEvent('my-trigger-event')
        expect(trigger.matches(SESSION_ID)).toBe(true)

        fireEvent('some-other-event')
        expect(trigger.matches(SESSION_ID)).toBe(true)
    })

    describe('session stickiness', () => {
        it('persists session ID when triggered', () => {
            const { trigger, fireEvent, getStoredSessionId } = getTrigger(['my-event'])

            expect(getStoredSessionId()).toBeNull()

            fireEvent('my-event')
            trigger.matches(SESSION_ID)

            expect(getStoredSessionId()).toBe(SESSION_ID)
        })

        it('returns true for same session if previously persisted', () => {
            const { trigger } = getTrigger(['my-event'], SESSION_ID)

            expect(trigger.matches(SESSION_ID)).toBe(true)
        })

        it('returns false for different session even if previously persisted', () => {
            const { trigger } = getTrigger(['my-event'], OTHER_SESSION_ID)

            expect(trigger.matches(SESSION_ID)).toBe(false)
        })
    })

    describe('idempotency', () => {
        it('resets state when init is called again', () => {
            const { posthog, fireEvent } = createMockPosthog()
            const trigger = new EventTrigger()

            trigger.init(['my-event'], {
                posthog: posthog as any,
                log: jest.fn(),
                getPersistedSessionId: () => null,
                setPersistedSessionId: jest.fn(),
            })
            fireEvent('my-event')
            expect(trigger.matches(SESSION_ID)).toBe(true)

            // Re-init should reset state
            trigger.init(['my-event'], {
                posthog: posthog as any,
                log: jest.fn(),
                getPersistedSessionId: () => null,
                setPersistedSessionId: jest.fn(),
            })
            expect(trigger.matches(SESSION_ID)).toBe(false)
        })

        it('unsubscribes old listener when init is called again', () => {
            const { posthog, getSubscriptionCount } = createMockPosthog()
            const trigger = new EventTrigger()

            trigger.init(['my-event'], {
                posthog: posthog as any,
                log: jest.fn(),
                getPersistedSessionId: () => null,
                setPersistedSessionId: jest.fn(),
            })
            expect(getSubscriptionCount()).toBe(1)

            trigger.init(['my-event'], {
                posthog: posthog as any,
                log: jest.fn(),
                getPersistedSessionId: () => null,
                setPersistedSessionId: jest.fn(),
            })
            expect(getSubscriptionCount()).toBe(1)
        })
    })
})
