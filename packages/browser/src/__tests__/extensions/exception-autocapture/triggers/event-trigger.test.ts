import { EventTrigger } from '../../../../extensions/exception-autocapture/controls/triggers/event-trigger'

type EventCallback = (event: { event: string }) => void

const createMockPosthog = (): { posthog: any; fireEvent: (name: string) => void } => {
    let eventCallback: EventCallback | null = null

    const posthog = {
        on: jest.fn((eventName: string, callback: EventCallback) => {
            if (eventName === 'eventCaptured') {
                eventCallback = callback
            }
        }),
    }

    const fireEvent = (name: string) => {
        eventCallback?.({ event: name })
    }

    return { posthog, fireEvent }
}

describe('EventTrigger', () => {
    const getTrigger = (eventTriggers: string[]) => {
        const { posthog, fireEvent } = createMockPosthog()

        const trigger = new EventTrigger()
        trigger.init(eventTriggers, {
            posthog: posthog as any,
            log: jest.fn(),
        })

        return { trigger, fireEvent }
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
})
