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
    persistedSessionId?: string | null
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
    const SESSION_ID = 'session-123'
    const OTHER_SESSION_ID = 'session-456'

    const getTrigger = ({
        triggers = [],
        initialUrl = 'https://example.com/',
        persistedSessionId = null,
    }: GetTriggerParams = {}) => {
        const mockWindow = createMockWindow(initialUrl)
        let storedSessionId: string | null = persistedSessionId

        const trigger = new URLTrigger()
        trigger.init(triggers, {
            window: mockWindow as any,
            log: jest.fn(),
            getPersistedSessionId: () => storedSessionId,
            setPersistedSessionId: (sessionId) => {
                storedSessionId = sessionId
            },
        })

        const navigateTo = (url: string) => {
            mockWindow.location.href = url
            mockWindow.history.pushState()
        }

        return { trigger, mockWindow, navigateTo, getStoredSessionId: () => storedSessionId }
    }

    it('returns null when no triggers configured', () => {
        const { trigger } = getTrigger()

        expect(trigger.matches(SESSION_ID)).toBeNull()
    })

    it('returns false when triggers are configured but URL does not match', () => {
        const { trigger } = getTrigger({
            triggers: [{ url: '/trigger', matching: 'regex' }],
        })

        expect(trigger.matches(SESSION_ID)).toBe(false)
    })

    it('returns true when trigger URL is visited', () => {
        const { trigger, navigateTo } = getTrigger({
            triggers: [{ url: '/trigger', matching: 'regex' }],
        })

        expect(trigger.matches(SESSION_ID)).toBe(false)

        navigateTo('https://example.com/trigger')

        expect(trigger.matches(SESSION_ID)).toBe(true)
    })

    it('returns true immediately if initial URL matches trigger', () => {
        const { trigger } = getTrigger({
            triggers: [{ url: '/trigger', matching: 'regex' }],
            initialUrl: 'https://example.com/trigger',
        })

        expect(trigger.matches(SESSION_ID)).toBe(true)
    })

    it('stays triggered after trigger is visited', () => {
        const { trigger, navigateTo } = getTrigger({
            triggers: [{ url: '/trigger', matching: 'regex' }],
        })

        navigateTo('https://example.com/trigger')
        expect(trigger.matches(SESSION_ID)).toBe(true)

        navigateTo('https://example.com/other-page')
        expect(trigger.matches(SESSION_ID)).toBe(true)
    })

    it('triggers on any matching pattern from the list', () => {
        const { trigger, navigateTo } = getTrigger({
            triggers: [
                { url: '/trigger-a', matching: 'regex' },
                { url: '/trigger-b', matching: 'regex' },
            ],
        })

        expect(trigger.matches(SESSION_ID)).toBe(false)

        navigateTo('https://example.com/trigger-b')

        expect(trigger.matches(SESSION_ID)).toBe(true)
    })

    describe('session stickiness', () => {
        it('persists session ID when triggered', () => {
            const { trigger, navigateTo, getStoredSessionId } = getTrigger({
                triggers: [{ url: '/trigger', matching: 'regex' }],
            })

            expect(getStoredSessionId()).toBeNull()

            navigateTo('https://example.com/trigger')
            trigger.matches(SESSION_ID)

            expect(getStoredSessionId()).toBe(SESSION_ID)
        })

        it('returns true for same session if previously persisted', () => {
            const { trigger } = getTrigger({
                triggers: [{ url: '/trigger', matching: 'regex' }],
                persistedSessionId: SESSION_ID,
            })

            expect(trigger.matches(SESSION_ID)).toBe(true)
        })

        it('returns false for different session even if previously persisted', () => {
            const { trigger } = getTrigger({
                triggers: [{ url: '/trigger', matching: 'regex' }],
                persistedSessionId: OTHER_SESSION_ID,
            })

            expect(trigger.matches(SESSION_ID)).toBe(false)
        })

        it('persists across page loads (simulated via persistence)', () => {
            // First "page load" - trigger matches
            const mockWindow1 = createMockWindow('https://example.com/trigger')
            let storedSessionId: string | null = null

            const trigger1 = new URLTrigger()
            trigger1.init([{ url: '/trigger', matching: 'regex' }], {
                window: mockWindow1 as any,
                log: jest.fn(),
                getPersistedSessionId: () => storedSessionId,
                setPersistedSessionId: (sessionId) => {
                    storedSessionId = sessionId
                },
            })

            trigger1.matches(SESSION_ID)
            expect(storedSessionId).toBe(SESSION_ID)

            // Second "page load" - new trigger instance, but persistence remains
            const mockWindow2 = createMockWindow('https://example.com/other')
            const trigger2 = new URLTrigger()
            trigger2.init([{ url: '/trigger', matching: 'regex' }], {
                window: mockWindow2 as any,
                log: jest.fn(),
                getPersistedSessionId: () => storedSessionId,
                setPersistedSessionId: (sessionId) => {
                    storedSessionId = sessionId
                },
            })

            // Still returns true because sessionId is persisted
            expect(trigger2.matches(SESSION_ID)).toBe(true)
        })
    })

    describe('idempotency', () => {
        it('resets in-memory state when init is called again', () => {
            const mockWindow = createMockWindow('https://example.com/')
            let storedSessionId: string | null = null
            const trigger = new URLTrigger()

            trigger.init([{ url: '/trigger', matching: 'regex' }], {
                window: mockWindow as any,
                log: jest.fn(),
                getPersistedSessionId: () => storedSessionId,
                setPersistedSessionId: (sessionId) => {
                    storedSessionId = sessionId
                },
            })

            // Trigger it
            mockWindow.location.href = 'https://example.com/trigger'
            mockWindow.history.pushState()
            trigger.matches(SESSION_ID)

            // Re-init resets in-memory state
            mockWindow.location.href = 'https://example.com/'
            trigger.init([{ url: '/trigger', matching: 'regex' }], {
                window: mockWindow as any,
                log: jest.fn(),
                getPersistedSessionId: () => null, // Simulate no persistence
                setPersistedSessionId: jest.fn(),
            })

            expect(trigger.matches(SESSION_ID)).toBe(false)
        })
    })
})
