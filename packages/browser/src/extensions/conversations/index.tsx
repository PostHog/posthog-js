// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { render, h } from 'preact'
import { isNumber } from '@posthog/core'
import {
    ConversationsRemoteConfig,
    ConversationsWidgetState,
    UserProvidedTraits,
    SendMessageResponse,
    GetMessagesResponse,
    MarkAsReadResponse,
} from '../../posthog-conversations-types'
import { PostHog } from '../../posthog-core'
import { ConversationsManager as ConversationsManagerInterface } from '../../posthog-conversations'
import { ConversationsPersistence } from './persistence'
import { ConversationsWidget } from './components/ConversationsWidget'
import { createLogger } from '../../utils/logger'
import { document, window } from '../../utils/globals'
import { formDataToQuery } from '../../utils/request-utils'

const logger = createLogger('[ConversationsManager]')

const WIDGET_CONTAINER_ID = 'ph-conversations-widget-container'
const POLL_INTERVAL_MS = 5000 // 5 seconds

export class ConversationsManager implements ConversationsManagerInterface {
    private _config: ConversationsRemoteConfig
    private _persistence: ConversationsPersistence
    private _widgetRef: ConversationsWidget | null = null
    private _containerElement: HTMLDivElement | null = null
    private _currentTicketId: string | null = null
    private _pollIntervalId: number | null = null
    private _lastMessageTimestamp: string | null = null
    private _isPolling: boolean = false
    private _unsubscribeIdentifyListener: (() => void) | null = null
    private _unreadCount: number = 0
    // SECURITY: widget_session_id is the key for access control
    // This is a random UUID that only this browser knows
    private _widgetSessionId: string

    constructor(
        config: ConversationsRemoteConfig,
        private readonly _posthog: PostHog
    ) {
        this._config = config
        this._persistence = new ConversationsPersistence(_posthog)
        // Get or create widget_session_id - this stays the same even when user identifies
        this._widgetSessionId = this._persistence.getOrCreateWidgetSessionId()

        logger.info('ConversationsManager initialized', {
            config,
            widgetSessionId: this._widgetSessionId,
        })

        this._initialize()
    }

    /** Send a message via the API */
    private _apiSendMessage(
        message: string,
        ticketId: string | undefined,
        userTraits?: UserProvidedTraits
    ): Promise<SendMessageResponse> {
        const token = this._config.token

        // eslint-disable-next-line compat/compat
        return new Promise((resolve, reject) => {
            const distinctId = this._posthog.get_distinct_id()
            const personProperties = this._posthog.persistence?.props || {}

            // Priority for traits:
            // 1. User-provided traits from the widget form
            // 2. PostHog person properties
            const name = userTraits?.name || personProperties.$name || personProperties.name || null
            const email = userTraits?.email || personProperties.$email || personProperties.email || null

            const payload = {
                widget_session_id: this._widgetSessionId,
                // distinct_id is only used for Person linking, not access control
                distinct_id: distinctId,
                message: message.trim(),
                traits: {
                    name,
                    email,
                },
                ticket_id: ticketId || null,
            }

            this._posthog._send_request({
                url: this._posthog.requestRouter.endpointFor('api', '/api/conversations/v1/widget/message'),
                method: 'POST',
                data: payload,
                headers: {
                    'X-Conversations-Token': token,
                },
                callback: (response) => {
                    if (response.statusCode === 429) {
                        reject(new Error('Too many requests. Please wait before trying again.'))
                        return
                    }

                    if (response.statusCode !== 200 && response.statusCode !== 201) {
                        const errorMsg = response.json?.detail || response.json?.message || 'Failed to send message'
                        logger.error('Failed to send message', { status: response.statusCode })
                        reject(new Error(errorMsg))
                        return
                    }

                    if (!response.json) {
                        reject(new Error('Invalid response from server'))
                        return
                    }

                    const data = response.json as SendMessageResponse
                    resolve(data)
                },
            })
        })
    }

