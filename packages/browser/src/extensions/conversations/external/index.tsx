// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { render, h } from 'preact'
import { isNumber } from '@posthog/core'
import {
    ConversationsRemoteConfig,
    ConversationsWidgetState,
    UserProvidedTraits,
    SendMessageResponse,
    SendMessagePayload,
    GetMessagesResponse,
    MarkAsReadResponse,
    GetTicketsOptions,
    GetTicketsResponse,
    Ticket,
    RestoreFromTokenPayload,
    RestoreFromTokenResponse,
    RequestRestoreLinkPayload,
    RequestRestoreLinkResponse,
} from '../../../posthog-conversations-types'
import { PostHog } from '../../../posthog-core'
import { STORED_PERSON_PROPERTIES_KEY } from '../../../constants'
import { ConversationsManager as ConversationsManagerInterface } from '../posthog-conversations'
import { ConversationsPersistence } from './persistence'
import { ConversationsWidget, WidgetView } from './components/ConversationsWidget'
import { createLogger } from '../../../utils/logger'
import { document, window } from '../../../utils/globals'
import { formDataToQuery } from '../../../utils/request-utils'
import { isCurrentDomainAllowed, getRestoreTokenFromUrl, clearRestoreTokenFromUrl } from './url-utils'

const logger = createLogger('[ConversationsManager]')

const WIDGET_CONTAINER_ID = 'ph-conversations-widget-container'
const POLL_INTERVAL_MS = 5000 // 5 seconds
const RESTORE_EXCHANGE_ENDPOINT = '/api/conversations/v1/widget/restore'
const RESTORE_REQUEST_ENDPOINT = '/api/conversations/v1/widget/restore/request'

// Singleton guard: only one ConversationsManager per page.
// The toolbar's internal PostHog instance is excluded from creating a manager
// (see PostHogConversations.loadIfEnabled), so this always belongs to the main instance.
let _activeManager: ConversationsManager | null = null

export class ConversationsManager implements ConversationsManagerInterface {
    private _config: ConversationsRemoteConfig
    private _persistence: ConversationsPersistence
    private _widgetRef: ConversationsWidget | null = null
    private _containerElement: HTMLDivElement | null = null
    private _currentTicketId: string | null = null
    private _pollIntervalId: number | null = null
    private _lastMessageTimestamp: string | null = null
    private _isPollingMessages: boolean = false
    private _isPollingTickets: boolean = false
    private _unsubscribeIdentifyListener: (() => void) | null = null
    private _unreadCount: number = 0
    // SECURITY: widget_session_id is the key for access control
    // This is a random UUID that only this browser knows
    private _widgetSessionId: string
    private _isWidgetEnabled: boolean
    private _isDomainAllowed: boolean
    private _widgetState: ConversationsWidgetState = 'closed'
    private _isWidgetRendered: boolean = false
    private _hasProcessedRestoreToken: boolean = false
    private _initializeWidgetPromise: Promise<void> | null = null
    // View state management for ticket list vs message view
    private _currentView: WidgetView = 'messages'
    private _tickets: Ticket[] = []
    private _hasMultipleTickets: boolean = false

    constructor(
        config: ConversationsRemoteConfig,
        private readonly _posthog: PostHog
    ) {
        this._config = config
        this._persistence = new ConversationsPersistence(_posthog)

        this._widgetSessionId = this._persistence.getOrCreateWidgetSessionId()

        // Determine if widget should be shown based on config and domain
        this._isWidgetEnabled = config.widgetEnabled === true
        this._isDomainAllowed = isCurrentDomainAllowed(config.domains)

        this._initialize()
    }

