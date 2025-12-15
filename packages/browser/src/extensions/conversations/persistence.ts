import { PostHog } from '../../posthog-core'
import { UserProvidedTraits } from '../../posthog-conversations-types'
import { createLogger } from '../../utils/logger'
import { uuidv7 } from '../../uuidv7'

const logger = createLogger('[ConversationsPersistence]')

// Persistence keys - defined here in the lazy-loaded extension bundle
// These keys are also listed in constants.ts PERSISTENCE_RESERVED_PROPERTIES
// to prevent them from being included in event properties
const CONVERSATIONS_WIDGET_SESSION_ID = '$conversations_widget_session_id'
const CONVERSATIONS_TICKET_ID = '$conversations_ticket_id'
const CONVERSATIONS_WIDGET_STATE = '$conversations_widget_state'
const CONVERSATIONS_USER_TRAITS = '$conversations_user_traits'

/**
 * ConversationsPersistence manages conversation-related data using PostHog's
 * core persistence layer. This ensures the data respects user's persistence
 * preferences (localStorage, cookie, sessionStorage, memory) and consent settings.
 */
export class ConversationsPersistence {
    private _cachedWidgetSessionId: string | null = null

    constructor(private readonly _posthog: PostHog) {}

    /** Check if persistence is available and enabled */
    private _isPersistenceAvailable(): boolean {
        return !!this._posthog.persistence && !this._posthog.persistence.isDisabled?.()
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

        // Check if persistence is available
        if (!this._isPersistenceAvailable()) {
            // Fallback: generate a new one each time (won't persist)
            // This is acceptable for SSR or environments without persistence
            const sessionId = uuidv7()
            logger.warn('Persistence not available, widget_session_id will not persist', { sessionId })
            return sessionId
        }

        try {
            let sessionId = this._posthog.persistence?.get_property(CONVERSATIONS_WIDGET_SESSION_ID)
            if (!sessionId) {
                sessionId = uuidv7()
                this._posthog.persistence?.register({ [CONVERSATIONS_WIDGET_SESSION_ID]: sessionId })
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

        if (!this._isPersistenceAvailable()) {
            return
        }

        try {
            this._posthog.persistence?.unregister(CONVERSATIONS_WIDGET_SESSION_ID)
            logger.info('Cleared widget_session_id')
        } catch (error) {
            logger.error('Failed to clear widget_session_id', error)
        }
    }

    /**
     * Save the current ticket ID to persistence
     */
    saveTicketId(ticketId: string): void {
        if (!this._isPersistenceAvailable()) {
            logger.warn('Persistence not available')
            return
        }

        try {
            this._posthog.persistence?.register({ [CONVERSATIONS_TICKET_ID]: ticketId })
            logger.info('Saved ticket ID', { ticketId })
        } catch (error) {
            logger.error('Failed to save ticket ID', error)
        }
    }

    /**
     * Load the current ticket ID from persistence
     */
    loadTicketId(): string | null {
        if (!this._isPersistenceAvailable()) {
            logger.warn('Persistence not available')
            return null
        }

        try {
            const ticketId = this._posthog.persistence?.get_property(CONVERSATIONS_TICKET_ID)
            if (ticketId) {
                logger.info('Loaded ticket ID', { ticketId })
            }
            return ticketId || null
        } catch (error) {
            logger.error('Failed to load ticket ID', error)
            return null
        }
    }

    /**
     * Clear the current ticket ID from persistence
     */
    clearTicketId(): void {
        if (!this._isPersistenceAvailable()) {
            logger.warn('Persistence not available')
            return
        }

        try {
            this._posthog.persistence?.unregister(CONVERSATIONS_TICKET_ID)
            logger.info('Cleared ticket ID')
        } catch (error) {
            logger.error('Failed to clear ticket ID', error)
        }
    }

    /**
     * Save widget state (open, closed)
     */
    saveWidgetState(state: 'open' | 'closed'): void {
        if (!this._isPersistenceAvailable()) {
            return
        }

        try {
            this._posthog.persistence?.register({ [CONVERSATIONS_WIDGET_STATE]: state })
        } catch (error) {
            logger.error('Failed to save widget state', error)
        }
    }

    /**
     * Load widget state
     */
    loadWidgetState(): 'open' | 'closed' | null {
        if (!this._isPersistenceAvailable()) {
            return null
        }

        try {
            const state = this._posthog.persistence?.get_property(CONVERSATIONS_WIDGET_STATE)
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
     * Save user-provided traits (name, email) to persistence
     */
    saveUserTraits(traits: UserProvidedTraits): void {
        if (!this._isPersistenceAvailable()) {
            logger.warn('Persistence not available')
            return
        }

        try {
            this._posthog.persistence?.register({ [CONVERSATIONS_USER_TRAITS]: traits })
            logger.info('Saved user traits', { hasName: !!traits.name, hasEmail: !!traits.email })
        } catch (error) {
            logger.error('Failed to save user traits', error)
        }
    }

    /**
     * Load user-provided traits from persistence
     */
    loadUserTraits(): UserProvidedTraits | null {
        if (!this._isPersistenceAvailable()) {
            return null
        }

        try {
            const traits = this._posthog.persistence?.get_property(CONVERSATIONS_USER_TRAITS) as
                | UserProvidedTraits
                | undefined
            if (traits) {
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
     * Clear user-provided traits from persistence
     */
    clearUserTraits(): void {
        if (!this._isPersistenceAvailable()) {
            return
        }

        try {
            this._posthog.persistence?.unregister(CONVERSATIONS_USER_TRAITS)
            logger.info('Cleared user traits')
        } catch (error) {
            logger.error('Failed to clear user traits', error)
        }
    }

    /**
     * Clear all conversation-related data from persistence.
     * This is called on posthog.reset() to start fresh.
     */
    clearAll(): void {
        if (!this._isPersistenceAvailable()) {
            return
        }

        try {
            // Clear all conversation properties
            this._posthog.persistence?.unregister(CONVERSATIONS_WIDGET_STATE)
            this._posthog.persistence?.unregister(CONVERSATIONS_USER_TRAITS)
            this._posthog.persistence?.unregister(CONVERSATIONS_TICKET_ID)

            // Clear widget session ID last (this will lose access to previous tickets)
            this.clearWidgetSessionId()

            logger.info('Cleared all conversation data')
        } catch (error) {
            logger.error('Failed to clear conversation data', error)
        }
    }
}
