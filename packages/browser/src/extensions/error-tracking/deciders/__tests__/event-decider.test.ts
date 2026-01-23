import { EventDecider } from '../event-decider'
import type { DeciderContext } from '../types'

type EventCallback = (event: { event: string }) => void

const createMockContext = (eventTriggers: string[]): { context: DeciderContext; fireEvent: (name: string) => void } => {
    let eventCallback: EventCallback | null = null

    const context: DeciderContext = {
        posthog: {
            on: jest.fn((eventName: string, callback: EventCallback) => {
                if (eventName === 'eventCaptured') {
                    eventCallback = callback
                }
            }),
        } as any,
        window: null as any,
        config: eventTriggers.length > 0 ? { library: 'web', matchType: 'all', eventTriggers } : undefined,
        log: jest.fn(),
    }

    const fireEvent = (name: string) => {
        eventCallback?.({ event: name })
    }

    return { context, fireEvent }
}

describe('EventDecider', () => {
    const getDecider = (eventTriggers: string[]) => {
        const { context, fireEvent } = createMockContext(eventTriggers)
        const decider = new EventDecider()
        decider.init(context)
        return { decider, fireEvent }
    }

    it('returns null when no event triggers are configured', () => {
        const { decider } = getDecider([])

        expect(decider.shouldCapture()).toBeNull()
    })

    it('returns false initially when triggers are configured but none fired', () => {
        const { decider } = getDecider(['my-trigger-event'])

        expect(decider.shouldCapture()).toBe(false)
    })

    it('returns true after a matching event is captured', () => {
        const { decider, fireEvent } = getDecider(['my-trigger-event'])

        fireEvent('my-trigger-event')

        expect(decider.shouldCapture()).toBe(true)
    })

    it('ignores non-matching events', () => {
        const { decider, fireEvent } = getDecider(['my-trigger-event'])

        fireEvent('some-other-event')

        expect(decider.shouldCapture()).toBe(false)
    })

    it('triggers on any matching event from the list', () => {
        const { decider, fireEvent } = getDecider(['event-a', 'event-b', 'event-c'])

        fireEvent('event-b')

        expect(decider.shouldCapture()).toBe(true)
    })

    it('stays triggered once triggered', () => {
        const { decider, fireEvent } = getDecider(['my-trigger-event'])

        fireEvent('my-trigger-event')
        expect(decider.shouldCapture()).toBe(true)

        fireEvent('some-other-event')
        expect(decider.shouldCapture()).toBe(true)
    })
})
