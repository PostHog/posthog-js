import { URLTrigger } from '../../../../extensions/triggers/behaviour/url-trigger'
import { PersistenceHelper } from '../../../../extensions/triggers/behaviour/persistence'
import type { TriggerOptions } from '../../../../extensions/triggers/behaviour/types'
import type { UrlTrigger } from '../../../../types'

interface MockWindow {
    location: { href: string }
    addEventListener: jest.Mock
    history: {
        pushState: jest.Mock & ((...args: any[]) => void)
        replaceState: jest.Mock & ((...args: any[]) => void)
    }
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
        triggers = [] as UrlTrigger[],
        initialUrl = 'https://example.com/',
        persistedData = {} as Record<string, string>,
        sessionId = SESSION_ID,
    } = {}) => {
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

        return { trigger, navigateTo, storage }
    }

    it('returns null when not configured', () => {
        const { trigger, storage } = createTrigger()

        expect(trigger.matches(SESSION_ID)).toBeNull()
        expect(storage['$error_tracking_url_session_id']).toBeUndefined()
    })

    it('returns false when URL does not match', () => {
        const { trigger, storage } = createTrigger({
            triggers: [{ url: '/trigger', matching: 'regex' }],
        })

        expect(trigger.matches(SESSION_ID)).toBe(false)
        expect(storage['$error_tracking_url_session_id']).toBeUndefined()
    })

    it('returns true when initial URL matches', () => {
        const { trigger, storage } = createTrigger({
            triggers: [{ url: '/trigger', matching: 'regex' }],
            initialUrl: 'https://example.com/trigger',
        })

        expect(trigger.matches(SESSION_ID)).toBe(true)
        expect(storage['$error_tracking_url_session_id']).toBe(SESSION_ID)
    })

    it('returns true when navigating to matching URL', () => {
        const { trigger, navigateTo, storage } = createTrigger({
            triggers: [{ url: '/trigger', matching: 'regex' }],
        })

        navigateTo('https://example.com/trigger')

        expect(trigger.matches(SESSION_ID)).toBe(true)
        expect(storage['$error_tracking_url_session_id']).toBe(SESSION_ID)
    })

    it('restores from persistence for same session', () => {
        const { trigger, storage } = createTrigger({
            triggers: [{ url: '/trigger', matching: 'regex' }],
            persistedData: { '$error_tracking_url_session_id': SESSION_ID },
        })

        expect(trigger.matches(SESSION_ID)).toBe(true)
        expect(storage['$error_tracking_url_session_id']).toBe(SESSION_ID)
    })

    it('does not restore for different session', () => {
        const { trigger, storage } = createTrigger({
            triggers: [{ url: '/trigger', matching: 'regex' }],
            persistedData: { '$error_tracking_url_session_id': OTHER_SESSION_ID },
        })

        expect(trigger.matches(SESSION_ID)).toBe(false)
        expect(storage['$error_tracking_url_session_id']).toBe(OTHER_SESSION_ID)
    })

    it('stays triggered after navigating away', () => {
        const { trigger, navigateTo, storage } = createTrigger({
            triggers: [{ url: '/trigger', matching: 'regex' }],
        })

        navigateTo('https://example.com/trigger')
        navigateTo('https://example.com/other')

        expect(trigger.matches(SESSION_ID)).toBe(true)
        expect(storage['$error_tracking_url_session_id']).toBe(SESSION_ID)
    })
})
