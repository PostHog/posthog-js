import { URLDecider } from '../url-decider'
import type { DeciderContext } from '../types'
import type { RemoteConfig, SDKPolicyConfigUrlTrigger } from '../../../../types'

interface MockWindow {
    location: { href: string }
    addEventListener: jest.Mock
    history: {
        pushState: jest.Mock
        replaceState: jest.Mock
    }
}

interface GetDeciderParams {
    triggers?: SDKPolicyConfigUrlTrigger[]
    blocklist?: SDKPolicyConfigUrlTrigger[]
    initialUrl?: string
}

const createMockContext = (
    urlTriggers: SDKPolicyConfigUrlTrigger[],
    urlBlocklist: SDKPolicyConfigUrlTrigger[],
    initialUrl: string
): { context: DeciderContext; mockWindow: MockWindow; navigateTo: (url: string) => void } => {
    const eventListeners: Record<string, (() => void)[]> = {}

    const mockWindow: MockWindow = {
        location: { href: initialUrl },
        addEventListener: jest.fn((event: string, callback: () => void) => {
            eventListeners[event] = eventListeners[event] || []
            eventListeners[event].push(callback)
        }),
        history: {
            pushState: jest.fn(),
            replaceState: jest.fn(),
        },
    }

    const context: DeciderContext = {
        posthog: null as any,
        window: mockWindow as any,
        config: {
            errorTracking: {
                url_triggers: urlTriggers,
                url_blocklist: urlBlocklist,
            },
        } as RemoteConfig,
        log: jest.fn(),
    }

    const navigateTo = (url: string) => {
        mockWindow.location.href = url
        mockWindow.history.pushState()
    }

    return { context, mockWindow, navigateTo }
}

describe('URLDecider', () => {
    const getDecider = ({
        triggers = [],
        blocklist = [],
        initialUrl = 'https://example.com/',
    }: GetDeciderParams = {}) => {
        const { context, mockWindow, navigateTo } = createMockContext(triggers, blocklist, initialUrl)
        const decider = new URLDecider()
        decider.init(context)
        return { decider, mockWindow, navigateTo, context }
    }

    it('returns null when no URL config', () => {
        const { decider } = getDecider()

        expect(decider.shouldCapture()).toBeNull()
    })

    it('returns true initially when only blocklist is configured and URL does not match', () => {
        const { decider } = getDecider({
            blocklist: [{ url: '/blocked', matching: 'regex' }],
        })

        expect(decider.shouldCapture()).toBe(true)
    })

    it('returns false when initial URL matches blocklist', () => {
        const { decider } = getDecider({
            blocklist: [{ url: '/blocked', matching: 'regex' }],
            initialUrl: 'https://example.com/blocked',
        })

        expect(decider.shouldCapture()).toBe(false)
    })

    it('returns true when initial URL matches trigger', () => {
        const { decider } = getDecider({
            triggers: [{ url: '/allowed', matching: 'regex' }],
            initialUrl: 'https://example.com/allowed',
        })

        expect(decider.shouldCapture()).toBe(true)
    })

    it('blocks when navigating to blocklisted URL', () => {
        const { decider, navigateTo } = getDecider({
            blocklist: [{ url: '/blocked', matching: 'regex' }],
        })

        expect(decider.shouldCapture()).toBe(true)

        navigateTo('https://example.com/blocked')

        expect(decider.shouldCapture()).toBe(false)
    })

    it('unblocks when navigating to trigger URL after being blocked', () => {
        const { decider, navigateTo } = getDecider({
            triggers: [{ url: '/trigger', matching: 'regex' }],
            blocklist: [{ url: '/blocked', matching: 'regex' }],
            initialUrl: 'https://example.com/blocked',
        })

        expect(decider.shouldCapture()).toBe(false)

        navigateTo('https://example.com/trigger')

        expect(decider.shouldCapture()).toBe(true)
    })

    it('stays blocked when navigating to non-trigger URL', () => {
        const { decider, navigateTo } = getDecider({
            triggers: [{ url: '/trigger', matching: 'regex' }],
            blocklist: [{ url: '/blocked', matching: 'regex' }],
            initialUrl: 'https://example.com/blocked',
        })

        expect(decider.shouldCapture()).toBe(false)

        navigateTo('https://example.com/some-other-page')

        expect(decider.shouldCapture()).toBe(false)
    })

    it('blocklist takes priority when URL matches both', () => {
        const { decider } = getDecider({
            triggers: [{ url: '/page', matching: 'regex' }],
            blocklist: [{ url: '/page', matching: 'regex' }],
            initialUrl: 'https://example.com/page',
        })

        expect(decider.shouldCapture()).toBe(false)
    })

    it('handles multiple patterns', () => {
        const { decider, navigateTo } = getDecider({
            triggers: [
                { url: '/trigger-a', matching: 'regex' },
                { url: '/trigger-b', matching: 'regex' },
            ],
            blocklist: [
                { url: '/blocked-a', matching: 'regex' },
                { url: '/blocked-b', matching: 'regex' },
            ],
        })

        expect(decider.shouldCapture()).toBe(true)

        navigateTo('https://example.com/blocked-b')
        expect(decider.shouldCapture()).toBe(false)

        navigateTo('https://example.com/trigger-a')
        expect(decider.shouldCapture()).toBe(true)
    })
})
