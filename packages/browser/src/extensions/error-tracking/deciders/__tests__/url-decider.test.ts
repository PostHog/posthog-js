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

    describe('only triggers configured', () => {
        it('starts blocked (false)', () => {
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

        it('stays unblocked after trigger is visited', () => {
            const { decider, navigateTo } = getDecider({
                triggers: [{ url: '/trigger', matching: 'regex' }],
            })

            navigateTo('https://example.com/trigger')
            expect(decider.shouldCapture()).toBe(true)

            navigateTo('https://example.com/other-page')
            expect(decider.shouldCapture()).toBe(true)
        })
    })

    describe('only blocklist configured', () => {
        it('starts unblocked (true)', () => {
            const { decider } = getDecider({
                blocklist: [{ url: '/blocked', matching: 'regex' }],
            })

            expect(decider.shouldCapture()).toBe(true)
        })

        it('blocks when blocklist URL is visited', () => {
            const { decider, navigateTo } = getDecider({
                blocklist: [{ url: '/blocked', matching: 'regex' }],
            })

            expect(decider.shouldCapture()).toBe(true)

            navigateTo('https://example.com/blocked')

            expect(decider.shouldCapture()).toBe(false)
        })

        it('blocks immediately if initial URL matches blocklist', () => {
            const { decider } = getDecider({
                blocklist: [{ url: '/blocked', matching: 'regex' }],
                initialUrl: 'https://example.com/blocked',
            })

            expect(decider.shouldCapture()).toBe(false)
        })

        it('stays blocked after blocklist is visited', () => {
            const { decider, navigateTo } = getDecider({
                blocklist: [{ url: '/blocked', matching: 'regex' }],
            })

            navigateTo('https://example.com/blocked')
            expect(decider.shouldCapture()).toBe(false)

            navigateTo('https://example.com/other-page')
            expect(decider.shouldCapture()).toBe(false)
        })
    })

    describe('both triggers and blocklist configured', () => {
        it('starts unblocked (true)', () => {
            const { decider } = getDecider({
                triggers: [{ url: '/trigger', matching: 'regex' }],
                blocklist: [{ url: '/blocked', matching: 'regex' }],
            })

            expect(decider.shouldCapture()).toBe(true)
        })

        it('blocks when blocklist URL is visited', () => {
            const { decider, navigateTo } = getDecider({
                triggers: [{ url: '/trigger', matching: 'regex' }],
                blocklist: [{ url: '/blocked', matching: 'regex' }],
            })

            navigateTo('https://example.com/blocked')

            expect(decider.shouldCapture()).toBe(false)
        })

        it('unblocks when trigger URL is visited after being blocked', () => {
            const { decider, navigateTo } = getDecider({
                triggers: [{ url: '/trigger', matching: 'regex' }],
                blocklist: [{ url: '/blocked', matching: 'regex' }],
            })

            navigateTo('https://example.com/blocked')
            expect(decider.shouldCapture()).toBe(false)

            navigateTo('https://example.com/trigger')
            expect(decider.shouldCapture()).toBe(true)
        })

        it('trigger takes priority when URL matches both', () => {
            const { decider } = getDecider({
                triggers: [{ url: '/page', matching: 'regex' }],
                blocklist: [{ url: '/page', matching: 'regex' }],
                initialUrl: 'https://example.com/page',
            })

            expect(decider.shouldCapture()).toBe(true)
        })

        it('can toggle between blocked and unblocked', () => {
            const { decider, navigateTo } = getDecider({
                triggers: [{ url: '/trigger', matching: 'regex' }],
                blocklist: [{ url: '/blocked', matching: 'regex' }],
            })

            expect(decider.shouldCapture()).toBe(true)

            navigateTo('https://example.com/blocked')
            expect(decider.shouldCapture()).toBe(false)

            navigateTo('https://example.com/trigger')
            expect(decider.shouldCapture()).toBe(true)

            navigateTo('https://example.com/blocked')
            expect(decider.shouldCapture()).toBe(false)
        })
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

    it('does not re-check same URL', () => {
        const { context, navigateTo } = getDecider({
            blocklist: [{ url: '/blocked', matching: 'regex' }],
        })

        navigateTo('https://example.com/')
        navigateTo('https://example.com/')

        const logCalls = (context.log as jest.Mock).mock.calls.filter(
            (call) => call[0].includes('URL checked')
        )
        expect(logCalls.length).toBe(1)
    })
})
