import { createConversations, loadConversationsRenderer } from './conversations-extension'
import {
    snapshotConversationsOptions,
    type ConversationsExtension,
    type ConversationsOptions,
} from './conversations-options'

export type {
    ConversationsConfiguration,
    ConversationsExtension,
    ConversationsIdentity,
    ConversationsOptions,
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
} from './conversations-options'

/**
 * Creates the conversations extension. It loads the widget and its API once remote configuration enables
 * conversations for the project; the widget renderer is a separate chunk.
 */
export const conversations = (options: ConversationsOptions = {}): ConversationsExtension =>
    createConversations(snapshotConversationsOptions(options), loadConversationsRenderer)
