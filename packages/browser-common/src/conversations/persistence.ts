import type { UserProvidedTraits } from '../types/conversations'
import { createLogger } from '../utils/logger'
import { uuidv7 } from '../utils/uuidv7'

const logger = createLogger('[ConversationsPersistence]')

export interface ConversationsStorageData {
    widgetSessionId?: string
    ticketId?: string | null
    widgetState?: 'open' | 'closed'
    userTraits?: UserProvidedTraits | null
}

/** Storage for the conversations record. Implementations may throw; persistence contains failures. */
export interface ConversationsStorage {
    getItem(key: string): string | null | undefined
    setItem(key: string, value: string): void
    removeItem(key: string): void
}

/**
 * Dedicated storage key scoped to the PostHog project token.
 * Format: `ph_conv_<token>`
 */
export function getConversationsStorageKey(token: string | undefined): string | null {
    return token ? 'ph_conv_' + token : null
}

/**
 * ConversationsPersistence manages conversation data in its own dedicated
 * storage entry, independent of the SDK's core persistence layer.
 */
export class ConversationsPersistence {
    private _cachedWidgetSessionId: string | null = null
    private _createdWidgetSessionId: boolean = false

    constructor(
        protected readonly _storageKey: string | null,
        private readonly _storage: () => ConversationsStorage | undefined
    ) {}

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
            this._createdWidgetSessionId = true
        }

        this._cachedWidgetSessionId = sessionId
        return sessionId
    }

    /**
     * Whether getOrCreateWidgetSessionId() generated a new ID instead of reading a stored one.
     * The server cannot have tickets for a session ID that did not exist before.
     */
    isNewWidgetSession(): boolean {
        return this._createdWidgetSessionId
    }

    /**
     * Overwrite the widget session ID (used by restore flow).
     */
    setWidgetSessionId(id: string): void {
        this._cachedWidgetSessionId = id
        this._createdWidgetSessionId = false
        const data = this._read() || {}
        this._write({ ...data, widgetSessionId: id })
    }

    /**
     * Clear the widget session ID (called on reset).
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
                this._storage()?.removeItem(this._storageKey)
            } catch {
                logger.error('Failed to remove localStorage item')
            }
        }
    }

    protected _read(): ConversationsStorageData | null {
        if (!this._storageKey) {
            return null
        }
        try {
            const raw = this._storage()?.getItem(this._storageKey)
            return raw ? (JSON.parse(raw) as ConversationsStorageData) : null
        } catch {
            return null
        }
    }

    protected _write(data: ConversationsStorageData): void {
        if (!this._storageKey) {
            return
        }
        try {
            this._storage()?.setItem(this._storageKey, JSON.stringify(data))
        } catch (error) {
            logger.error('Failed to write to localStorage', error)
        }
    }
}