    /** Fetch messages via the API */
    private _apiGetMessages(ticketId: string, after?: string): Promise<GetMessagesResponse> {
        const token = this._config.token

        // eslint-disable-next-line compat/compat
        return new Promise((resolve, reject) => {
            // SECURITY: widget_session_id is required for access control
            // distinct_id is NOT sent for getMessages - access is controlled by widget_session_id only
            const queryParams: Record<string, string> = {
                widget_session_id: this._widgetSessionId,
                limit: '50',
            }

            if (after) {
                queryParams.after = after
            }

            this._posthog._send_request({
                url: this._posthog.requestRouter.endpointFor(
                    'api',
                    `/api/conversations/v1/widget/messages/${ticketId}?${formDataToQuery(queryParams)}`
                ),
                method: 'GET',
                headers: {
                    'X-Conversations-Token': token,
                },
                callback: (response) => {
                    if (response.statusCode === 429) {
                        reject(new Error('Too many requests. Please wait before trying again.'))
                        return
                    }

                    if (response.statusCode !== 200) {
                        const errorMsg = response.json?.detail || response.json?.message || 'Failed to fetch messages'
                        logger.error('Failed to fetch messages', { status: response.statusCode })
                        reject(new Error(errorMsg))
                        return
                    }

                    if (!response.json) {
                        reject(new Error('Invalid response from server'))
                        return
                    }

                    const data = response.json as GetMessagesResponse
                    resolve(data)
                },
            })
        })
    }

    /** Mark messages as read via the API */
    private _apiMarkAsRead(ticketId: string): Promise<MarkAsReadResponse> {
        const token = this._config.token

        // eslint-disable-next-line compat/compat
        return new Promise((resolve, reject) => {
            logger.info('Marking messages as read', { ticketId })

            this._posthog._send_request({
                url: this._posthog.requestRouter.endpointFor(
                    'api',
                    `/api/conversations/v1/widget/messages/${ticketId}/read`
                ),
                method: 'POST',
                data: {
                    widget_session_id: this._widgetSessionId,
                },
                headers: {
                    'X-Conversations-Token': token,
                },
                callback: (response) => {
                    if (response.statusCode === 429) {
                        reject(new Error('Too many requests. Please wait before trying again.'))
                        return
                    }

                    if (response.statusCode !== 200) {
                        const errorMsg =
                            response.json?.detail || response.json?.message || 'Failed to mark messages as read'
                        logger.error('Failed to mark messages as read', { status: response.statusCode })
                        reject(new Error(errorMsg))
                        return
                    }

                    if (!response.json) {
                        reject(new Error('Invalid response from server'))
                        return
                    }

                    const data = response.json as MarkAsReadResponse
                    resolve(data)
                },
            })
        })
    }

    /**
     * Initialize the widget
     */
    private _initialize(): void {
        if (!document || !window) {
            logger.info('Conversations not available: Document or window not available')
            return
        }

        // Load any existing ticket ID from localStorage
        this._currentTicketId = this._persistence.loadTicketId()
        logger.info('Loaded ticket ID from storage', { ticketId: this._currentTicketId })

        const savedState = this._persistence.loadWidgetState()
        let initialState = ConversationsWidgetState.CLOSED
        if (savedState === 'open') {
            initialState = ConversationsWidgetState.OPEN
        }

        // Get initial user traits (from PostHog person properties or saved)
        const initialUserTraits = this._getInitialUserTraits()

        // Render the widget
        this._renderWidget(initialState, initialUserTraits)

        // Track widget initialization
        this._posthog.capture('$conversations_widget_loaded', {
            hasExistingTicket: !!this._currentTicketId,
            initialState: initialState,
            hasUserTraits: !!initialUserTraits,
        })

        // If we have a ticket, load its messages
        if (this._currentTicketId) {
            this._loadMessages()
        }

        // Start polling for messages (always, to show unread badge)
        this._startPolling()

        // Listen for identify events to handle distinct_id changes
        this._setupIdentifyListener()
    }

    /**
     * Get initial user traits from PostHog or localStorage
     */
    private _getInitialUserTraits(): UserProvidedTraits | null {
        // First, check PostHog's person properties
        const personProperties = this._posthog.persistence?.props || {}
        const posthogName = personProperties.$name || personProperties.name
        const posthogEmail = personProperties.$email || personProperties.email

        // If we have traits from PostHog, use those
        if (posthogName || posthogEmail) {
            return {
                name: posthogName || undefined,
                email: posthogEmail || undefined,
            }
        }

        // Otherwise, check localStorage for previously saved traits
        const savedTraits = this._persistence.loadUserTraits()
        if (savedTraits && (savedTraits.name || savedTraits.email)) {
            return savedTraits
        }

        return null
    }

