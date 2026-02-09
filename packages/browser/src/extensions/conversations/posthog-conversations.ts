import { PostHog } from '../../posthog-core'
import {
    ConversationsRemoteConfig,
    GetMessagesResponse,
    GetTicketsOptions,
    GetTicketsResponse,
    MarkAsReadResponse,
    SendMessageResponse,
    UserProvidedTraits,
} from '../../posthog-conversations-types'
import { RemoteConfig } from '../../types'
import { assignableWindow, LazyLoadedConversationsInterface } from '../../utils/globals'
import { createLogger } from '../../utils/logger'
import { isNullish, isUndefined, isBoolean, isNull } from '@posthog/core'

const logger = createLogger('[Conversations]')

export type ConversationsManager = LazyLoadedConversationsInterface

export class PostHogConversations {
    // This is set to undefined until the remote config is loaded
    // then it's set to true if conversations are enabled
    // or false if conversations are disabled in the project settings
    private _isConversationsEnabled?: boolean = undefined
    private _conversationsManager: LazyLoadedConversationsInterface | null = null
    private _isInitializing: boolean = false
    private _remoteConfig: ConversationsRemoteConfig | null = null

    constructor(private _instance: PostHog) {}

    onRemoteConfig(response: RemoteConfig) {
        // Don't load conversations if disabled via config
        if (this._instance.config.disable_conversations) {
            return
        }

        const conversations = response['conversations']
        if (isNullish(conversations)) {
            return
        }

        // Handle both boolean and object response
        if (isBoolean(conversations)) {
            this._isConversationsEnabled = conversations
        } else {
            // It's a ConversationsRemoteConfig object
            this._isConversationsEnabled = conversations.enabled
            this._remoteConfig = conversations
        }

        this.loadIfEnabled()
    }

    reset(): void {
        // Delegate cleanup to the lazy-loaded manager (which knows about persistence keys)
        // If not loaded, there's nothing to reset anyway
        this._conversationsManager?.reset()
        this._conversationsManager = null

        // Reset local state
        this._isConversationsEnabled = undefined
        this._remoteConfig = null
    }

    loadIfEnabled() {
        if (this._conversationsManager) {
            return
        }
        if (this._isInitializing) {
            return
        }
        if (this._instance.config.disable_conversations) {
            return
        }
        if (this._instance.config.cookieless_mode && this._instance.consent.isOptedOut()) {
            return
        }

        const phExtensions = assignableWindow?.__PosthogExtensions__
        if (!phExtensions) {
            return
        }

        // Wait for remote config to load
        if (isUndefined(this._isConversationsEnabled)) {
            return
        }

        // Check if conversations are enabled
        if (!this._isConversationsEnabled) {
            return
        }

        // Check if we have the required config
        if (!this._remoteConfig || !this._remoteConfig.token) {
            logger.error('Conversations enabled but missing token in remote config.')
            return
        }

        // Note: Domain check is done in ConversationsManager for widget rendering
        // The conversations API is loaded regardless of domain restrictions

        this._isInitializing = true

        try {
            const initConversations = phExtensions.initConversations
            if (initConversations) {
                // Conversations code is already loaded
                this._completeInitialization(initConversations)
                this._isInitializing = false
                return
            }

            // If we reach here, conversations code is not loaded yet
            const loadExternalDependency = phExtensions.loadExternalDependency
            if (!loadExternalDependency) {
                this._handleLoadError('PostHog loadExternalDependency extension not found.')
                return
            }

            // Load the conversations bundle
            loadExternalDependency(this._instance, 'conversations', (err) => {
                if (err || !phExtensions.initConversations) {
                    this._handleLoadError('Could not load conversations script', err)
                } else {
                    this._completeInitialization(phExtensions.initConversations)
                }
                this._isInitializing = false
            })
        } catch (e) {
            this._handleLoadError('Error initializing conversations', e)
            this._isInitializing = false
        }
    }

    /** Helper to finalize conversations initialization */
    private _completeInitialization(
        initConversationsFn: (config: ConversationsRemoteConfig, posthog: PostHog) => LazyLoadedConversationsInterface
    ): void {
        if (!this._remoteConfig) {
            logger.error('Cannot complete initialization: remote config is null')
            return
        }

        try {
            // Pass config and PostHog instance to the extension
            this._conversationsManager = initConversationsFn(this._remoteConfig, this._instance)
            logger.info('Conversations loaded successfully')
        } catch (e) {
            this._handleLoadError('Error completing conversations initialization', e)
        }
    }

    /** Helper to handle initialization errors */
    private _handleLoadError(message: string, error?: any): void {
        logger.error(message, error)
        this._conversationsManager = null
        this._isInitializing = false
    }

    /**
     * Show the conversations widget (button and chat panel)
     */
    show(): void {
        if (!this._conversationsManager) {
            logger.warn('Conversations not loaded yet.')
            return
        }
        this._conversationsManager.show()
    }

