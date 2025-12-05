import { PostHog } from '../../posthog-core'
import { UserProvidedTraits } from '../../posthog-conversations-types'
import { createLogger } from '../../utils/logger'

const logger = createLogger('[ConversationsPersistence]')

const STORAGE_KEY_PREFIX = 'ph_conversations_ticket_'
const WIDGET_STATE_KEY = 'ph_conversations_widget_state'
const USER_TRAITS_KEY = 'ph_conversations_user_traits'

export class ConversationsPersistence {
    private _posthog: PostHog

    constructor(posthog: PostHog) {
        this._posthog = posthog
    }

    /**
     * Get the localStorage key for the current distinct_id
     */
    private _getStorageKey(): string {
        const distinctId = this._posthog.get_distinct_id()
        return `${STORAGE_KEY_PREFIX}${distinctId}`
    }

    /**
     * Save the current ticket ID to localStorage
     */
    saveTicketId(ticketId: string): void {
        if (typeof localStorage === 'undefined') {
            logger.warn('localStorage not available')
            return
        }

        const key = this._getStorageKey()
        try {
            localStorage.setItem(key, ticketId)
            logger.info('Saved ticket ID', { ticketId, key })
        } catch (error) {
            logger.error('Failed to save ticket ID', error)
        }
    }

    /**
     * Load the current ticket ID from localStorage
     */
    loadTicketId(): string | null {
        if (typeof localStorage === 'undefined') {
            logger.warn('localStorage not available')
            return null
        }

        const key = this._getStorageKey()
        try {
            const ticketId = localStorage.getItem(key)
            if (ticketId) {
                logger.info('Loaded ticket ID', { ticketId, key })
            }
            return ticketId
        } catch (error) {
            logger.error('Failed to load ticket ID', error)
            return null
        }
    }

    /**
     * Clear the current ticket ID from localStorage
     */
    clearTicketId(): void {
        if (typeof localStorage === 'undefined') {
            logger.warn('localStorage not available')
            return
        }

        const key = this._getStorageKey()
        try {
            localStorage.removeItem(key)
            logger.info('Cleared ticket ID', { key })
        } catch (error) {
            logger.error('Failed to clear ticket ID', error)
        }
    }

    /**
     * Save widget state (open, closed)
     */
    saveWidgetState(state: 'open' | 'closed'): void {
        if (typeof localStorage === 'undefined') {
            return
        }

        try {
            localStorage.setItem(WIDGET_STATE_KEY, state)
        } catch (error) {
            logger.error('Failed to save widget state', error)
        }
    }

    /**
     * Load widget state
     */
    loadWidgetState(): 'open' | 'closed' | null {
        if (typeof localStorage === 'undefined') {
            return null
        }

        try {
            const state = localStorage.getItem(WIDGET_STATE_KEY)
            if (state === 'open' || state === 'closed') {
                return state
            }
            return null
        } catch (error) {
            logger.error('Failed to load widget state', error)
            return null
        }
    }

    /**
     * Save user-provided traits (name, email) to localStorage
     */
    saveUserTraits(traits: UserProvidedTraits): void {
        if (typeof localStorage === 'undefined') {
            logger.warn('localStorage not available')
            return
        }

        try {
            localStorage.setItem(USER_TRAITS_KEY, JSON.stringify(traits))
            logger.info('Saved user traits', { hasName: !!traits.name, hasEmail: !!traits.email })
        } catch (error) {
            logger.error('Failed to save user traits', error)
        }
    }

    /**
     * Load user-provided traits from localStorage
     */
    loadUserTraits(): UserProvidedTraits | null {
        if (typeof localStorage === 'undefined') {
            return null
        }

        try {
            const data = localStorage.getItem(USER_TRAITS_KEY)
            if (data) {
                const traits = JSON.parse(data) as UserProvidedTraits
                logger.info('Loaded user traits', { hasName: !!traits.name, hasEmail: !!traits.email })
                return traits
            }
            return null
        } catch (error) {
            logger.error('Failed to load user traits', error)
            return null
        }
    }

    /**
     * Clear user-provided traits from localStorage
     */
    clearUserTraits(): void {
        if (typeof localStorage === 'undefined') {
            return
        }

        try {
            localStorage.removeItem(USER_TRAITS_KEY)
            logger.info('Cleared user traits')
        } catch (error) {
            logger.error('Failed to clear user traits', error)
        }
    }

    /**
     * Clear all conversation-related data from localStorage
     */
    clearAll(): void {
        if (typeof localStorage === 'undefined') {
            return
        }

        try {
            // Clear ticket for current user
            this.clearTicketId()

            // Clear widget state
            localStorage.removeItem(WIDGET_STATE_KEY)

            // Clear user traits
            localStorage.removeItem(USER_TRAITS_KEY)

            // Clear any orphaned keys from previous distinct_ids
            const keysToRemove: string[] = []
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i)
                if (key?.startsWith(STORAGE_KEY_PREFIX)) {
                    keysToRemove.push(key)
                }
            }

            keysToRemove.forEach((key) => {
                localStorage.removeItem(key)
            })

            logger.info('Cleared all conversation data', { removedKeys: keysToRemove.length })
        } catch (error) {
            logger.error('Failed to clear conversation data', error)
        }
    }

    /**
     * Migrate ticket from old distinct_id to new distinct_id
     * This allows the user to continue their conversation after identifying
     */
    migrateTicketToNewDistinctId(oldDistinctId: string, newDistinctId: string): void {
        if (!oldDistinctId || oldDistinctId === newDistinctId) {
            return
        }

        if (typeof localStorage === 'undefined') {
            return
        }

        try {
            const oldKey = `${STORAGE_KEY_PREFIX}${oldDistinctId}`
            const newKey = `${STORAGE_KEY_PREFIX}${newDistinctId}`

            const ticketId = localStorage.getItem(oldKey)

            if (ticketId) {
                // Move the ticket to the new key
                localStorage.setItem(newKey, ticketId)
                localStorage.removeItem(oldKey)
                logger.info('Migrated ticket to new distinct_id', {
                    ticketId,
                    oldDistinctId,
                    newDistinctId,
                })
            }
        } catch (error) {
            logger.error('Failed to migrate ticket', error)
        }
    }
}
