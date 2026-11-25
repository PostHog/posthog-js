import {
    CONVERSATIONS_LEGACY_TICKET_ID,
    CONVERSATIONS_LEGACY_USER_TRAITS,
    CONVERSATIONS_LEGACY_WIDGET_SESSION_ID,
    CONVERSATIONS_LEGACY_WIDGET_STATE,
} from '../../../constants'
import { PostHog } from '../../../posthog-core'
import {
    ConversationsPersistence as SharedConversationsPersistence,
    getConversationsStorageKey,
    type ConversationsStorageData,
} from '@posthog/browser-common/conversations-renderer'
import type { UserProvidedTraits } from '@posthog/browser-common'
import { createLogger } from '@posthog/browser-common/utils/logger'
import { window } from '@posthog/browser-common/utils/globals'

const logger = createLogger('[ConversationsPersistence]')

/**
 * Conversations data in its own dedicated localStorage entry, independent of PostHog's core persistence layer.
 *
 * This avoids a known issue where PostHog's persistence.props can lose data
 * when the cookie+localStorage merge in _parse() fails on large entries.
 *
 * Pattern follows toolbar and surveys extensions which also use dedicated
 * localStorage keys.
 */
export class ConversationsPersistence extends SharedConversationsPersistence {
    constructor(private readonly _posthog: PostHog) {
        super(getConversationsStorageKey(_posthog.config?.token), () => window?.localStorage)
        this._migrateFromLegacyPersistence()
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

            const widgetSessionId = persistence.get_property(CONVERSATIONS_LEGACY_WIDGET_SESSION_ID)
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

            const ticketId = persistence.get_property(CONVERSATIONS_LEGACY_TICKET_ID)
            if (ticketId) {
                data.ticketId = ticketId
            }

            const widgetState = persistence.get_property(CONVERSATIONS_LEGACY_WIDGET_STATE)
            if (widgetState === 'open' || widgetState === 'closed') {
                data.widgetState = widgetState
            }

            const userTraits = persistence.get_property(CONVERSATIONS_LEGACY_USER_TRAITS) as
                | UserProvidedTraits
                | undefined
            if (userTraits) {
                data.userTraits = userTraits
            }

            this._write(data)

            persistence.unregister(CONVERSATIONS_LEGACY_WIDGET_SESSION_ID)
            persistence.unregister(CONVERSATIONS_LEGACY_TICKET_ID)
            persistence.unregister(CONVERSATIONS_LEGACY_WIDGET_STATE)
            persistence.unregister(CONVERSATIONS_LEGACY_USER_TRAITS)

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
            const widgetSessionId = parsed?.[CONVERSATIONS_LEGACY_WIDGET_SESSION_ID]
            if (typeof widgetSessionId !== 'string' || !widgetSessionId) {
                return null
            }

            const data: ConversationsStorageData = { widgetSessionId }

            const ticketId = parsed?.[CONVERSATIONS_LEGACY_TICKET_ID]
            if (ticketId) {
                data.ticketId = ticketId
            }

            const widgetState = parsed?.[CONVERSATIONS_LEGACY_WIDGET_STATE]
            if (widgetState === 'open' || widgetState === 'closed') {
                data.widgetState = widgetState
            }

            const userTraits = parsed?.[CONVERSATIONS_LEGACY_USER_TRAITS]
            if (userTraits) {
                data.userTraits = userTraits
            }

            return data
        } catch {
            return null
        }
    }
}