    /**
     * Hide the conversations widget completely (button and chat panel)
     */
    hide(): void {
        if (!this._conversationsManager) {
            return
        }
        this._conversationsManager.hide()
    }

    /**
     * Check if conversations are available (enabled in remote config AND loaded)
     * Use this to check if conversations API can be used.
     */
    isAvailable(): boolean {
        return this._isConversationsEnabled === true && !isNull(this._conversationsManager)
    }

    /**
     * Check if the widget is currently visible (rendered and shown)
     */
    isVisible(): boolean {
        return this._conversationsManager?.isVisible() ?? false
    }

    /**
     * Send a message programmatically
     * Creates a new ticket if none exists or if newTicket is true
     *
     * @param message - The message text to send
     * @param userTraits - Optional user identification data (name, email)
     * @param newTicket - If true, forces creation of a new ticket (starts new conversation)
     * @returns Promise with response or null if conversations not available yet
     * @note Conversations must be available first (check with isAvailable())
     *
     * @example
     * // Send to existing or create new conversation
     * const response = await posthog.conversations.sendMessage('Hello!', {
     *   name: 'John Doe',
     *   email: 'john@example.com'
     * })
     *
     * @example
     * // Force creation of a new conversation/ticket
     * const newConvo = await posthog.conversations.sendMessage('Start fresh', undefined, true)
     */
    async sendMessage(
        message: string,
        userTraits?: UserProvidedTraits,
        newTicket?: boolean
    ): Promise<SendMessageResponse | null> {
        if (!this._conversationsManager) {
            logger.warn('Conversations not available yet.')
            return null
        }
        return this._conversationsManager.sendMessage(message, userTraits, newTicket)
    }

    /**
     * Get messages for the current or specified ticket
     *
     * @param ticketId - Optional ticket ID (defaults to current active ticket)
     * @param after - Optional ISO timestamp to fetch messages after
     * @returns Promise with messages response or null if conversations not available yet
     * @note Conversations must be available first (check with isAvailable())
     *
     * @example
     * // Get messages for current ticket
     * const messages = await posthog.conversations.getMessages()
     *
     * // Get messages for specific ticket
     * const messages = await posthog.conversations.getMessages('ticket-uuid')
     */
    async getMessages(ticketId?: string, after?: string): Promise<GetMessagesResponse | null> {
        if (!this._conversationsManager) {
            logger.warn('Conversations not available yet.')
            return null
        }
        return this._conversationsManager.getMessages(ticketId, after)
    }

    /**
     * Mark messages as read for the current or specified ticket
     *
     * @param ticketId - Optional ticket ID (defaults to current active ticket)
     * @returns Promise with response or null if conversations not available yet
     * @note Conversations must be available first (check with isAvailable())
     *
     * @example
     * await posthog.conversations.markAsRead()
     */
    async markAsRead(ticketId?: string): Promise<MarkAsReadResponse | null> {
        if (!this._conversationsManager) {
            logger.warn('Conversations not available yet.')
            return null
        }
        return this._conversationsManager.markAsRead(ticketId)
    }

    /**
     * Get list of tickets for the current widget session
     *
     * @param options - Optional filtering and pagination options
     * @returns Promise with tickets response or null if conversations not available yet
     * @note Conversations must be available first (check with isAvailable())
     *
     * @example
     * const tickets = await posthog.conversations.getTickets({
     *   limit: 10,
     *   offset: 0,
     *   status: 'open'
     * })
     */
    async getTickets(options?: GetTicketsOptions): Promise<GetTicketsResponse | null> {
        if (!this._conversationsManager) {
            logger.warn('Conversations not available yet.')
            return null
        }
        return this._conversationsManager.getTickets(options)
    }

    /**
     * Get the current active ticket ID
     * Returns null if no conversation has been started yet or if not available
     *
     * @returns Ticket ID or null
     * @note Safe to call before conversations are available, will return null
     *
     * @example
     * const ticketId = posthog.conversations.getCurrentTicketId()
     * if (ticketId) {
     *   console.log('Current ticket ID:', ticketId)
     * }
     */
    getCurrentTicketId(): string | null {
        return this._conversationsManager?.getCurrentTicketId() ?? null
    }

    /**
     * Get the widget session ID (persistent browser identifier)
     * This ID is used for access control and stays the same across page loads
     * Returns null if conversations not available yet
     *
     * @returns Session ID or null if not available
     * @note Safe to call before conversations are available, will return null
     *
     * @example
     * const sessionId = posthog.conversations.getWidgetSessionId()
     * if (!sessionId) {
     *   // Conversations not available yet
     *   posthog.conversations.show()
     * }
     */
    getWidgetSessionId(): string | null {
        return this._conversationsManager?.getWidgetSessionId() ?? null
    }
}
