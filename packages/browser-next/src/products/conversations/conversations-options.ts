import type {
    ConversationsTheme,
    ConversationsUnavailableReason,
    GetMessagesResponse,
    GetTicketsOptions,
    GetTicketsResponse,
    MarkAsReadResponse,
    RequestRestoreLinkResponse,
    RestoreFromTokenResponse,
    SendMessageResponse,
    UserProvidedTraits,
} from '@posthog/browser-common'
import type { ConversationsIdentity } from '@posthog/browser-common/conversations-renderer'
import type { StylesheetPreparer } from '@posthog/browser-common/utils/stylesheet-loader'
import type { BrowserExtension } from '../../core/context/browser-client'

export type {
    ConversationsTheme,
    ConversationsThemeColors,
    ConversationsUnavailableReason,
    GetMessagesResponse,
    GetTicketsOptions,
    GetTicketsResponse,
    MarkAsReadResponse,
    Message,
    RequestRestoreLinkResponse,
    RestoreFromTokenResponse,
    SendMessageResponse,
    Ticket,
    TicketStatus,
    UserProvidedTraits,
} from '@posthog/browser-common'
export type { ConversationsIdentity } from '@posthog/browser-common/conversations-renderer'

export interface ConversationsOptions {
    /** Widget theme. Change it later with `setTheme()`. */
    theme?: ConversationsTheme
    /**
     * Server-verified identity to start with, like posthog-js `identity_distinct_id`, `identity_hash` and
     * `identity_claims`. An anonymous visitor takes `identity.distinctId` as their distinct ID, unless setup `bootstrap`
     * supplies one. Change it later with `setIdentity()`.
     */
    identity?: ConversationsIdentity
    /** Prepare the widget stylesheet, for example to apply a CSP nonce. */
    prepareStylesheet?: StylesheetPreparer
}

export type ConversationsConfiguration = false | ConversationsOptions

/** Conversations: the support widget and its API. Methods that need the widget wait for remote configuration. */
export interface ConversationsExtension extends BrowserExtension {
    /** Show the widget, respecting its saved open or closed state. */
    show(): void
    /** Remove the widget from the page. Conversation data is kept. */
    hide(): void
    /** Open the chat panel, rendering the widget first when needed. Applies once conversations load. */
    open(): void
    /** Close the chat panel. The launcher stays on the page. Applies once conversations load. */
    close(): void
    /** Merge a theme patch over the current theme. Safe to call before conversations load. */
    setTheme(theme: ConversationsTheme): void
    /** Whether conversations are enabled for the project and loaded. */
    isAvailable(): boolean
    /** Why `isAvailable()` is false, or null when conversations are available. */
    getUnavailableReason(): ConversationsUnavailableReason | null
    /** Whether the widget is rendered and shown. */
    isVisible(): boolean
    /** Send a message, creating a ticket when none exists or `newTicket` is true. Resolves null when unavailable. */
    sendMessage(
        message: string,
        userTraits?: UserProvidedTraits,
        newTicket?: boolean
    ): Promise<SendMessageResponse | null>
    /** Fetch messages for the current or given ticket. Resolves null when unavailable. */
    getMessages(ticketId?: string, after?: string): Promise<GetMessagesResponse | null>
    /** Mark the current or given ticket's messages as read. Resolves null when unavailable. */
    markAsRead(ticketId?: string): Promise<MarkAsReadResponse | null>
    /** List tickets for this visitor. Resolves null when unavailable. */
    getTickets(options?: GetTicketsOptions): Promise<GetTicketsResponse | null>
    /** Email a link that restores previous conversations. Resolves null when unavailable. */
    requestRestoreLink(email: string): Promise<RequestRestoreLinkResponse | null>
    /** Redeem a restore token from a restore link. Resolves null when unavailable. */
    restoreFromToken(restoreToken: string): Promise<RestoreFromTokenResponse | null>
    /** Redeem the `ph_conv_restore` token in the current URL. Resolves null without a token or when unavailable. */
    restoreFromUrlToken(): Promise<RestoreFromTokenResponse | null>
    /** The active ticket ID, or null. */
    getCurrentTicketId(): string | null
    /** The persistent widget session ID that grants this browser access to its tickets, or null before loading. */
    getWidgetSessionId(): string | null
    /**
     * Use a server-verified identity for conversations instead of the anonymous widget session. `hash` is the
     * HMAC-SHA256 of `distinctId`, signed on your server with the Secret API key from Support settings. Also links
     * `distinctId` to the current person. Clears signed claims, which belong to the previous identity.
     */
    setIdentity(distinctId: string, hash: string): void
    /** Stop using a verified identity and return to the anonymous widget session. */
    clearIdentity(): void
}

export const snapshotConversationsOptions = (options: ConversationsOptions = {}): ConversationsOptions => ({
    ...options,
    ...(options.theme
        ? { theme: { ...options.theme, ...(options.theme.dark ? { dark: { ...options.theme.dark } } : {}) } }
        : {}),
    // The identity holds only strings, including the signed claims.
    ...(options.identity ? { identity: JSON.parse(JSON.stringify(options.identity)) } : {}),
})