    /**
     * Handle user identification from the widget form
     */
    private _handleIdentify = (traits: UserProvidedTraits): void => {
        // Save traits to localStorage
        this._persistence.saveUserTraits(traits)

        // Track identification
        this._posthog.capture('$conversations_user_identified', {
            hasName: !!traits.name,
            hasEmail: !!traits.email,
        })
    }

    /**
     * Handle sending a message
     */
    private _handleSendMessage = async (message: string): Promise<void> => {
        // Get user traits from the widget
        const userTraits = this._widgetRef?.getUserTraits() || undefined

        const isNewTicket = !this._currentTicketId

        try {
            // Call API directly
            const response = await this._apiSendMessage(message, this._currentTicketId || undefined, userTraits)

            // Update current ticket ID
            if (!this._currentTicketId) {
                this._currentTicketId = response.ticket_id
                this._persistence.saveTicketId(response.ticket_id)
                logger.info('New ticket created', { ticketId: response.ticket_id })
            }

            // Track message sent
            this._posthog.capture('$conversations_message_sent', {
                ticketId: response.ticket_id,
                isNewTicket: isNewTicket,
                messageLength: message.length,
            })

            // Update last message timestamp
            this._lastMessageTimestamp = response.created_at

            // Poll for response immediately
            setTimeout(() => this._pollMessages(), 1000)
        } catch (error) {
            logger.error('Failed to send message', error)
            throw error
        }
    }

    /**
     * Handle widget state changes
     */
    private _handleStateChange = (state: ConversationsWidgetState): void => {
        logger.info('Widget state changed', { state })

        // Track state changes
        this._posthog.capture('$conversations_widget_state_changed', {
            state: state,
            ticketId: this._currentTicketId,
        })

        // Save state to localStorage
        this._persistence.saveWidgetState(state)

        // Mark messages as read when widget opens
        if (state === ConversationsWidgetState.OPEN) {
            if (this._unreadCount > 0 && this._currentTicketId) {
                this._markMessagesAsRead()
            }
        }
    }

    /**
     * Mark messages as read
     */
    private async _markMessagesAsRead(): Promise<void> {
        if (!this._currentTicketId) {
            return
        }

        try {
            const response = await this._apiMarkAsRead(this._currentTicketId)
            this._unreadCount = response.unread_count
            // Update the widget to reflect the new unread count
            this._widgetRef?.setUnreadCount(0)
            logger.info('Messages marked as read', { unreadCount: response.unread_count })
        } catch (error) {
            logger.error('Failed to mark messages as read', error)
        }
    }

    /**
     * Load messages for the current ticket
     */
    private async _loadMessages(): Promise<void> {
        if (!this._currentTicketId) {
            return
        }

        try {
            const response = await this._apiGetMessages(this._currentTicketId, this._lastMessageTimestamp || undefined)

            // Update unread count from response
            if (isNumber(response.unread_count)) {
                this._unreadCount = response.unread_count
                this._widgetRef?.setUnreadCount(response.unread_count)

                // If widget is open and there are unread messages, mark them as read
                if (response.unread_count > 0 && this._isWidgetOpen()) {
                    this._markMessagesAsRead()
                }
            }

            if (response.messages.length > 0) {
                this._widgetRef?.addMessages(response.messages)
                // Update last message timestamp
                const lastMessage = response.messages[response.messages.length - 1]
                this._lastMessageTimestamp = lastMessage.created_at
            }
        } catch (error) {
            logger.error('Failed to load messages', error)
        }
    }

    /**
     * Check if the widget is currently open
     */
    private _isWidgetOpen(): boolean {
        return this._persistence.loadWidgetState() === 'open'
    }

    /**
     * Poll for new messages
     */
    private _pollMessages = async (): Promise<void> => {
        if (this._isPolling || !this._currentTicketId) {
            return
        }

        this._isPolling = true
        try {
            await this._loadMessages()
        } finally {
            this._isPolling = false
        }
    }

    /**
     * Start polling for new messages
     */
    private _startPolling(): void {
        if (this._pollIntervalId) {
            return // Already polling
        }

        // Poll immediately
        this._pollMessages()

        // Set up interval
        this._pollIntervalId = window?.setInterval(() => {
            this._pollMessages()
        }, POLL_INTERVAL_MS) as unknown as number

        logger.info('Started polling for messages')
    }

