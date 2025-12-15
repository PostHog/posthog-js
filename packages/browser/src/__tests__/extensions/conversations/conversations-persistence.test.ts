/* eslint-disable compat/compat */
import { ConversationsPersistence } from '../../../extensions/conversations/persistence'
import { UserProvidedTraits } from '../../../posthog-conversations-types'
import { ConversationsApiHelpers } from '../../../utils/globals'

// Same constants as in the extension - defined locally for testing
const CONVERSATIONS_WIDGET_SESSION_ID = '$conversations_widget_session_id'
const CONVERSATIONS_TICKET_ID = '$conversations_ticket_id'
const CONVERSATIONS_WIDGET_STATE = '$conversations_widget_state'
const CONVERSATIONS_USER_TRAITS = '$conversations_user_traits'

describe('ConversationsPersistence', () => {
    let persistence: ConversationsPersistence
    let mockApiHelpers: ConversationsApiHelpers
    let mockStorage: Record<string, any>

    beforeEach(() => {
        jest.restoreAllMocks()
        jest.clearAllMocks()

        // Create a mock storage object
        mockStorage = {}

        // Create mock API helpers that simulate PostHog's persistence
        mockApiHelpers = {
            sendRequest: jest.fn(),
            endpointFor: jest.fn(),
            getDistinctId: jest.fn().mockReturnValue('test-distinct-id'),
            getPersonProperties: jest.fn().mockReturnValue({}),
            capture: jest.fn(),
            on: jest.fn().mockReturnValue(() => {}),
            getProperty: jest.fn((key: string) => mockStorage[key]),
            setProperty: jest.fn((key: string, value: any) => {
                mockStorage[key] = value
            }),
            removeProperty: jest.fn((key: string) => {
                delete mockStorage[key]
            }),
            isPersistenceAvailable: jest.fn().mockReturnValue(true),
        }

        persistence = new ConversationsPersistence(mockApiHelpers)
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    describe('widget_session_id persistence', () => {
        it('should generate and persist widget_session_id', () => {
            const sessionId = persistence.getOrCreateWidgetSessionId()

            // Should be a valid UUID format
            expect(sessionId).toMatch(/^[0-9a-f-]{36}$/i)

            // Should be stored via setProperty
            expect(mockApiHelpers.setProperty).toHaveBeenCalledWith(CONVERSATIONS_WIDGET_SESSION_ID, sessionId)
        })

        it('should return same widget_session_id on subsequent calls', () => {
            const sessionId1 = persistence.getOrCreateWidgetSessionId()
            const sessionId2 = persistence.getOrCreateWidgetSessionId()

            expect(sessionId1).toBe(sessionId2)
        })

        it('should return existing widget_session_id from persistence', () => {
            const existingSessionId = 'existing-session-id-12345'
            mockStorage[CONVERSATIONS_WIDGET_SESSION_ID] = existingSessionId

            const sessionId = persistence.getOrCreateWidgetSessionId()

            expect(sessionId).toBe(existingSessionId)
            // Should not create a new one
            expect(mockApiHelpers.setProperty).not.toHaveBeenCalled()
        })

        it('should return same widget_session_id even after distinct_id changes', () => {
            const sessionIdBefore = persistence.getOrCreateWidgetSessionId()

            // Simulate identify - distinct_id changes
            ;(mockApiHelpers.getDistinctId as jest.Mock).mockReturnValue('new-user@example.com')

            const sessionIdAfter = persistence.getOrCreateWidgetSessionId()
            expect(sessionIdBefore).toBe(sessionIdAfter)
        })

        it('should clear widget_session_id', () => {
            persistence.getOrCreateWidgetSessionId()
            persistence.clearWidgetSessionId()

            expect(mockApiHelpers.removeProperty).toHaveBeenCalledWith(CONVERSATIONS_WIDGET_SESSION_ID)
        })

        it('should generate new widget_session_id after clearing', () => {
            const sessionId1 = persistence.getOrCreateWidgetSessionId()
            persistence.clearWidgetSessionId()

            // Clear the cache and storage
            mockStorage = {}

            // Create new persistence instance to clear internal cache
            persistence = new ConversationsPersistence(mockApiHelpers)
            const sessionId2 = persistence.getOrCreateWidgetSessionId()

            expect(sessionId1).not.toBe(sessionId2)
        })

        it('should handle persistence errors gracefully', () => {
            ;(mockApiHelpers.getProperty as jest.Mock).mockImplementation(() => {
                throw new Error('Storage error')
            })

            // Should still return a UUID (fallback)
            const sessionId = persistence.getOrCreateWidgetSessionId()
            expect(sessionId).toMatch(/^[0-9a-f-]{36}$/i)
        })

        it('should handle persistence unavailable', () => {
            ;(mockApiHelpers.isPersistenceAvailable as jest.Mock).mockReturnValue(false)

            // Should still return a UUID (fallback)
            const sessionId = persistence.getOrCreateWidgetSessionId()
            expect(sessionId).toMatch(/^[0-9a-f-]{36}$/i)
            expect(mockApiHelpers.setProperty).not.toHaveBeenCalled()
        })
    })

    describe('ticket ID persistence', () => {
        it('should save and load ticket ID', () => {
            const ticketId = 'ticket-123'

            persistence.saveTicketId(ticketId)
            expect(mockApiHelpers.setProperty).toHaveBeenCalledWith(CONVERSATIONS_TICKET_ID, ticketId)

            const loaded = persistence.loadTicketId()
            expect(loaded).toBe(ticketId)
        })

        it('should return null if no ticket ID is stored', () => {
            const loaded = persistence.loadTicketId()

            expect(loaded).toBeNull()
        })

        it('should keep same ticket after distinct_id changes (identify)', () => {
            const ticketId = 'ticket-123'

            // Save ticket
            persistence.saveTicketId(ticketId)

            // Simulate identify - distinct_id changes
            ;(mockApiHelpers.getDistinctId as jest.Mock).mockReturnValue('new-user@example.com')

            // Should still load the same ticket
            expect(persistence.loadTicketId()).toBe(ticketId)
        })

        it('should clear ticket ID', () => {
            const ticketId = 'ticket-123'

            persistence.saveTicketId(ticketId)
            expect(persistence.loadTicketId()).toBe(ticketId)

            persistence.clearTicketId()
            expect(mockApiHelpers.removeProperty).toHaveBeenCalledWith(CONVERSATIONS_TICKET_ID)
        })

        it('should handle persistence errors gracefully for save', () => {
            ;(mockApiHelpers.setProperty as jest.Mock).mockImplementation(() => {
                throw new Error('Storage full')
            })

            expect(() => persistence.saveTicketId('ticket-123')).not.toThrow()
        })

        it('should handle persistence errors gracefully for load', () => {
            ;(mockApiHelpers.getProperty as jest.Mock).mockImplementation(() => {
                throw new Error('Storage error')
            })

            expect(persistence.loadTicketId()).toBeNull()
        })

        it('should handle persistence unavailable', () => {
            ;(mockApiHelpers.isPersistenceAvailable as jest.Mock).mockReturnValue(false)

            expect(() => persistence.saveTicketId('ticket-123')).not.toThrow()
            expect(persistence.loadTicketId()).toBeNull()
            expect(mockApiHelpers.setProperty).not.toHaveBeenCalled()
        })
    })

    describe('widget state persistence', () => {
        it('should save and load widget state', () => {
            persistence.saveWidgetState('open')
            expect(mockApiHelpers.setProperty).toHaveBeenCalledWith(CONVERSATIONS_WIDGET_STATE, 'open')
            expect(persistence.loadWidgetState()).toBe('open')

            persistence.saveWidgetState('closed')
            expect(mockApiHelpers.setProperty).toHaveBeenCalledWith(CONVERSATIONS_WIDGET_STATE, 'closed')
            expect(persistence.loadWidgetState()).toBe('closed')
        })

        it('should return null if no state is stored', () => {
            expect(persistence.loadWidgetState()).toBeNull()
        })

        it('should return null for invalid state values', () => {
            mockStorage[CONVERSATIONS_WIDGET_STATE] = 'invalid'

            expect(persistence.loadWidgetState()).toBeNull()
        })

        it('should handle persistence errors gracefully', () => {
            ;(mockApiHelpers.setProperty as jest.Mock).mockImplementation(() => {
                throw new Error('Storage full')
            })

            expect(() => persistence.saveWidgetState('open')).not.toThrow()
            ;(mockApiHelpers.getProperty as jest.Mock).mockImplementation(() => {
                throw new Error('Storage error')
            })

            expect(persistence.loadWidgetState()).toBeNull()
        })

        it('should handle persistence unavailable', () => {
            ;(mockApiHelpers.isPersistenceAvailable as jest.Mock).mockReturnValue(false)

            expect(() => persistence.saveWidgetState('open')).not.toThrow()
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
            expect(mockApiHelpers.setProperty).toHaveBeenCalledWith(CONVERSATIONS_USER_TRAITS, traits)

            const loaded = persistence.loadUserTraits()
            expect(loaded).toEqual(traits)
        })

        it('should return null if no traits are stored', () => {
            expect(persistence.loadUserTraits()).toBeNull()
        })

        it('should handle partial traits', () => {
            const traits: UserProvidedTraits = {
                name: 'Test User',
            }

            persistence.saveUserTraits(traits)
            const loaded = persistence.loadUserTraits()

            expect(loaded).toEqual(traits)
        })

        it('should clear user traits', () => {
            const traits: UserProvidedTraits = {
                name: 'Test User',
                email: 'test@example.com',
            }

            persistence.saveUserTraits(traits)
            expect(persistence.loadUserTraits()).toEqual(traits)

            persistence.clearUserTraits()
            expect(mockApiHelpers.removeProperty).toHaveBeenCalledWith(CONVERSATIONS_USER_TRAITS)
        })

        it('should handle persistence errors gracefully', () => {
            const traits: UserProvidedTraits = {
                name: 'Test User',
                email: 'test@example.com',
            }

            ;(mockApiHelpers.setProperty as jest.Mock).mockImplementation(() => {
                throw new Error('Storage full')
            })

            expect(() => persistence.saveUserTraits(traits)).not.toThrow()
            ;(mockApiHelpers.getProperty as jest.Mock).mockImplementation(() => {
                throw new Error('Storage error')
            })

            expect(persistence.loadUserTraits()).toBeNull()
        })

        it('should handle persistence unavailable', () => {
            ;(mockApiHelpers.isPersistenceAvailable as jest.Mock).mockReturnValue(false)

            expect(() => persistence.saveUserTraits({ name: 'Test' })).not.toThrow()
            expect(persistence.loadUserTraits()).toBeNull()
            expect(() => persistence.clearUserTraits()).not.toThrow()
        })
    })

    describe('clearAll', () => {
        it('should clear all conversation-related data', () => {
            // Set up data
            persistence.getOrCreateWidgetSessionId()
            persistence.saveTicketId('ticket-123')
            persistence.saveWidgetState('open')
            persistence.saveUserTraits({ name: 'Test User', email: 'test@example.com' })

            // Clear mock calls
            jest.clearAllMocks()

            persistence.clearAll()

            // All properties should be removed
            expect(mockApiHelpers.removeProperty).toHaveBeenCalledWith(CONVERSATIONS_WIDGET_STATE)
            expect(mockApiHelpers.removeProperty).toHaveBeenCalledWith(CONVERSATIONS_USER_TRAITS)
            expect(mockApiHelpers.removeProperty).toHaveBeenCalledWith(CONVERSATIONS_TICKET_ID)
            expect(mockApiHelpers.removeProperty).toHaveBeenCalledWith(CONVERSATIONS_WIDGET_SESSION_ID)
        })

        it('should generate new widget_session_id after clearAll', () => {
            const sessionIdBefore = persistence.getOrCreateWidgetSessionId()

            persistence.clearAll()

            // Clear storage and create new persistence instance
            mockStorage = {}
            persistence = new ConversationsPersistence(mockApiHelpers)

            const sessionIdAfter = persistence.getOrCreateWidgetSessionId()
            expect(sessionIdBefore).not.toBe(sessionIdAfter)
        })

        it('should handle persistence errors gracefully', () => {
            ;(mockApiHelpers.removeProperty as jest.Mock).mockImplementation(() => {
                throw new Error('Storage error')
            })

            expect(() => persistence.clearAll()).not.toThrow()
        })

        it('should handle persistence unavailable', () => {
            ;(mockApiHelpers.isPersistenceAvailable as jest.Mock).mockReturnValue(false)

            expect(() => persistence.clearAll()).not.toThrow()
        })
    })

    describe('persistence unavailable scenarios', () => {
        beforeEach(() => {
            ;(mockApiHelpers.isPersistenceAvailable as jest.Mock).mockReturnValue(false)
        })

        it('should handle missing persistence for widget_session_id', () => {
            // Should still generate a UUID (fallback behavior)
            const sessionId = persistence.getOrCreateWidgetSessionId()
            expect(sessionId).toMatch(/^[0-9a-f-]{36}$/i)
            expect(() => persistence.clearWidgetSessionId()).not.toThrow()
        })

        it('should handle missing persistence for ticket ID', () => {
            expect(() => persistence.saveTicketId('ticket-123')).not.toThrow()
            expect(persistence.loadTicketId()).toBeNull()
            expect(() => persistence.clearTicketId()).not.toThrow()
        })

        it('should handle missing persistence for widget state', () => {
            expect(() => persistence.saveWidgetState('open')).not.toThrow()
            expect(persistence.loadWidgetState()).toBeNull()
        })

        it('should handle missing persistence for user traits', () => {
            expect(() => persistence.saveUserTraits({ name: 'Test' })).not.toThrow()
            expect(persistence.loadUserTraits()).toBeNull()
            expect(() => persistence.clearUserTraits()).not.toThrow()
        })

        it('should handle missing persistence for clearAll', () => {
            expect(() => persistence.clearAll()).not.toThrow()
        })
    })
})
