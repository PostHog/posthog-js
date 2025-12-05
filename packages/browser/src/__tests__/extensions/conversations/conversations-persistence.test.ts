/* eslint-disable compat/compat */
import { ConversationsPersistence } from '../../../extensions/conversations/persistence'
import { PostHog } from '../../../posthog-core'
import { UserProvidedTraits } from '../../../posthog-conversations-types'
import { createMockPostHog } from '../../helpers/posthog-instance'

describe('ConversationsPersistence', () => {
    let persistence: ConversationsPersistence
    let mockPostHog: PostHog

    beforeEach(() => {
        localStorage.clear()
        jest.clearAllMocks()

        mockPostHog = createMockPostHog({
            get_distinct_id: jest.fn().mockReturnValue('test-distinct-id'),
        })

        persistence = new ConversationsPersistence(mockPostHog)
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

        it('should use distinct_id in storage key', () => {
            const ticketId = 'ticket-123'

            persistence.saveTicketId(ticketId)

            const key = 'ph_conversations_ticket_test-distinct-id'
            expect(localStorage.getItem(key)).toBe(ticketId)
        })

        it('should load ticket for different distinct_id', () => {
            const ticketId1 = 'ticket-123'
            const ticketId2 = 'ticket-456'

            // Save for first distinct_id
            persistence.saveTicketId(ticketId1)

            // Change distinct_id
            ;(mockPostHog.get_distinct_id as jest.Mock).mockReturnValue('different-distinct-id')

            // Save for second distinct_id
            persistence.saveTicketId(ticketId2)

            // Load should get the second ticket
            expect(persistence.loadTicketId()).toBe(ticketId2)

            // Switch back to first distinct_id
            ;(mockPostHog.get_distinct_id as jest.Mock).mockReturnValue('test-distinct-id')

            // Should get the first ticket
            expect(persistence.loadTicketId()).toBe(ticketId1)
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
        it('should clear all conversation-related data', () => {
            // Set up data
            persistence.saveTicketId('ticket-123')
            persistence.saveWidgetState('open')
            persistence.saveUserTraits({ name: 'Test User', email: 'test@example.com' })

            // Add some other keys that shouldn't be cleared
            localStorage.setItem('other_key', 'should-remain')

            persistence.clearAll()

            expect(persistence.loadTicketId()).toBeNull()
            expect(persistence.loadWidgetState()).toBeNull()
            expect(persistence.loadUserTraits()).toBeNull()
            expect(localStorage.getItem('other_key')).toBe('should-remain')
        })

        it('should clear orphaned ticket keys from previous distinct_ids', () => {
            // Create keys for multiple distinct_ids
            localStorage.setItem('ph_conversations_ticket_user1', 'ticket-1')
            localStorage.setItem('ph_conversations_ticket_user2', 'ticket-2')
            localStorage.setItem('ph_conversations_ticket_user3', 'ticket-3')

            persistence.clearAll()

            expect(localStorage.getItem('ph_conversations_ticket_user1')).toBeNull()
            expect(localStorage.getItem('ph_conversations_ticket_user2')).toBeNull()
            expect(localStorage.getItem('ph_conversations_ticket_user3')).toBeNull()
        })

        it('should handle localStorage errors gracefully', () => {
            jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
                throw new Error('Storage error')
            })

            expect(() => persistence.clearAll()).not.toThrow()
        })
    })

    describe('migrateTicketToNewDistinctId', () => {
        it('should migrate ticket to new distinct_id', () => {
            const oldDistinctId = 'old-distinct-id'
            const newDistinctId = 'new-distinct-id'
            const ticketId = 'ticket-123'

            // Set up ticket for old distinct_id
            localStorage.setItem(`ph_conversations_ticket_${oldDistinctId}`, ticketId)

            persistence.migrateTicketToNewDistinctId(oldDistinctId, newDistinctId)

            // Old key should be removed
            expect(localStorage.getItem(`ph_conversations_ticket_${oldDistinctId}`)).toBeNull()

            // New key should have the ticket
            expect(localStorage.getItem(`ph_conversations_ticket_${newDistinctId}`)).toBe(ticketId)
        })

        it('should not migrate if distinct_ids are the same', () => {
            const distinctId = 'same-id'
            const ticketId = 'ticket-123'

            localStorage.setItem(`ph_conversations_ticket_${distinctId}`, ticketId)

            persistence.migrateTicketToNewDistinctId(distinctId, distinctId)

            // Ticket should still be there
            expect(localStorage.getItem(`ph_conversations_ticket_${distinctId}`)).toBe(ticketId)
        })

        it('should not migrate if old distinct_id is empty', () => {
            const newDistinctId = 'new-distinct-id'

            persistence.migrateTicketToNewDistinctId('', newDistinctId)

            expect(localStorage.getItem(`ph_conversations_ticket_${newDistinctId}`)).toBeNull()
        })

        it('should do nothing if no ticket exists for old distinct_id', () => {
            const oldDistinctId = 'old-distinct-id'
            const newDistinctId = 'new-distinct-id'

            persistence.migrateTicketToNewDistinctId(oldDistinctId, newDistinctId)

            expect(localStorage.getItem(`ph_conversations_ticket_${newDistinctId}`)).toBeNull()
        })

        it('should handle localStorage errors gracefully', () => {
            const oldDistinctId = 'old-distinct-id'
            const newDistinctId = 'new-distinct-id'

            jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
                throw new Error('Storage error')
            })

            expect(() => persistence.migrateTicketToNewDistinctId(oldDistinctId, newDistinctId)).not.toThrow()
        })
    })

    describe('localStorage unavailable', () => {
        let originalLocalStorage: Storage

        beforeEach(() => {
            originalLocalStorage = global.localStorage
            // @ts-expect-error - intentionally deleting localStorage for testing
            delete global.localStorage
        })

        afterEach(() => {
            global.localStorage = originalLocalStorage
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

        it('should handle missing localStorage for migration', () => {
            expect(() => persistence.migrateTicketToNewDistinctId('old', 'new')).not.toThrow()
        })
    })
})
