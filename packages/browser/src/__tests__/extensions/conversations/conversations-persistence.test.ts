/* eslint-disable compat/compat */
import { ConversationsPersistence } from '../../../extensions/conversations/external/persistence'
import { UserProvidedTraits } from '../../../posthog-conversations-types'
import { PostHog } from '../../../posthog-core'

const TEST_TOKEN = 'phc_test_token_123'
const STORAGE_KEY = 'ph_conv_' + TEST_TOKEN

// Legacy PostHog persistence keys (for migration tests)
const LEGACY_WIDGET_SESSION_ID = '$conversations_widget_session_id'
const LEGACY_TICKET_ID = '$conversations_ticket_id'
const LEGACY_WIDGET_STATE = '$conversations_widget_state'
const LEGACY_USER_TRAITS = '$conversations_user_traits'

// Legacy PostHog persistence blob key
const LEGACY_PH_KEY = 'ph_' + TEST_TOKEN + '_posthog'

describe('ConversationsPersistence', () => {
    let persistence: ConversationsPersistence
    let mockPosthog: PostHog
    let localStorageData: Record<string, string>

    beforeEach(() => {
        jest.restoreAllMocks()
        jest.clearAllMocks()

        localStorageData = {}

        // Mock localStorage
        const localStorageMock = {
            getItem: jest.fn((key: string) => localStorageData[key] ?? null),
            setItem: jest.fn((key: string, value: string) => {
                localStorageData[key] = value
            }),
            removeItem: jest.fn((key: string) => {
                delete localStorageData[key]
            }),
        }
        Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true })

        mockPosthog = {
            get_distinct_id: jest.fn().mockReturnValue('test-distinct-id'),
            config: { token: TEST_TOKEN },
            persistence: {
                props: {},
                get_property: jest.fn().mockReturnValue(undefined),
                register: jest.fn(),
                unregister: jest.fn(),
                isDisabled: jest.fn().mockReturnValue(false),
            },
        } as unknown as PostHog

        persistence = new ConversationsPersistence(mockPosthog)
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    function readStorage(): Record<string, any> | null {
        const raw = localStorageData[STORAGE_KEY]
        return raw ? JSON.parse(raw) : null
    }

    describe('widget_session_id persistence', () => {
        it('should generate and persist widget_session_id', () => {
            const sessionId = persistence.getOrCreateWidgetSessionId()

            expect(sessionId).toMatch(/^[0-9a-f-]{36}$/i)

            const stored = readStorage()
            expect(stored?.widgetSessionId).toBe(sessionId)
        })

        it('should return same widget_session_id on subsequent calls', () => {
            const sessionId1 = persistence.getOrCreateWidgetSessionId()
            const sessionId2 = persistence.getOrCreateWidgetSessionId()

            expect(sessionId1).toBe(sessionId2)
        })

        it('should return existing widget_session_id from localStorage', () => {
            const existingSessionId = 'existing-session-id-12345'
            localStorageData[STORAGE_KEY] = JSON.stringify({ widgetSessionId: existingSessionId })

            // Create fresh instance so cache is empty
            persistence = new ConversationsPersistence(mockPosthog)
            const sessionId = persistence.getOrCreateWidgetSessionId()

            expect(sessionId).toBe(existingSessionId)
        })

        it('should return same widget_session_id even after distinct_id changes', () => {
            const sessionIdBefore = persistence.getOrCreateWidgetSessionId()

            ;(mockPosthog.get_distinct_id as jest.Mock).mockReturnValue('new-user@example.com')

            const sessionIdAfter = persistence.getOrCreateWidgetSessionId()
            expect(sessionIdBefore).toBe(sessionIdAfter)
        })

        it('should clear widget_session_id', () => {
            const sessionId = persistence.getOrCreateWidgetSessionId()
            expect(readStorage()?.widgetSessionId).toBe(sessionId)

            persistence.clearWidgetSessionId()

            expect(readStorage()?.widgetSessionId).toBeUndefined()
        })

        it('should set widget_session_id from restore flow', () => {
            persistence.setWidgetSessionId('restored-session-id-123')

            expect(readStorage()?.widgetSessionId).toBe('restored-session-id-123')
            expect(persistence.getOrCreateWidgetSessionId()).toBe('restored-session-id-123')
        })

        it('should generate new widget_session_id after clearing', () => {
            const sessionId1 = persistence.getOrCreateWidgetSessionId()
            persistence.clearWidgetSessionId()

            // Create new persistence instance to clear internal cache
            persistence = new ConversationsPersistence(mockPosthog)
            const sessionId2 = persistence.getOrCreateWidgetSessionId()

            expect(sessionId1).not.toBe(sessionId2)
        })

        it('should handle localStorage errors gracefully', () => {
            ;(window.localStorage.getItem as jest.Mock).mockImplementation(() => {
                throw new Error('Storage error')
            })

            persistence = new ConversationsPersistence(mockPosthog)
            const sessionId = persistence.getOrCreateWidgetSessionId()
            expect(sessionId).toMatch(/^[0-9a-f-]{36}$/i)
        })

        it('should return the same fallback UUID on repeated calls when localStorage is broken', () => {
            ;(window.localStorage.getItem as jest.Mock).mockImplementation(() => {
                throw new Error('Storage error')
            })

            persistence = new ConversationsPersistence(mockPosthog)
            const sessionId1 = persistence.getOrCreateWidgetSessionId()
            const sessionId2 = persistence.getOrCreateWidgetSessionId()

            expect(sessionId1).toBe(sessionId2)
        })

        it('should handle missing token gracefully', () => {
            ;(mockPosthog as any).config = { token: undefined }

            persistence = new ConversationsPersistence(mockPosthog)
            const sessionId = persistence.getOrCreateWidgetSessionId()
            expect(sessionId).toMatch(/^[0-9a-f-]{36}$/i)
        })
    })

    describe('ticket ID persistence', () => {
        it('should save and load ticket ID', () => {
            persistence.saveTicketId('ticket-123')
            expect(readStorage()?.ticketId).toBe('ticket-123')

            expect(persistence.loadTicketId()).toBe('ticket-123')
        })

        it('should return null if no ticket ID is stored', () => {
            expect(persistence.loadTicketId()).toBeNull()
        })

        it('should keep same ticket after distinct_id changes (identify)', () => {
            persistence.saveTicketId('ticket-123')
            ;(mockPosthog.get_distinct_id as jest.Mock).mockReturnValue('new-user@example.com')

            expect(persistence.loadTicketId()).toBe('ticket-123')
        })

        it('should clear ticket ID', () => {
            persistence.saveTicketId('ticket-123')
            expect(persistence.loadTicketId()).toBe('ticket-123')

            persistence.clearTicketId()
            expect(persistence.loadTicketId()).toBeNull()
        })

        it('should handle localStorage write errors gracefully', () => {
            ;(window.localStorage.setItem as jest.Mock).mockImplementation(() => {
                throw new Error('Storage full')
            })

            expect(() => persistence.saveTicketId('ticket-123')).not.toThrow()
        })

        it('should handle localStorage read errors gracefully', () => {
            ;(window.localStorage.getItem as jest.Mock).mockImplementation(() => {
                throw new Error('Storage error')
            })

            persistence = new ConversationsPersistence(mockPosthog)
            expect(persistence.loadTicketId()).toBeNull()
        })
    })

    describe('widget state persistence', () => {
        it('should save and load widget state', () => {
            persistence.saveWidgetState('open')
            expect(readStorage()?.widgetState).toBe('open')
            expect(persistence.loadWidgetState()).toBe('open')

            persistence.saveWidgetState('closed')
            expect(readStorage()?.widgetState).toBe('closed')
            expect(persistence.loadWidgetState()).toBe('closed')
        })

        it('should return null if no state is stored', () => {
            expect(persistence.loadWidgetState()).toBeNull()
        })

        it('should return null for invalid state values', () => {
            localStorageData[STORAGE_KEY] = JSON.stringify({ widgetState: 'invalid' })
            persistence = new ConversationsPersistence(mockPosthog)

            expect(persistence.loadWidgetState()).toBeNull()
        })

        it('should handle localStorage errors gracefully', () => {
            ;(window.localStorage.setItem as jest.Mock).mockImplementation(() => {
                throw new Error('Storage full')
            })

            expect(() => persistence.saveWidgetState('open')).not.toThrow()
            ;(window.localStorage.getItem as jest.Mock).mockImplementation(() => {
                throw new Error('Storage error')
            })

            persistence = new ConversationsPersistence(mockPosthog)
            expect(persistence.loadWidgetState()).toBeNull()
        })
    })

    describe('user traits persistence', () => {
        it('should save and load user traits', () => {
            const traits: UserProvidedTraits = {
                name: 'Test User',
                email: 'test@example.com',
            }

            persistence.saveUserTraits(traits)
            expect(readStorage()?.userTraits).toEqual(traits)

            expect(persistence.loadUserTraits()).toEqual(traits)
        })

        it('should return null if no traits are stored', () => {
            expect(persistence.loadUserTraits()).toBeNull()
        })

        it('should handle partial traits', () => {
            const traits: UserProvidedTraits = { name: 'Test User' }

            persistence.saveUserTraits(traits)
            expect(persistence.loadUserTraits()).toEqual(traits)
        })

        it('should clear user traits', () => {
            const traits: UserProvidedTraits = { name: 'Test User', email: 'test@example.com' }

            persistence.saveUserTraits(traits)
            expect(persistence.loadUserTraits()).toEqual(traits)

            persistence.clearUserTraits()
            expect(persistence.loadUserTraits()).toBeNull()
        })

        it('should handle localStorage errors gracefully', () => {
            ;(window.localStorage.setItem as jest.Mock).mockImplementation(() => {
                throw new Error('Storage full')
            })

            expect(() => persistence.saveUserTraits({ name: 'Test' })).not.toThrow()
            ;(window.localStorage.getItem as jest.Mock).mockImplementation(() => {
                throw new Error('Storage error')
            })

            persistence = new ConversationsPersistence(mockPosthog)
            expect(persistence.loadUserTraits()).toBeNull()
        })
    })

    describe('clearAll', () => {
        it('should clear all conversation-related data', () => {
            persistence.getOrCreateWidgetSessionId()
            persistence.saveTicketId('ticket-123')
            persistence.saveWidgetState('open')
            persistence.saveUserTraits({ name: 'Test User', email: 'test@example.com' })

            expect(readStorage()).not.toBeNull()

            persistence.clearAll()

            expect(localStorageData[STORAGE_KEY]).toBeUndefined()
        })

        it('should generate new widget_session_id after clearAll', () => {
            const sessionIdBefore = persistence.getOrCreateWidgetSessionId()

            persistence.clearAll()

            persistence = new ConversationsPersistence(mockPosthog)
            const sessionIdAfter = persistence.getOrCreateWidgetSessionId()
            expect(sessionIdBefore).not.toBe(sessionIdAfter)
        })

        it('should handle localStorage errors gracefully', () => {
            ;(window.localStorage.removeItem as jest.Mock).mockImplementation(() => {
                throw new Error('Storage error')
            })

            expect(() => persistence.clearAll()).not.toThrow()
        })
    })

    describe('migration from legacy PostHog persistence', () => {
        it('should migrate widget_session_id from PostHog persistence props', () => {
            const existingId = 'legacy-session-id-456'
            ;(mockPosthog.persistence!.get_property as jest.Mock).mockImplementation((key: string) => {
                if (key === LEGACY_WIDGET_SESSION_ID) {
                    return existingId
                }
                return undefined
            })

            persistence = new ConversationsPersistence(mockPosthog)

            expect(readStorage()?.widgetSessionId).toBe(existingId)
            expect(persistence.getOrCreateWidgetSessionId()).toBe(existingId)
        })

        it('should migrate all legacy data from PostHog persistence', () => {
            const traits = { name: 'Legacy User', email: 'legacy@example.com' }
            ;(mockPosthog.persistence!.get_property as jest.Mock).mockImplementation((key: string) => {
                switch (key) {
                    case LEGACY_WIDGET_SESSION_ID:
                        return 'legacy-session-id'
                    case LEGACY_TICKET_ID:
                        return 'legacy-ticket-id'
                    case LEGACY_WIDGET_STATE:
                        return 'open'
                    case LEGACY_USER_TRAITS:
                        return traits
                    default:
                        return undefined
                }
            })

            persistence = new ConversationsPersistence(mockPosthog)

            const stored = readStorage()
            expect(stored?.widgetSessionId).toBe('legacy-session-id')
            expect(stored?.ticketId).toBe('legacy-ticket-id')
            expect(stored?.widgetState).toBe('open')
            expect(stored?.userTraits).toEqual(traits)
        })

        it('should clean up old keys from PostHog persistence after migration', () => {
            ;(mockPosthog.persistence!.get_property as jest.Mock).mockImplementation((key: string) => {
                if (key === LEGACY_WIDGET_SESSION_ID) {
                    return 'legacy-session-id'
                }
                return undefined
            })

            persistence = new ConversationsPersistence(mockPosthog)

            expect(mockPosthog.persistence!.unregister).toHaveBeenCalledWith(LEGACY_WIDGET_SESSION_ID)
            expect(mockPosthog.persistence!.unregister).toHaveBeenCalledWith(LEGACY_TICKET_ID)
            expect(mockPosthog.persistence!.unregister).toHaveBeenCalledWith(LEGACY_WIDGET_STATE)
            expect(mockPosthog.persistence!.unregister).toHaveBeenCalledWith(LEGACY_USER_TRAITS)
        })

        it('should skip migration if dedicated storage already has data', () => {
            localStorageData[STORAGE_KEY] = JSON.stringify({ widgetSessionId: 'already-migrated-id' })
            jest.clearAllMocks()

            persistence = new ConversationsPersistence(mockPosthog)

            expect(persistence.getOrCreateWidgetSessionId()).toBe('already-migrated-id')
            expect(mockPosthog.persistence!.get_property).not.toHaveBeenCalled()
        })

        it('should fall back to raw localStorage when persistence.props lost the key', () => {
            // PostHog persistence.props doesn't have the key (the bug scenario)
            ;(mockPosthog.persistence!.get_property as jest.Mock).mockReturnValue(undefined)

            // But raw localStorage still has it
            localStorageData[LEGACY_PH_KEY] = JSON.stringify({
                [LEGACY_WIDGET_SESSION_ID]: 'raw-recovered-id',
                [LEGACY_TICKET_ID]: 'raw-ticket-id',
                distinct_id: 'some-user',
            })

            persistence = new ConversationsPersistence(mockPosthog)

            const stored = readStorage()
            expect(stored?.widgetSessionId).toBe('raw-recovered-id')
            expect(stored?.ticketId).toBe('raw-ticket-id')
        })

        it('should not migrate if persistence is disabled', () => {
            ;(mockPosthog.persistence!.isDisabled as jest.Mock).mockReturnValue(true)
            ;(mockPosthog.persistence!.get_property as jest.Mock).mockReturnValue('should-not-be-used')

            persistence = new ConversationsPersistence(mockPosthog)

            expect(readStorage()).toBeNull()
        })
    })
})