    /**
     * Stop polling for new messages
     */
    private _stopPolling(): void {
        if (this._pollIntervalId) {
            window?.clearInterval(this._pollIntervalId)
            this._pollIntervalId = null
            logger.info('Stopped polling for messages')
        }
    }

    /**
     * Setup listener for identify events to handle distinct_id changes
     */
    private _setupIdentifyListener(): void {
        // Listen for captured events and detect $identify events
        this._unsubscribeIdentifyListener = this._posthog.on('eventCaptured', (event: any) => {
            if (event.event === '$identify') {
                const newDistinctId = event.properties?.distinct_id
                const oldDistinctId = event.properties?.$anon_distinct_id

                if (oldDistinctId && newDistinctId && oldDistinctId !== newDistinctId) {
                    logger.info('Detected identify event', { oldDistinctId, newDistinctId })
                    this._handleDistinctIdChange(oldDistinctId, newDistinctId)
                }
            }
        })
    }

    /**
     * Handle distinct_id changes when user identifies.
     * The user continues their conversation seamlessly - widget_session_id stays the same.
     * No migration needed since tickets are keyed by widget_session_id, not distinct_id.
     * Backend will update ticket.distinct_id for Person linking on the next message.
     */
    private _handleDistinctIdChange(oldDistinctId: string, newDistinctId: string): void {
        // No migration needed - widget_session_id stays the same
        // The user keeps access to their ticket because the widget_session_id hasn't changed
        logger.info('User identified, conversation continues with same widget_session_id', {
            ticketId: this._currentTicketId,
            widgetSessionId: this._widgetSessionId,
            oldDistinctId,
            newDistinctId,
        })

        // Track the identity change
        this._posthog.capture('$conversations_identity_changed', {
            hadExistingTicket: !!this._currentTicketId,
        })
    }

    /**
     * Enable/show the widget (button and chat panel)
     */
    enable(): void {
        this._widgetRef?.show()
    }

    /**
     * Disable/hide the widget completely (button and chat panel)
     */
    disable(): void {
        this._widgetRef?.hide()
    }

    /**
     * Send a message programmatically (internal use)
     */
    sendMessage(message: string): void {
        this._handleSendMessage(message)
    }

    /**
     * Clean up the widget
     */
    destroy(): void {
        this._stopPolling()

        // Unsubscribe from identify events
        if (this._unsubscribeIdentifyListener) {
            this._unsubscribeIdentifyListener()
            this._unsubscribeIdentifyListener = null
        }

        if (this._containerElement) {
            render(null, this._containerElement)
            this._containerElement.remove()
            this._containerElement = null
        }

        this._widgetRef = null
        logger.info('Widget destroyed')
    }

    /**
     * Render the widget to the DOM
     */
    private _renderWidget(initialState: ConversationsWidgetState, initialUserTraits: UserProvidedTraits | null): void {
        if (!document) {
            logger.info('Conversations widget not rendered: Document not available')
            return
        }

        // Create container if it doesn't exist
        let container = document.getElementById(WIDGET_CONTAINER_ID) as HTMLDivElement
        if (!container) {
            if (!document.body) {
                logger.info('Conversations widget not rendered: Document body not available yet')
                return
            }
            container = document.createElement('div')
            container.id = WIDGET_CONTAINER_ID
            document.body.appendChild(container)
        }
        this._containerElement = container

        // Render widget with ref
        render(
            <ConversationsWidget
                ref={(ref: ConversationsWidget | null) => {
                    this._widgetRef = ref
                }}
                config={this._config}
                initialState={initialState}
                initialUserTraits={initialUserTraits}
                onSendMessage={this._handleSendMessage}
                onStateChange={this._handleStateChange}
                onIdentify={this._handleIdentify}
            />,
            container
        )
    }
}

/**
 * Initialize the conversations widget
 * This is the entry point called from the lazy-loaded bundle
 */
export function initConversations(config: ConversationsRemoteConfig, posthog: PostHog): ConversationsManager {
    logger.info('initConversations called', { hasConfig: !!config, hasPosthog: !!posthog })
    return new ConversationsManager(config, posthog)
}
