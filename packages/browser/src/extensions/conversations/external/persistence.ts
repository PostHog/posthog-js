import { PostHog } from '../../../posthog-core'
import { UserProvidedTraits } from '../../../posthog-conversations-types'
import { createLogger } from '../../../utils/logger'
import { window } from '../../../utils/globals'
import { uuidv7 } from '../../../uuidv7'

const logger = createLogger('[ConversationsPersistence]')

// Old persistence keys (in PostHog's main persistence blob).
// Kept for one-time migration to dedicated storage.
const LEGACY_WIDGET_SESSION_ID = '$conversations_widget_session_id'
const LEGACY_TICKET_ID = '$conversations_ticket_id'
const LEGACY_WIDGET_STATE = '$conversations_widget_state'
const LEGACY_USER_TRAITS = '$conversations_user_traits'

interface ConversationsStorageData {
    widgetSessionId?: string
    ticketId?: string | null
    widgetState?: 'open' | 'closed'
    userTraits?: UserProvidedTraits | null
}

/**
 * Dedicated localStorage key scoped to the PostHog project token.
 * Format: `ph_conv_<token>`
 */
function storageKey(posthog: PostHog): string | null {
    const token = posthog.config?.token
    return token ? 'ph_conv_' + token : null
}

/**
 * ConversationsPersistence manages conversation data in its own dedicated
 * localStorage entry, independent of PostHog's core persistence layer.
 *
 * This avoids a known issue where PostHog's persistence.props can lose data
 * when the cookie+localStorage merge in _parse() fails on large entries.
 *
 * Pattern follows toolbar and surveys extensions which also use dedicated
 * localStorage keys.
 */
export class ConversationsPersistence {
    private _cachedWidgetSessionId: string | null = null
    private _storageKey: string | null

    constructor(private readonly _posthog: PostHog) {
        this._storageKey = storageKey(_posthog)
        this._migrateFromLegacyPersistence()
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
        if (this._cachedWidgetSessionId) {
            return this._cachedWidgetSessionId
        }

        let sessionId = this._read()?.widgetSessionId

        if (!sessionId) {
            sessionId = uuidv7()
            this._write({ widgetSessionId: sessionId })
        }

        this._cachedWidgetSessionId = sessionId
        return sessionId
    }

    /**
     * Overwrite the widget session ID (used by restore flow).
     */
    setWidgetSessionId(id: string): void {
        this._cachedWidgetSessionId = id
        const data = this._read() || {}
        this._write({ ...data, widgetSessionId: id })
    }

    /**
     * Clear the widget session ID (called on posthog.reset()).
     * This will create a new session and lose access to previous tickets.
     */
    clearWidgetSessionId(): void {
        this._cachedWidgetSessionId = null
        const data = this._read()
        if (data) {
            delete data.widgetSessionId
            this._write(data)
        }
    }

    saveTicketId(ticketId: string): void {
        const data = this._read() || {}
        this._write({ ...data, ticketId })
    }

    loadTicketId(): string | null {
        return this._read()?.ticketId || null
    }

    clearTicketId(): void {
        const data = this._read()
        if (data) {
            delete data.ticketId
            this._write(data)
        }
    }

    saveWidgetState(state: 'open' | 'closed'): void {
        const data = this._read() || {}
        this._write({ ...data, widgetState: state })
    }

    loadWidgetState(): 'open' | 'closed' | null {
        const state = this._read()?.widgetState
        return state === 'open' || state === 'closed' ? state : null
    }

    saveUserTraits(traits: UserProvidedTraits): void {
        const data = this._read() || {}
        this._write({ ...data, userTraits: traits })
    }

    loadUserTraits(): UserProvidedTraits | null {
        const traits = this._read()?.userTraits
        return traits && (traits.name || traits.email) ? traits : null
    }

    clearUserTraits(): void {
        const data = this._read()
        if (data) {
            delete data.userTraits
            this._write(data)
        }
    }

