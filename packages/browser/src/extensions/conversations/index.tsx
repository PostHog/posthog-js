// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { render, h } from 'preact'
import { PostHog } from '../../posthog-core'
import { isNumber } from '@posthog/core'
import {
    ConversationsRemoteConfig,
    ConversationsWidgetState,
    UserProvidedTraits,
} from '../../posthog-conversations-types'
import { ConversationsManager as ConversationsManagerInterface, ConversationsApi } from '../../posthog-conversations'
import { ConversationsPersistence } from './persistence'
import { ConversationsWidget } from './components/ConversationsWidget'
import { createLogger } from '../../utils/logger'
import { document, window } from '../../utils/globals'

const logger = createLogger('[ConversationsManager]')

const WIDGET_CONTAINER_ID = 'ph-conversations-widget-container'
const POLL_INTERVAL_MS = 5000 // 5 seconds

export class ConversationsManager implements ConversationsManagerInterface {
    private _posthog: PostHog
    private _config: ConversationsRemoteConfig
    private _api: ConversationsApi
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

    constructor(posthog: PostHog, config: ConversationsRemoteConfig, api: ConversationsApi) {
        this._posthog = posthog
        this._config = config
        this._api = api
        this._persistence = new ConversationsPersistence(posthog)
        // Get or create widget_session_id - this stays the same even when user identifies
        this._widgetSessionId = this._persistence.getOrCreateWidgetSessionId()

        logger.info('ConversationsManager initialized', {
            config,
            hasApi: !!api,
            apiMethods: api ? Object.keys(api) : 'undefined',
            widgetSessionId: this._widgetSessionId,
        })

        this._initialize()
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

        logger.info('Widget rendered', { initialState })
    }

    /**
     * Handle user identification from the widget form
     */
    private _handleIdentify = (traits: UserProvidedTraits): void => {
        logger.info('User identified via widget form', { hasName: !!traits.name, hasEmail: !!traits.email })

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

        if (!this._api) {
            logger.error('API is undefined!')
            throw new Error('API not initialized')
        }

        if (!this._api.sendMessage) {
            logger.error('sendMessage is undefined on API!', { api: this._api })
            throw new Error('API.sendMessage not initialized')
        }

        const isNewTicket = !this._currentTicketId

        try {
            // Pass widget_session_id for access control
            const response = await this._api.sendMessage(
                message,
                this._currentTicketId || undefined,
                userTraits,
                this._widgetSessionId
            )

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
            const response = await this._api.markAsRead(this._currentTicketId, this._widgetSessionId)
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
            // Pass widget_session_id for access control
            const response = await this._api.getMessages(
                this._currentTicketId,
                this._lastMessageTimestamp || undefined,
                this._widgetSessionId
            )

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
        this._unsubscribeIdentifyListener = this._posthog.on('eventCaptured', (event) => {
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

    // Public interface methods

    /**
     * Show the widget
     */
    show(): void {
        this._widgetRef?.show()
    }

    /**
     * Hide/minimize the widget
     */
    hide(): void {
        this._widgetRef?.hide()
    }

    /**
     * Send a message programmatically
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
}

/**
 * Initialize the conversations widget
 * This is the entry point called from the lazy-loaded bundle
 */
export function initConversations(
    posthog: PostHog,
    config: ConversationsRemoteConfig,
    api: ConversationsApi
): ConversationsManager {
    logger.info('initConversations called', {
        hasPosthog: !!posthog,
        hasConfig: !!config,
        hasApi: !!api,
        apiType: typeof api,
        apiKeys: api ? Object.keys(api) : 'undefined',
        argumentsLength: arguments.length,
    })
    return new ConversationsManager(posthog, config, api)
}
