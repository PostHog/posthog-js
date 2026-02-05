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
    const getTrigger = (eventTriggers: string[]) => {
        const { posthog, fireEvent, getSubscriptionCount } = createMockPosthog()

        const trigger = new EventTrigger()
        trigger.init(eventTriggers, {
            posthog: posthog as any,
            log: jest.fn(),
        })

        return { trigger, fireEvent, posthog, getSubscriptionCount }
    }

    it('returns null when no event triggers are configured', () => {
        const { trigger } = getTrigger([])

        expect(trigger.shouldCapture()).toBeNull()
    })

    it('returns false initially when triggers are configured but none fired', () => {
        const { trigger } = getTrigger(['my-trigger-event'])

        expect(trigger.shouldCapture()).toBe(false)
    })

    it('returns true after a matching event is captured', () => {
        const { trigger, fireEvent } = getTrigger(['my-trigger-event'])

        fireEvent('my-trigger-event')

        expect(trigger.shouldCapture()).toBe(true)
    })

    it('ignores non-matching events', () => {
        const { trigger, fireEvent } = getTrigger(['my-trigger-event'])

        fireEvent('some-other-event')

        expect(trigger.shouldCapture()).toBe(false)
    })

    it('triggers on any matching event from the list', () => {
        const { trigger, fireEvent } = getTrigger(['event-a', 'event-b', 'event-c'])

        fireEvent('event-b')

        expect(trigger.shouldCapture()).toBe(true)
    })

    it('stays triggered once triggered', () => {
        const { trigger, fireEvent } = getTrigger(['my-trigger-event'])

        fireEvent('my-trigger-event')
        expect(trigger.shouldCapture()).toBe(true)

        fireEvent('some-other-event')
        expect(trigger.shouldCapture()).toBe(true)
    })

    describe('idempotency', () => {
        it('resets state when init is called again', () => {
            const { posthog, fireEvent } = createMockPosthog()
            const trigger = new EventTrigger()

            // First init
            trigger.init(['my-event'], { posthog: posthog as any, log: jest.fn() })
            fireEvent('my-event')
            expect(trigger.shouldCapture()).toBe(true)

            // Re-init should reset state
            trigger.init(['my-event'], { posthog: posthog as any, log: jest.fn() })
            expect(trigger.shouldCapture()).toBe(false)
        })

        it('unsubscribes old listener when init is called again', () => {
            const { posthog, getSubscriptionCount } = createMockPosthog()
            const trigger = new EventTrigger()

            // First init
            trigger.init(['my-event'], { posthog: posthog as any, log: jest.fn() })
            expect(getSubscriptionCount()).toBe(1)

            // Re-init should unsubscribe old and subscribe new
            trigger.init(['my-event'], { posthog: posthog as any, log: jest.fn() })
            expect(getSubscriptionCount()).toBe(1)

            // Third init
            trigger.init(['my-event'], { posthog: posthog as any, log: jest.fn() })
            expect(getSubscriptionCount()).toBe(1)
        })

        it('can change events on re-init', () => {
            const { posthog, fireEvent } = createMockPosthog()
            const trigger = new EventTrigger()

            // First init with one set of events
            trigger.init(['event-a'], { posthog: posthog as any, log: jest.fn() })
            fireEvent('event-a')
            expect(trigger.shouldCapture()).toBe(true)

            // Re-init with different events
            trigger.init(['event-b'], { posthog: posthog as any, log: jest.fn() })
            expect(trigger.shouldCapture()).toBe(false)

            // Old event shouldn't trigger
            fireEvent('event-a')
            expect(trigger.shouldCapture()).toBe(false)

            // New event should work
            fireEvent('event-b')
            expect(trigger.shouldCapture()).toBe(true)
        })
    })
})