    clearAll(): void {
        this._cachedWidgetSessionId = null
        if (this._storageKey) {
            try {
                window?.localStorage?.removeItem(this._storageKey)
            } catch {
                logger.error('Failed to remove localStorage item')
            }
        }
    }

    private _read(): ConversationsStorageData | null {
        if (!this._storageKey) {
            return null
        }
        try {
            const raw = window?.localStorage?.getItem(this._storageKey)
            return raw ? (JSON.parse(raw) as ConversationsStorageData) : null
        } catch {
            return null
        }
    }

    private _write(data: ConversationsStorageData): void {
        if (!this._storageKey) {
            return
        }
        try {
            window?.localStorage?.setItem(this._storageKey, JSON.stringify(data))
        } catch (error) {
            logger.error('Failed to write to localStorage', error)
        }
    }

    /**
     * One-time migration: copy conversations data from PostHog's main
     * persistence blob into the dedicated localStorage key, then remove
     * the old keys from PostHog persistence so they stop bloating it.
     */
    private _migrateFromLegacyPersistence(): void {
        if (!this._storageKey || this._read()?.widgetSessionId) {
            return
        }

        try {
            const persistence = this._posthog.persistence
            if (!persistence || persistence.isDisabled?.()) {
                return
            }

            const widgetSessionId = persistence.get_property(LEGACY_WIDGET_SESSION_ID)
            if (!widgetSessionId) {
                // persistence.props may be empty (the bug) — try raw localStorage
                const legacyFromRaw = this._readLegacyFromRawStorage()
                if (legacyFromRaw) {
                    this._write(legacyFromRaw)
                    logger.info('Migrated conversations data from raw localStorage')
                }
                return
            }

            const data: ConversationsStorageData = { widgetSessionId }

            const ticketId = persistence.get_property(LEGACY_TICKET_ID)
            if (ticketId) {
                data.ticketId = ticketId
            }

            const widgetState = persistence.get_property(LEGACY_WIDGET_STATE)
            if (widgetState === 'open' || widgetState === 'closed') {
                data.widgetState = widgetState
            }

            const userTraits = persistence.get_property(LEGACY_USER_TRAITS) as UserProvidedTraits | undefined
            if (userTraits) {
                data.userTraits = userTraits
            }

            this._write(data)

            persistence.unregister(LEGACY_WIDGET_SESSION_ID)
            persistence.unregister(LEGACY_TICKET_ID)
            persistence.unregister(LEGACY_WIDGET_STATE)
            persistence.unregister(LEGACY_USER_TRAITS)

            logger.info('Migrated conversations data to dedicated storage')
        } catch (error) {
            logger.error('Migration from legacy persistence failed', error)
        }
    }

    /**
     * Fallback for migration: read legacy keys directly from raw localStorage
     * when PostHog persistence.props didn't load them (the original bug).
     */
    private _readLegacyFromRawStorage(): ConversationsStorageData | null {
        try {
            const token = this._posthog.config?.token
            if (!token) {
                return null
            }
            const key = (this._posthog.config as any).persistence_name
                ? 'ph_' + (this._posthog.config as any).persistence_name
                : 'ph_' + token + '_posthog'

            const raw = window?.localStorage?.getItem(key)
            if (!raw) {
                return null
            }

            const parsed = JSON.parse(raw)
            const widgetSessionId = parsed?.[LEGACY_WIDGET_SESSION_ID]
            if (typeof widgetSessionId !== 'string' || !widgetSessionId) {
                return null
            }

            const data: ConversationsStorageData = { widgetSessionId }

            const ticketId = parsed?.[LEGACY_TICKET_ID]
            if (ticketId) {
                data.ticketId = ticketId
            }

            const widgetState = parsed?.[LEGACY_WIDGET_STATE]
            if (widgetState === 'open' || widgetState === 'closed') {
                data.widgetState = widgetState
            }

            const userTraits = parsed?.[LEGACY_USER_TRAITS]
            if (userTraits) {
                data.userTraits = userTraits
            }

            return data
        } catch {
            return null
        }
    }
}
