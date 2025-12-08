import { PostHog } from '../../posthog-core'
import { UserProvidedTraits } from '../../posthog-conversations-types'
import { createLogger } from '../../utils/logger'
import { uuidv7 } from '../../uuidv7'

const logger = createLogger('[ConversationsPersistence]')

const WIDGET_SESSION_ID_KEY = 'ph_conversations_widget_session_id'
const STORAGE_KEY_PREFIX = 'ph_conversations_ticket_'
const WIDGET_STATE_KEY = 'ph_conversations_widget_state'
const USER_TRAITS_KEY = 'ph_conversations_user_traits'

export class ConversationsPersistence {
    private _posthog: PostHog
    private _cachedWidgetSessionId: string | null = null

    constructor(posthog: PostHog) {
        this._posthog = posthog
    }

    /**
     * Get or create the widget session ID (random UUID for access control).
     * This ID is generated once per browser and persists across sessions.
     * It is NOT tied to distinct_id - it stays the same even when user identifies.
     *
     * SECURITY: This is the key for access control. Only the browser that created
     * the widget_session_id can access tickets associated with it.
     */
    getOrCreateWidgetSessionId(): string {
        // Return cached value if available
        if (this._cachedWidgetSessionId) {
            return this._cachedWidgetSessionId
        }

        if (typeof localStorage === 'undefined') {
            // Fallback: generate a new one each time (won't persist)
            // This is acceptable for SSR or environments without localStorage
            const sessionId = uuidv7()
            logger.warn('localStorage not available, widget_session_id will not persist', { sessionId })
            return sessionId
        }

        try {
            let sessionId = localStorage.getItem(WIDGET_SESSION_ID_KEY)
            if (!sessionId) {
                sessionId = uuidv7()
                localStorage.setItem(WIDGET_SESSION_ID_KEY, sessionId)
                logger.info('Generated new widget_session_id', { sessionId })
            }
            this._cachedWidgetSessionId = sessionId
            return sessionId
        } catch (error) {
            logger.error('Failed to get/create widget_session_id', error)
            // Fallback: generate a new one (won't persist)
            return uuidv7()
        }
    }

    /**
     * Clear the widget session ID (called on posthog.reset()).
     * This will create a new session and lose access to previous tickets.
     */
    clearWidgetSessionId(): void {
        this._cachedWidgetSessionId = null

        if (typeof localStorage === 'undefined') {
            return
        }

        try {
            localStorage.removeItem(WIDGET_SESSION_ID_KEY)
            logger.info('Cleared widget_session_id')
        } catch (error) {
            logger.error('Failed to clear widget_session_id', error)
        }
    }

    /**
     * Get the localStorage key for the current widget_session_id.
     * Ticket storage is now keyed by widget_session_id (not distinct_id)
     * to ensure the same browser session always sees the same ticket.
     */
    private _getStorageKey(): string {
        const sessionId = this.getOrCreateWidgetSessionId()
        return `${STORAGE_KEY_PREFIX}${sessionId}`
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
     * Clear all conversation-related data from localStorage.
     * This is called on posthog.reset() to start fresh.
     */
    clearAll(): void {
        if (typeof localStorage === 'undefined') {
            return
        }

        try {
            // Clear widget state
            localStorage.removeItem(WIDGET_STATE_KEY)

            // Clear user traits
            localStorage.removeItem(USER_TRAITS_KEY)

            // Clear ALL ticket keys (including current and orphaned from previous sessions)
            // We do this before clearing widget_session_id to avoid recreating it
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

            // Clear widget session ID last (this will lose access to previous tickets)
            // Must be done last because _getStorageKey() would recreate it if called after clear
            this.clearWidgetSessionId()

            logger.info('Cleared all conversation data', { removedKeys: keysToRemove.length })
        } catch (error) {
            logger.error('Failed to clear conversation data', error)
        }
    }
}
