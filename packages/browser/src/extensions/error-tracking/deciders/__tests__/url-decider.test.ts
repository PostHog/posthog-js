import { URLDecider } from '../url-decider'
import type { DeciderContext } from '../types'
import type { UrlTrigger } from '../../../../types'

interface MockWindow {
    location: { href: string }
    addEventListener: jest.Mock
    history: {
        pushState: jest.Mock
        replaceState: jest.Mock
    }
}

interface GetDeciderParams {
    triggers?: UrlTrigger[]
    initialUrl?: string
}

const createMockContext = (
    urlTriggers: UrlTrigger[],
    initialUrl: string
): { context: DeciderContext; mockWindow: MockWindow; navigateTo: (url: string) => void } => {
    const mockWindow: MockWindow = {
        location: { href: initialUrl },
        addEventListener: jest.fn(),
        history: {
            pushState: jest.fn(),
            replaceState: jest.fn(),
        },
    }

    const context: DeciderContext = {
        posthog: null as any,
        window: mockWindow as any,
        config: urlTriggers.length > 0 ? { library: 'web', matchType: 'all', urlTriggers } : undefined,
        log: jest.fn(),
    }

    const navigateTo = (url: string) => {
        mockWindow.location.href = url
        mockWindow.history.pushState()
    }

    return { context, mockWindow, navigateTo }
}

describe('URLDecider', () => {
    const getDecider = ({ triggers = [], initialUrl = 'https://example.com/' }: GetDeciderParams = {}) => {
        const { context, mockWindow, navigateTo } = createMockContext(triggers, initialUrl)
        const decider = new URLDecider()
        decider.init(context)
        return { decider, mockWindow, navigateTo, context }
    }

    it('returns null when no triggers configured', () => {
        const { decider } = getDecider()

        expect(decider.shouldCapture()).toBeNull()
    })

    it('starts blocked (false) when triggers are configured', () => {
        const { decider } = getDecider({
            triggers: [{ url: '/trigger', matching: 'regex' }],
        })

        expect(decider.shouldCapture()).toBe(false)
    })

    it('unblocks when trigger URL is visited', () => {
        const { decider, navigateTo } = getDecider({
            triggers: [{ url: '/trigger', matching: 'regex' }],
        })

        expect(decider.shouldCapture()).toBe(false)

        navigateTo('https://example.com/trigger')

        expect(decider.shouldCapture()).toBe(true)
    })

    it('unblocks immediately if initial URL matches trigger', () => {
        const { decider } = getDecider({
            triggers: [{ url: '/trigger', matching: 'regex' }],
            initialUrl: 'https://example.com/trigger',
        })

        expect(decider.shouldCapture()).toBe(true)
    })

    it('stays triggered after trigger is visited', () => {
        const { decider, navigateTo } = getDecider({
            triggers: [{ url: '/trigger', matching: 'regex' }],
        })

        navigateTo('https://example.com/trigger')
        expect(decider.shouldCapture()).toBe(true)

        navigateTo('https://example.com/other-page')
        expect(decider.shouldCapture()).toBe(true)
    })

    it('triggers on any matching pattern from the list', () => {
        const { decider, navigateTo } = getDecider({
            triggers: [
                { url: '/trigger-a', matching: 'regex' },
                { url: '/trigger-b', matching: 'regex' },
            ],
        })

        expect(decider.shouldCapture()).toBe(false)

        navigateTo('https://example.com/trigger-b')

        expect(decider.shouldCapture()).toBe(true)
    })

    it('does not re-check same URL', () => {
        const { context, navigateTo } = getDecider({
            triggers: [{ url: '/trigger', matching: 'regex' }],
        })

        navigateTo('https://example.com/')
        navigateTo('https://example.com/')

        const logCalls = (context.log as jest.Mock).mock.calls.filter((call) => call[0].includes('URL checked'))
        expect(logCalls.length).toBe(1)
    })
})
