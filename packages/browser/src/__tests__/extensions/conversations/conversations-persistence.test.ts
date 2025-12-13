/* eslint-disable compat/compat */
import { ConversationsPersistence } from '../../../extensions/conversations/persistence'
import { PostHog } from '../../../posthog-core'
import { UserProvidedTraits } from '../../../posthog-conversations-types'
import { createMockPostHog } from '../../helpers/posthog-instance'

describe('ConversationsPersistence', () => {
    let persistence: ConversationsPersistence
    let mockPostHog: PostHog

    beforeEach(() => {
        // Restore all mocks first to clean up any leftover mocks from previous tests
        jest.restoreAllMocks()
        localStorage.clear()
        jest.clearAllMocks()

        mockPostHog = createMockPostHog({
            get_distinct_id: jest.fn().mockReturnValue('test-distinct-id'),
        })

        persistence = new ConversationsPersistence(mockPostHog)
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    describe('widget_session_id persistence', () => {
        it('should generate and persist widget_session_id', () => {
            const sessionId = persistence.getOrCreateWidgetSessionId()

            // Should be a valid UUID format
            expect(sessionId).toMatch(/^[0-9a-f-]{36}$/i)

            // Should be stored in localStorage
            expect(localStorage.getItem('ph_conversations_widget_session_id')).toBe(sessionId)
        })

        it('should return same widget_session_id on subsequent calls', () => {
            const sessionId1 = persistence.getOrCreateWidgetSessionId()
            const sessionId2 = persistence.getOrCreateWidgetSessionId()

            expect(sessionId1).toBe(sessionId2)
        })

        it('should return same widget_session_id even after distinct_id changes', () => {
            const sessionIdBefore = persistence.getOrCreateWidgetSessionId()

            // Simulate identify - distinct_id changes
            ;(mockPostHog.get_distinct_id as jest.Mock).mockReturnValue('new-user@example.com')

            const sessionIdAfter = persistence.getOrCreateWidgetSessionId()
            expect(sessionIdBefore).toBe(sessionIdAfter)
        })

        it('should clear widget_session_id', () => {
            const sessionId = persistence.getOrCreateWidgetSessionId()
            expect(localStorage.getItem('ph_conversations_widget_session_id')).toBe(sessionId)

            persistence.clearWidgetSessionId()

            expect(localStorage.getItem('ph_conversations_widget_session_id')).toBeNull()
        })

        it('should generate new widget_session_id after clearing', () => {
            const sessionId1 = persistence.getOrCreateWidgetSessionId()
            persistence.clearWidgetSessionId()
            const sessionId2 = persistence.getOrCreateWidgetSessionId()

            expect(sessionId1).not.toBe(sessionId2)
        })

        it('should handle localStorage errors gracefully', () => {
            jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
                throw new Error('Storage error')
            })

            // Should still return a UUID (fallback)
            const sessionId = persistence.getOrCreateWidgetSessionId()
            expect(sessionId).toMatch(/^[0-9a-f-]{36}$/i)
        })
    })

    describe('ticket ID persistence', () => {
        it('should save and load ticket ID', () => {
            const ticketId = 'ticket-123'

            persistence.saveTicketId(ticketId)
            const loaded = persistence.loadTicketId()

            expect(loaded).toBe(ticketId)
        })

        it('should return null if no ticket ID is stored', () => {
            const loaded = persistence.loadTicketId()

            expect(loaded).toBeNull()
        })

        it('should use widget_session_id in storage key (not distinct_id)', () => {
            const ticketId = 'ticket-123'

            // Get the widget_session_id that will be used for the key
            const widgetSessionId = persistence.getOrCreateWidgetSessionId()

            persistence.saveTicketId(ticketId)

            // Key should be based on widget_session_id, not distinct_id
            const key = `ph_conversations_ticket_${widgetSessionId}`
            expect(localStorage.getItem(key)).toBe(ticketId)
        })

        it('should keep same ticket after distinct_id changes (identify)', () => {
            const ticketId = 'ticket-123'

            // Save ticket
            persistence.saveTicketId(ticketId)

            // Simulate identify - distinct_id changes
            ;(mockPostHog.get_distinct_id as jest.Mock).mockReturnValue('new-user@example.com')

            // Should still load the same ticket because widget_session_id is unchanged
            expect(persistence.loadTicketId()).toBe(ticketId)
        })

        it('should clear ticket ID', () => {
            const ticketId = 'ticket-123'

            persistence.saveTicketId(ticketId)
            expect(persistence.loadTicketId()).toBe(ticketId)

            persistence.clearTicketId()
            expect(persistence.loadTicketId()).toBeNull()
        })

        it('should handle localStorage errors gracefully', () => {
            const ticketId = 'ticket-123'

            // Mock localStorage.setItem to throw
            jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
                throw new Error('Storage full')
            })

            expect(() => persistence.saveTicketId(ticketId)).not.toThrow()

            // Mock localStorage.getItem to throw
            jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
                throw new Error('Storage error')
            })

            expect(persistence.loadTicketId()).toBeNull()
        })
    })

    describe('widget state persistence', () => {
        it('should save and load widget state', () => {
            persistence.saveWidgetState('open')
            expect(persistence.loadWidgetState()).toBe('open')

            persistence.saveWidgetState('closed')
            expect(persistence.loadWidgetState()).toBe('closed')
        })

        it('should return null if no state is stored', () => {
            expect(persistence.loadWidgetState()).toBeNull()
        })

        it('should return null for invalid state values', () => {
            localStorage.setItem('ph_conversations_widget_state', 'invalid')

            expect(persistence.loadWidgetState()).toBeNull()
        })

        it('should handle localStorage errors gracefully', () => {
            jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
                throw new Error('Storage full')
            })

            expect(() => persistence.saveWidgetState('open')).not.toThrow()

            jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
                throw new Error('Storage error')
            })

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
            expect(persistence.loadUserTraits()).toBeNull()
        })

        it('should handle JSON parse errors', () => {
            localStorage.setItem('ph_conversations_user_traits', 'invalid json')

            expect(persistence.loadUserTraits()).toBeNull()
        })

        it('should handle localStorage errors gracefully', () => {
            const traits: UserProvidedTraits = {
                name: 'Test User',
                email: 'test@example.com',
            }

            jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
                throw new Error('Storage full')
            })

            expect(() => persistence.saveUserTraits(traits)).not.toThrow()

            jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
                throw new Error('Storage error')
            })

            expect(persistence.loadUserTraits()).toBeNull()
        })
    })

    describe('clearAll', () => {
        it('should clear all conversation-related data including widget_session_id', () => {
            // Set up data
            persistence.getOrCreateWidgetSessionId() // Create widget_session_id
            persistence.saveTicketId('ticket-123')
            persistence.saveWidgetState('open')
            persistence.saveUserTraits({ name: 'Test User', email: 'test@example.com' })

            // Add some other keys that shouldn't be cleared
            localStorage.setItem('other_key', 'should-remain')

            persistence.clearAll()

            // widget_session_id should be cleared
            expect(localStorage.getItem('ph_conversations_widget_session_id')).toBeNull()
            expect(persistence.loadTicketId()).toBeNull()
            expect(persistence.loadWidgetState()).toBeNull()
            expect(persistence.loadUserTraits()).toBeNull()
            expect(localStorage.getItem('other_key')).toBe('should-remain')
        })

        it('should clear orphaned ticket keys from previous sessions', () => {
            // Create keys for multiple widget_session_ids (simulating different browser sessions)
            localStorage.setItem('ph_conversations_ticket_session1', 'ticket-1')
            localStorage.setItem('ph_conversations_ticket_session2', 'ticket-2')
            localStorage.setItem('ph_conversations_ticket_session3', 'ticket-3')

            persistence.clearAll()

            expect(localStorage.getItem('ph_conversations_ticket_session1')).toBeNull()
            expect(localStorage.getItem('ph_conversations_ticket_session2')).toBeNull()
            expect(localStorage.getItem('ph_conversations_ticket_session3')).toBeNull()
        })

        it('should generate new widget_session_id after clearAll', () => {
            const sessionIdBefore = persistence.getOrCreateWidgetSessionId()

            persistence.clearAll()

            const sessionIdAfter = persistence.getOrCreateWidgetSessionId()
            expect(sessionIdBefore).not.toBe(sessionIdAfter)
        })

        it('should handle localStorage errors gracefully', () => {
            jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
                throw new Error('Storage error')
            })

            expect(() => persistence.clearAll()).not.toThrow()
        })
    })

    describe('localStorage unavailable', () => {
        let originalLocalStorage: Storage

        beforeEach(() => {
            originalLocalStorage = global.localStorage
            // Intentionally deleting localStorage for testing
            delete (global as any).localStorage
        })

        afterEach(() => {
            global.localStorage = originalLocalStorage
        })

        it('should handle missing localStorage for widget_session_id', () => {
            // Should still generate a UUID (fallback behavior)
            const sessionId = persistence.getOrCreateWidgetSessionId()
            expect(sessionId).toMatch(/^[0-9a-f-]{36}$/i)
            expect(() => persistence.clearWidgetSessionId()).not.toThrow()
        })

        it('should handle missing localStorage for ticket ID', () => {
            expect(() => persistence.saveTicketId('ticket-123')).not.toThrow()
            expect(persistence.loadTicketId()).toBeNull()
            expect(() => persistence.clearTicketId()).not.toThrow()
        })

        it('should handle missing localStorage for widget state', () => {
            expect(() => persistence.saveWidgetState('open')).not.toThrow()
            expect(persistence.loadWidgetState()).toBeNull()
        })

        it('should handle missing localStorage for user traits', () => {
            expect(() => persistence.saveUserTraits({ name: 'Test' })).not.toThrow()
            expect(persistence.loadUserTraits()).toBeNull()
            expect(() => persistence.clearUserTraits()).not.toThrow()
        })

        it('should handle missing localStorage for clearAll', () => {
            expect(() => persistence.clearAll()).not.toThrow()
        })
    })
})
