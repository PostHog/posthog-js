import { URLTrigger } from '../../../../extensions/exception-autocapture/controls/triggers/url-trigger'
import { PersistenceHelper } from '../../../../extensions/exception-autocapture/controls/triggers/persistence'
import type { TriggerOptions } from '../../../../extensions/exception-autocapture/controls/triggers/types'
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
    persistedData?: Record<string, string>
    sessionId?: string
}

const createMockWindow = (initialUrl: string): MockWindow => ({
    location: { href: initialUrl },
    addEventListener: jest.fn(),
    history: {
        pushState: jest.fn(),
        replaceState: jest.fn(),
    },
})

const createMockPosthog = (sessionId: string) => ({
    get_session_id: jest.fn(() => sessionId),
})

describe('URLTrigger', () => {
    const SESSION_ID = 'session-123'
    const OTHER_SESSION_ID = 'session-456'

    const createTrigger = ({
        triggers = [],
        initialUrl = 'https://example.com/',
        persistedData = {},
        sessionId = SESSION_ID,
    }: GetTriggerParams = {}) => {
        const mockWindow = createMockWindow(initialUrl)
        const mockPosthog = createMockPosthog(sessionId)
        const storage: Record<string, string> = { ...persistedData }

        const persistence = new PersistenceHelper(
            (key) => storage[key] ?? null,
            (key, value) => {
                storage[key] = value
            }
        ).withPrefix('error_tracking')

        const options: TriggerOptions = {
            posthog: mockPosthog as any,
            window: mockWindow as any,
            log: jest.fn(),
            persistence,
        }

        const trigger = new URLTrigger(options, triggers)

        const navigateTo = (url: string) => {
            mockWindow.location.href = url
            mockWindow.history.pushState()
        }

        return { trigger, mockWindow, navigateTo, storage, options, persistence, mockPosthog }
    }

    it('returns null when no triggers configured', () => {
        const { trigger } = createTrigger()

        expect(trigger.matches(SESSION_ID)).toBeNull()
    })

    it('returns false when triggers are configured but URL does not match', () => {
        const { trigger } = createTrigger({
            triggers: [{ url: '/trigger', matching: 'regex' }],
        })

        expect(trigger.matches(SESSION_ID)).toBe(false)
    })

    it('returns true when trigger URL is visited', () => {
        const { trigger, navigateTo } = createTrigger({
            triggers: [{ url: '/trigger', matching: 'regex' }],
        })

        expect(trigger.matches(SESSION_ID)).toBe(false)

        navigateTo('https://example.com/trigger')

        expect(trigger.matches(SESSION_ID)).toBe(true)
    })

    it('returns true immediately if initial URL matches trigger', () => {
        const { trigger } = createTrigger({
            triggers: [{ url: '/trigger', matching: 'regex' }],
            initialUrl: 'https://example.com/trigger',
        })

        expect(trigger.matches(SESSION_ID)).toBe(true)
    })

    it('stays triggered after trigger is visited', () => {
        const { trigger, navigateTo } = createTrigger({
            triggers: [{ url: '/trigger', matching: 'regex' }],
        })

        navigateTo('https://example.com/trigger')
        expect(trigger.matches(SESSION_ID)).toBe(true)

        navigateTo('https://example.com/other-page')
        expect(trigger.matches(SESSION_ID)).toBe(true)
    })

    it('triggers on any matching pattern from the list', () => {
        const { trigger, navigateTo } = createTrigger({
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
        it('persists session ID when URL matches', () => {
            const { storage } = createTrigger({
                triggers: [{ url: '/trigger', matching: 'regex' }],
                initialUrl: 'https://example.com/trigger',
            })

            expect(storage['$error_tracking_url_session']).toBe(SESSION_ID)
        })

        it('persists session ID when navigating to trigger URL', () => {
            const { navigateTo, storage } = createTrigger({
                triggers: [{ url: '/trigger', matching: 'regex' }],
            })

            expect(storage['$error_tracking_url_session']).toBeUndefined()

            navigateTo('https://example.com/trigger')

            expect(storage['$error_tracking_url_session']).toBe(SESSION_ID)
        })

        it('returns true for same session if previously persisted', () => {
            const { trigger } = createTrigger({
                triggers: [{ url: '/trigger', matching: 'regex' }],
                persistedData: { '$error_tracking_url_session': SESSION_ID },
            })

            expect(trigger.matches(SESSION_ID)).toBe(true)
        })

        it('returns false for different session even if previously persisted', () => {
            const { trigger } = createTrigger({
                triggers: [{ url: '/trigger', matching: 'regex' }],
                persistedData: { '$error_tracking_url_session': OTHER_SESSION_ID },
            })

            expect(trigger.matches(SESSION_ID)).toBe(false)
        })

        it('persists across page loads (simulated via persistence)', () => {
            const storage: Record<string, string> = {}
            const persistence = new PersistenceHelper(
                (key) => storage[key] ?? null,
                (key, value) => {
                    storage[key] = value
                }
            ).withPrefix('error_tracking')

            // First "page load" - trigger matches
            const mockWindow1 = createMockWindow('https://example.com/trigger')
            const mockPosthog1 = createMockPosthog(SESSION_ID)
            const options1: TriggerOptions = {
                posthog: mockPosthog1 as any,
                window: mockWindow1 as any,
                log: jest.fn(),
                persistence,
            }
            new URLTrigger(options1, [{ url: '/trigger', matching: 'regex' }])

            expect(storage['$error_tracking_url_session']).toBe(SESSION_ID)

            // Second "page load" - new trigger instance, but persistence remains
            const mockWindow2 = createMockWindow('https://example.com/other')
            const mockPosthog2 = createMockPosthog(SESSION_ID)
            const options2: TriggerOptions = {
                posthog: mockPosthog2 as any,
                window: mockWindow2 as any,
                log: jest.fn(),
                persistence,
            }
            const trigger2 = new URLTrigger(options2, [{ url: '/trigger', matching: 'regex' }])

            // Still returns true because sessionId is persisted
            expect(trigger2.matches(SESSION_ID)).toBe(true)
        })
    })
})
