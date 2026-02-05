import { URLTrigger } from '../../../../extensions/exception-autocapture/controls/triggers/url-trigger'
import type { UrlTrigger } from '../../../../types'

interface MockWindow {
    location: { href: string }
    addEventListener: jest.Mock
    history: {
        pushState: jest.Mock & ((...args: any[]) => void)
        replaceState: jest.Mock & ((...args: any[]) => void)
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

    describe('idempotency', () => {
        it('resets state when init is called again', () => {
            const mockWindow = createMockWindow('https://example.com/')
            const trigger = new URLTrigger()

            // First init with triggers
            trigger.init([{ url: '/trigger', matching: 'regex' }], {
                window: mockWindow as any,
                log: jest.fn(),
            })

            // Trigger it
            mockWindow.location.href = 'https://example.com/trigger'
            mockWindow.history.pushState()
            expect(trigger.shouldCapture()).toBe(true)

            // Re-init with same triggers - should reset triggered state
            mockWindow.location.href = 'https://example.com/'
            trigger.init([{ url: '/trigger', matching: 'regex' }], {
                window: mockWindow as any,
                log: jest.fn(),
            })

            expect(trigger.shouldCapture()).toBe(false)
        })

        it('can change triggers on re-init', () => {
            const mockWindow = createMockWindow('https://example.com/')
            const trigger = new URLTrigger()

            // First init with one trigger
            trigger.init([{ url: '/old-trigger', matching: 'regex' }], {
                window: mockWindow as any,
                log: jest.fn(),
            })
            expect(trigger.shouldCapture()).toBe(false)

            // Re-init with different trigger that matches current URL
            mockWindow.location.href = 'https://example.com/new-trigger'
            trigger.init([{ url: '/new-trigger', matching: 'regex' }], {
                window: mockWindow as any,
                log: jest.fn(),
            })

            expect(trigger.shouldCapture()).toBe(true)
        })

        it('restores original history methods on re-init', () => {
            const mockWindow = createMockWindow('https://example.com/')
            const originalPushState = mockWindow.history.pushState
            const originalReplaceState = mockWindow.history.replaceState

            const trigger = new URLTrigger()

            // First init
            trigger.init([{ url: '/trigger', matching: 'regex' }], {
                window: mockWindow as any,
                log: jest.fn(),
            })

            // History methods should be wrapped
            expect(mockWindow.history.pushState).not.toBe(originalPushState)
            expect(mockWindow.history.replaceState).not.toBe(originalReplaceState)

            // Re-init should restore and re-wrap
            trigger.init([{ url: '/trigger', matching: 'regex' }], {
                window: mockWindow as any,
                log: jest.fn(),
            })

            // Methods should still work (wrapped again)
            mockWindow.location.href = 'https://example.com/trigger'
            mockWindow.history.pushState()
            expect(trigger.shouldCapture()).toBe(true)
        })
    })
})