    /**
     * Send a message programmatically via the API
     * Creates a new ticket if none exists or if newTicket is true
     *
     * @param message - The message text to send
     * @param userTraits - Optional user identification data (name, email)
     * @param newTicket - If true, forces creation of a new ticket (ignores current ticket)
     * @returns Promise with the response including ticket_id and message_id
     */
    async sendMessage(
        message: string,
        userTraits?: UserProvidedTraits,
        newTicket?: boolean
    ): Promise<SendMessageResponse> {
        // Determine which ticket to use
        // If newTicket is true, force creation of new ticket by sending null
        // Otherwise use current ticket ID (which may be null if no ticket exists yet)
        const ticketId = newTicket ? null : this._currentTicketId

        // Track if this is creating a new ticket
        const isNewTicket = !ticketId

        const token = this._config.token

        // eslint-disable-next-line compat/compat
        return new Promise((resolve, reject) => {
            const distinctId = this._posthog.get_distinct_id()
            const personTraits = this._getPersonTraits()

            const name = userTraits?.name || personTraits.name || null
            const email = userTraits?.email || personTraits.email || null

            const payload: Partial<SendMessagePayload> = {
                widget_session_id: this._widgetSessionId,
                // distinct_id is only used for Person linking, not access control
                distinct_id: distinctId,
                message: message.trim(),
                traits: {
                    name,
                    email,
                },
                ticket_id: ticketId,
            }

            try {
                // Capture session ID - sent with every message
                const capturedSessionId = this._posthog.get_session_id()
                if (capturedSessionId) {
                    payload.session_id = capturedSessionId
                }

                // Capture session replay URL with timestamp - sent with every message
                const replayUrl = this._posthog.get_session_replay_url({
                    withTimestamp: true,
                    timestampLookBack: 30,
                })

                // Capture current URL - only for new tickets to record where user started
                const currentUrl = isNewTicket ? window?.location?.href : undefined

                if (replayUrl || currentUrl) {
                    payload.session_context = {
                        session_replay_url: replayUrl || undefined,
                        current_url: currentUrl || undefined,
                    }
                }
            } catch (error) {
                // Log error but don't fail message sending
                logger.warn('Failed to capture session context', error)
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

                    // Update current ticket ID if this was a new ticket
                    // This happens when: 1) No ticket existed, or 2) User forced new ticket creation
                    if (isNewTicket && data.ticket_id) {
                        this._currentTicketId = data.ticket_id
                        this._persistence.saveTicketId(data.ticket_id)
                        logger.info('New ticket created', {
                            ticketId: data.ticket_id,
                            forced: newTicket === true,
                        })
                    }

                    // Track message sent
                    this._posthog.capture('$conversations_message_sent', {
                        ticketId: data.ticket_id,
                        isNewTicket: isNewTicket,
                        messageLength: message.length,
                    })

                    // Update last message timestamp
                    this._lastMessageTimestamp = data.created_at

                    resolve(data)
                },
            })
        })
    }

    /**
     * Switch to a different ticket if an explicit ticketId is provided
     * This ensures subsequent operations (sendMessage, etc.) use the correct ticket
     */
    private _switchToTicketIfNeeded(ticketId: string | undefined): void {
        if (ticketId && ticketId !== this._currentTicketId) {
            this._currentTicketId = ticketId
            this._persistence.saveTicketId(ticketId)
            // Reset last message timestamp when switching tickets
            this._lastMessageTimestamp = null
        }
    }

    /** Fetch messages via the API */
    async getMessages(ticketId?: string, after?: string): Promise<GetMessagesResponse> {
        // Use provided ticketId or fall back to current ticket
        const targetTicketId = ticketId || this._currentTicketId

        if (!targetTicketId) {
            throw new Error('No ticket ID provided and no active conversation')
        }

        // Switch to this ticket if explicitly provided
        this._switchToTicketIfNeeded(ticketId)

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
                    `/api/conversations/v1/widget/messages/${targetTicketId}?${formDataToQuery(queryParams)}`
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
    async markAsRead(ticketId?: string): Promise<MarkAsReadResponse> {
        // Use provided ticketId or fall back to current ticket
        const targetTicketId = ticketId || this._currentTicketId

        if (!targetTicketId) {
            throw new Error('No ticket ID provided and no active conversation')
        }

        // Switch to this ticket if explicitly provided
        this._switchToTicketIfNeeded(ticketId)

        const token = this._config.token

        logger.info('Marking messages as read', { ticketId: targetTicketId })

        // eslint-disable-next-line compat/compat
        return new Promise((resolve, reject) => {
            this._posthog._send_request({
                url: this._posthog.requestRouter.endpointFor(
                    'api',
                    `/api/conversations/v1/widget/messages/${targetTicketId}/read`
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
     * Initialize the conversations manager.
     * Always initializes persistence and event listeners for API usage.
     * Only renders the widget if widgetEnabled is true AND domain is allowed.
     */
    private _initialize(): void {
        if (!document || !window) {
            logger.info('Conversations not available: Document or window not available')
            return
        }

        const restoreToken = getRestoreTokenFromUrl()
        if (restoreToken && !this._hasProcessedRestoreToken) {
            this._hasProcessedRestoreToken = true

            // Clear the token from the URL immediately, then again after a tick and
            // after the restore completes.  SPA routers (Next.js, React Router, etc.)
            // maintain their own URL state and can overwrite a single replaceState call.
            clearRestoreTokenFromUrl()
            setTimeout(clearRestoreTokenFromUrl, 0)

            this._restoreFromTokenWithRetry(restoreToken)
                .catch((error) => {
                    logger.warn('Failed to restore conversations from URL token', error)
                })
                .finally(() => {
                    clearRestoreTokenFromUrl()
                    this._completeInitialization()
                })
            return
        }

        this._completeInitialization()
    }

    private _completeInitialization(): void {
        this._hasProcessedRestoreToken = true

        // Load any existing ticket ID from localStorage
        this._currentTicketId = this._persistence.loadTicketId()
        logger.info('Loaded ticket ID from storage', { ticketId: this._currentTicketId })

        // Track conversations API loaded (separate from widget loaded)
        this._posthog.capture('$conversations_loaded', {
            hasExistingTicket: !!this._currentTicketId,
            widgetEnabled: this._isWidgetEnabled,
            domainAllowed: this._isDomainAllowed,
        })

        // Only render widget if both widgetEnabled and domain is allowed
        if (this._isWidgetEnabled && this._isDomainAllowed) {
            this._initializeWidget()
        } else {
            logger.info('Widget not rendered', {
                widgetEnabled: this._isWidgetEnabled,
                domainAllowed: this._isDomainAllowed,
            })
        }

        // Listen for identify events to hide identification form when user identifies
        this._setupIdentifyListener()
    }

    private async _restoreFromTokenWithRetry(restoreToken: string): Promise<RestoreFromTokenResponse> {
        try {
            return await this._restoreFromToken(restoreToken)
        } catch (error) {
            logger.warn('Restore token exchange failed, retrying once', error)
            return await this._restoreFromToken(restoreToken)
        }
    }

    private async _restoreFromToken(restoreToken: string): Promise<RestoreFromTokenResponse> {
        const token = this._config.token

        const payload: RestoreFromTokenPayload = {
            restore_token: restoreToken,
            widget_session_id: this._widgetSessionId,
            distinct_id: this._posthog.get_distinct_id(),
            current_url: window?.location?.href,
        }

        // eslint-disable-next-line compat/compat
        const data = await new Promise<RestoreFromTokenResponse>((resolve, reject) => {
            this._posthog._send_request({
                url: this._posthog.requestRouter.endpointFor('api', RESTORE_EXCHANGE_ENDPOINT),
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

                    if (response.statusCode !== 200) {
                        const errorMsg =
                            response.json?.error ||
                            response.json?.detail ||
                            response.json?.message ||
                            'Failed to restore conversations'
                        reject(new Error(errorMsg))
                        return
                    }

                    if (!response.json) {
                        reject(new Error('Invalid response from server'))
                        return
                    }

                    resolve(response.json as RestoreFromTokenResponse)
                },
            })
        })

        if (data.status !== 'success') {
            logger.info('Restore token was not accepted', { status: data.status, code: data.code })
            return data
        }

        this._lastMessageTimestamp = null
        this._unreadCount = 0

        // Apply the canonical widget_session_id from the server if provided
        if (data.widget_session_id) {
            this._widgetSessionId = data.widget_session_id
            this._persistence.setWidgetSessionId(data.widget_session_id)
        }

        if (data.migrated_ticket_ids?.length) {
            this._currentTicketId = data.migrated_ticket_ids[0]
            this._persistence.saveTicketId(this._currentTicketId)
            // Poll straight away so messages and ticket list are fresh
            void this._pollMessages()
            void this._pollTickets()
        } else {
            this._currentTicketId = null
            this._persistence.clearTicketId()
        }

        return data
    }

    /**
     * Initialize and render the widget UI
     * Uses a promise guard to prevent race conditions from concurrent calls
     */
    private _initializeWidget(): Promise<void> {
        if (this._isWidgetRendered) {
            return Promise.resolve()
        }
        if (this._initializeWidgetPromise) {
            return this._initializeWidgetPromise
        }
        this._initializeWidgetPromise = this._doInitializeWidget()
        return this._initializeWidgetPromise
    }

    private async _doInitializeWidget(): Promise<void> {
        const savedState = this._persistence.loadWidgetState()
        const initialState: ConversationsWidgetState = savedState === 'open' ? 'open' : 'closed'
        this._widgetState = initialState

        // Get initial user traits (from PostHog person properties or saved)
        const initialUserTraits = this._getInitialUserTraits()

        // Determine initial view based on ticket count
        const { view: initialView, tickets } = await this._determineInitialView()
        this._currentView = initialView

        // Render the widget with initial view
        this._renderWidget(initialState, initialUserTraits, initialView, tickets)
        this._isWidgetRendered = true

        this._posthog.capture('$conversations_widget_loaded', {
            hasExistingTicket: !!this._currentTicketId,
            initialState: initialState,
            initialView: initialView,
            ticketCount: tickets.length,
            hasUserTraits: !!initialUserTraits,
        })

        // Start polling — the first poll fires immediately and loads messages or tickets
        this._startPolling()
    }

    /**
     * Extract name and email from PostHog's stored person properties.
     *
     * Person properties set via posthog.identify() are stored under the
     * $stored_person_properties persistence key, not as top-level props.
     * We check both locations plus the super-properties for completeness.
     */
    private _getPersonTraits(): { name: string | undefined; email: string | undefined } {
        const superProps = this._posthog.persistence?.props || {}
        const storedPersonProps =
            (this._posthog.get_property(STORED_PERSON_PROPERTIES_KEY) as Record<string, any>) || {}

        const name =
            storedPersonProps.$name || storedPersonProps.name || superProps.$name || superProps.name || undefined
        const email =
            storedPersonProps.$email || storedPersonProps.email || superProps.$email || superProps.email || undefined

        return { name, email }
    }

    /**
     * Get initial user traits from PostHog or localStorage
     */
    private _getInitialUserTraits(): UserProvidedTraits | null {
        const { name, email } = this._getPersonTraits()

        if (name || email) {
            return {
                name: name || undefined,
                email: email || undefined,
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

    private _handleRequestRestoreLink = async (email: string): Promise<RequestRestoreLinkResponse> => {
        const response = await this.requestRestoreLink(email)
        this._posthog.capture('$conversations_restore_link_requested', {
            hasEmail: !!email,
        })
        return response
    }

    /**
     * Handle sending a message from the widget
     */
    private _handleSendMessage = async (message: string): Promise<void> => {
        // Get user traits from the widget
        const userTraits = this._widgetRef?.getUserTraits() || undefined

        try {
            // Call the public API method (which handles tracking and state updates)
            await this.sendMessage(message, userTraits)

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
        this._widgetState = state
        logger.info('Widget state changed', { state, view: this._currentView })

        this._posthog.capture('$conversations_widget_state_changed', {
            state: state,
            view: this._currentView,
            ticketId: this._currentTicketId,
        })

        this._persistence.saveWidgetState(state)

        // Mark messages as read when widget opens (only if in message view with a ticket)
        if (state === 'open') {
            if (this._currentView === 'messages' && this._unreadCount > 0 && this._currentTicketId) {
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
            const response = await this.markAsRead(this._currentTicketId)
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
            const response = await this.getMessages(this._currentTicketId, this._lastMessageTimestamp || undefined)

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

    private _isWidgetOpen(): boolean {
        return this._widgetState === 'open'
    }

    /**
     * Poll for new messages
     */
    private _pollMessages = async (): Promise<void> => {
        if (this._isPollingMessages || !this._currentTicketId) {
            return
        }

        this._isPollingMessages = true
        try {
            await this._loadMessages()
        } finally {
            this._isPollingMessages = false
        }
    }

    /**
     * Poll for tickets list
     */
    private _pollTickets = async (): Promise<void> => {
        if (this._isPollingTickets) {
            return
        }

        this._isPollingTickets = true
        try {
            await this._loadTickets()
        } finally {
            this._isPollingTickets = false
        }
    }

    /**
     * Load tickets list from API
     */
    private async _loadTickets(): Promise<void> {
        try {
            const response = await this.getTickets()
            this._tickets = response.results
            this._hasMultipleTickets = response.results.length > 1
            this._widgetRef?.updateTickets(response.results)

            // Calculate total unread across all tickets
            const totalUnread = response.results.reduce((sum, t) => sum + (t.unread_count || 0), 0)
            this._unreadCount = totalUnread
            this._widgetRef?.setUnreadCount(totalUnread)

            logger.info('Tickets loaded', { count: response.results.length, totalUnread })
        } catch (error) {
            logger.error('Failed to load tickets', error)
        }
    }

    /**
     * Main poll function that polls based on current view
     */
    private _poll = async (): Promise<void> => {
        if (this._currentView === 'restore_request') {
            return
        }

        if (this._currentView === 'messages') {
            await this._pollMessages()
        } else {
            await this._pollTickets()
        }
    }

    /**
     * Handle view changes from the widget
     */
    private _handleViewChange = (view: WidgetView): void => {
        logger.info('View changed', { from: this._currentView, to: view })
        this._currentView = view
    }

    /**
     * Handle ticket selection from the list
     */
    private _handleSelectTicket = async (ticketId: string): Promise<void> => {
        // Switch to this ticket
        this._switchToTicketIfNeeded(ticketId)

        // Clear messages and reset timestamp
        this._lastMessageTimestamp = null
        this._widgetRef?.clearMessages()

        // Switch view to messages
        this._currentView = 'messages'
        this._widgetRef?.setView('messages')

        // Load messages for the selected ticket
        await this._loadMessages()

        // Mark as read if widget is open
        if (this._isWidgetOpen() && this._unreadCount > 0) {
            this._markMessagesAsRead()
        }
    }

    /**
     * Handle new conversation request
     */
    private _handleNewConversation = (): void => {
        logger.info('New conversation requested')

        // Clear current ticket
        this._currentTicketId = null
        this._persistence.clearTicketId()

        // Reset timestamp
        this._lastMessageTimestamp = null

        // Switch view to messages
        this._currentView = 'messages'
        this._widgetRef?.setView('messages')

        // Clear messages and add greeting
        this._widgetRef?.clearMessages(true)
    }

    /**
     * Handle back to tickets request
     */
    private _handleBackToTickets = async (): Promise<void> => {
        logger.info('Back to tickets requested')

        // Switch view to tickets
        this._currentView = 'tickets'
        this._widgetRef?.setView('tickets')

        // Load tickets
        this._widgetRef?.setTicketsLoading(true)
        await this._loadTickets()

        // Track back to tickets
        this._posthog.capture('$conversations_back_to_tickets')
    }

    /**
     * Determine initial view based on ticket count
     */
    private async _determineInitialView(): Promise<{ view: WidgetView; tickets: Ticket[] }> {
        try {
            const response = await this.getTickets()
            this._tickets = response.results
            this._hasMultipleTickets = response.results.length > 1

            // Calculate total unread
            const totalUnread = response.results.reduce((sum, t) => sum + (t.unread_count || 0), 0)
            this._unreadCount = totalUnread

            // If 2+ tickets, show ticket list; otherwise show messages
            if (response.results.length >= 2) {
                return { view: 'tickets', tickets: response.results }
            }

            // If exactly 1 ticket, set it as current
            if (response.results.length === 1) {
                this._currentTicketId = response.results[0].id
                this._persistence.saveTicketId(response.results[0].id)
            }

            return { view: 'messages', tickets: response.results }
        } catch (error) {
            logger.error('Failed to determine initial view', error)
            return { view: 'messages', tickets: [] }
        }
    }

    /**
     * Start polling based on current view
     */
    private _startPolling(): void {
        if (this._pollIntervalId) {
            return // Already polling
        }

        // Poll immediately
        this._poll()

        // Set up interval
        this._pollIntervalId = window?.setInterval(() => {
            this._poll()
        }, POLL_INTERVAL_MS) as unknown as number

        logger.info('Started polling', { view: this._currentView })
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
     * Setup listener for identify events.
     * When user calls posthog.identify(), hide the identification form
     * since we now know who they are.
     */
    private _setupIdentifyListener(): void {
        this._unsubscribeIdentifyListener = this._posthog.on('eventCaptured', (event: any) => {
            if (event.event === '$identify') {
                // User just identified - hide the identification form if it's showing
                this._widgetRef?.setUserIdentified()
            }
        })
    }

    /**
     * Show the widget (render it to DOM).
     * The widget respects its saved state (open/closed).
     * Note: Domain restrictions still apply - widget won't render on disallowed domains.
     */
    show(): void {
        // Check domain restrictions - don't render on disallowed domains
        if (!this._isDomainAllowed) {
            logger.warn('Cannot show widget: current domain is not allowed')
            return
        }

        // If widget isn't rendered yet, render it now
        if (!this._isWidgetRendered) {
            this._initializeWidget()
        }
    }

    /**
     * Hide and remove the widget from the DOM.
     * Conversation data is preserved - call show() to re-render.
     */
    hide(): void {
        // Stop polling when widget is hidden (save resources)
        this._stopPolling()

        if (this._containerElement) {
            render(null, this._containerElement)
            this._containerElement.remove()
            this._containerElement = null
        }
        this._widgetRef = null
        this._isWidgetRendered = false
        this._initializeWidgetPromise = null

        // Reset timestamp so show() will re-fetch all messages
        this._lastMessageTimestamp = null
    }

    /**
     * Check if the widget is currently visible (rendered in DOM)
     */
    isVisible(): boolean {
        return this._isWidgetRendered
    }

    /** Get tickets list for the current widget session */
    async getTickets(options?: GetTicketsOptions): Promise<GetTicketsResponse> {
        const token = this._config.token

        const queryParams: Record<string, string> = {
            widget_session_id: this._widgetSessionId,
            limit: String(options?.limit ?? 20),
            offset: String(options?.offset ?? 0),
        }

        if (options?.status) {
            queryParams.status = options.status
        }

        // eslint-disable-next-line compat/compat
        return new Promise((resolve, reject) => {
            this._posthog._send_request({
                url: this._posthog.requestRouter.endpointFor(
                    'api',
                    `/api/conversations/v1/widget/tickets?${formDataToQuery(queryParams)}`
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
                        const errorMsg = response.json?.detail || response.json?.message || 'Failed to fetch tickets'
                        logger.error('Failed to fetch tickets', { status: response.statusCode })
                        reject(new Error(errorMsg))
                        return
                    }

                    if (!response.json) {
                        reject(new Error('Invalid response from server'))
                        return
                    }

                    const data = response.json as GetTicketsResponse
                    resolve(data)
                },
            })
        })
    }

    async requestRestoreLink(email: string): Promise<RequestRestoreLinkResponse> {
        const normalizedEmail = email.trim().toLowerCase()
        if (!normalizedEmail) {
            throw new Error('Email is required')
        }

        const token = this._config.token
        const payload: RequestRestoreLinkPayload = {
            email: normalizedEmail,
            request_url: window?.location?.href || '',
        }

        // eslint-disable-next-line compat/compat
        return new Promise((resolve, reject) => {
            this._posthog._send_request({
                url: this._posthog.requestRouter.endpointFor('api', RESTORE_REQUEST_ENDPOINT),
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

                    if (response.statusCode !== 200) {
                        const errorMsg =
                            response.json?.error ||
                            response.json?.detail ||
                            response.json?.message ||
                            'Failed to request restore link'
                        reject(new Error(errorMsg))
                        return
                    }

                    resolve({ ok: true })
                },
            })
        })
    }

    async restoreFromToken(restoreToken: string): Promise<RestoreFromTokenResponse> {
        const normalizedToken = restoreToken.trim()
        if (!normalizedToken) {
            throw new Error('Restore token is required')
        }
        try {
            return await this._restoreFromTokenWithRetry(normalizedToken)
        } finally {
            clearRestoreTokenFromUrl()
        }
    }

    async restoreFromUrlToken(): Promise<RestoreFromTokenResponse | null> {
        const restoreToken = getRestoreTokenFromUrl()
        if (!restoreToken) {
            return null
        }

        try {
            return await this.restoreFromToken(restoreToken)
        } finally {
            clearRestoreTokenFromUrl()
        }
    }

    /**
     * Get the current active ticket ID
     * Returns null if no conversation has been started yet
     */
    getCurrentTicketId(): string | null {
        return this._currentTicketId
    }

    /**
     * Get the widget session ID (persistent browser identifier)
     * This ID is used for access control and stays the same across page loads
     */
    getWidgetSessionId(): string {
        return this._widgetSessionId
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

        if (_activeManager === this) {
            _activeManager = null
        }
        logger.info('Widget destroyed')
    }

    /**
     * Reset all conversation data and destroy the widget.
     * Called on posthog.reset() to start fresh.
     */
    reset(): void {
        // Clear all persisted conversation data
        this._persistence.clearAll()

        // Reset local state
        this._currentTicketId = null
        this._lastMessageTimestamp = null
        this._unreadCount = 0

        // Destroy the widget
        this.destroy()

        logger.info('Conversations reset')
    }

    /**
     * Render the widget to the DOM
     */
    private _renderWidget(
        initialState: ConversationsWidgetState,
        initialUserTraits: UserProvidedTraits | null,
        initialView: WidgetView = 'messages',
        initialTickets: Ticket[] = []
    ): void {
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
                isUserIdentified={this._posthog._isIdentified()}
                initialView={initialView}
                initialTickets={initialTickets}
                hasMultipleTickets={this._hasMultipleTickets}
                onSendMessage={this._handleSendMessage}
                onStateChange={this._handleStateChange}
                onIdentify={this._handleIdentify}
                onRequestRestoreLink={this._handleRequestRestoreLink}
                onSelectTicket={this._handleSelectTicket}
                onNewConversation={this._handleNewConversation}
                onBackToTickets={this._handleBackToTickets}
                onViewChange={this._handleViewChange}
            />,
            container
        )
    }
}

/**
 * Initialize the conversations widget.
 * This is the entry point called from the lazy-loaded bundle.
 *
 * Singleton guard: only one ConversationsManager per page. The toolbar's
 * internal PostHog instance is excluded upstream (see loadIfEnabled), so
 * this always belongs to the customer's main instance.
 */
export function initConversations(config: ConversationsRemoteConfig, posthog: PostHog): ConversationsManager {
    if (_activeManager) {
        return _activeManager
    }

    _activeManager = new ConversationsManager(config, posthog)
    return _activeManager
}
