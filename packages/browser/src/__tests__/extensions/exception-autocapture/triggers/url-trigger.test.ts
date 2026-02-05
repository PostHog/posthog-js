import { URLTrigger } from '../../../../extensions/exception-autocapture/controls/triggers/url-trigger'
import type { UrlTrigger } from '../../../../types'

interface MockWindow {
    location: { href: string }
    addEventListener: jest.Mock
    history: {
        pushState: jest.Mock
        replaceState: jest.Mock
    }
}

interface GetTriggerParams {
    triggers?: UrlTrigger[]
    initialUrl?: string
}

const createMockWindow = (initialUrl: string): MockWindow => ({
    location: { href: initialUrl },
    addEventListener: jest.fn(),
    history: {
        pushState: jest.fn(),
        replaceState: jest.fn(),
    },
})

describe('URLTrigger', () => {
    const getTrigger = ({ triggers = [], initialUrl = 'https://example.com/' }: GetTriggerParams = {}) => {
        const mockWindow = createMockWindow(initialUrl)

        const trigger = new URLTrigger()
        trigger.init(triggers, {
            window: mockWindow as any,
            log: jest.fn(),
        })

        const navigateTo = (url: string) => {
            mockWindow.location.href = url
            mockWindow.history.pushState()
        }

        return { trigger, mockWindow, navigateTo }
    }

    it('returns null when no triggers configured', () => {
        const { trigger } = getTrigger()

        expect(trigger.shouldCapture()).toBeNull()
    })

    it('starts blocked (false) when triggers are configured', () => {
        const { trigger } = getTrigger({
            triggers: [{ url: '/trigger', matching: 'regex' }],
        })

        expect(trigger.shouldCapture()).toBe(false)
    })

    it('unblocks when trigger URL is visited', () => {
        const { trigger, navigateTo } = getTrigger({
            triggers: [{ url: '/trigger', matching: 'regex' }],
        })

        expect(trigger.shouldCapture()).toBe(false)

        navigateTo('https://example.com/trigger')

        expect(trigger.shouldCapture()).toBe(true)
    })

    it('unblocks immediately if initial URL matches trigger', () => {
        const { trigger } = getTrigger({
            triggers: [{ url: '/trigger', matching: 'regex' }],
            initialUrl: 'https://example.com/trigger',
        })

        expect(trigger.shouldCapture()).toBe(true)
    })

    it('stays triggered after trigger is visited', () => {
        const { trigger, navigateTo } = getTrigger({
            triggers: [{ url: '/trigger', matching: 'regex' }],
        })

        navigateTo('https://example.com/trigger')
        expect(trigger.shouldCapture()).toBe(true)

        navigateTo('https://example.com/other-page')
        expect(trigger.shouldCapture()).toBe(true)
    })

    it('triggers on any matching pattern from the list', () => {
        const { trigger, navigateTo } = getTrigger({
            triggers: [
                { url: '/trigger-a', matching: 'regex' },
                { url: '/trigger-b', matching: 'regex' },
            ],
        })

        expect(trigger.shouldCapture()).toBe(false)

        navigateTo('https://example.com/trigger-b')

        expect(trigger.shouldCapture()).toBe(true)
    })
})
