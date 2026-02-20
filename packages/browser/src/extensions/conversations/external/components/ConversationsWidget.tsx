// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { h, Component } from 'preact'
import {
    ConversationsRemoteConfig,
    Message,
    ConversationsWidgetState,
    RequestRestoreLinkResponse,
    UserProvidedTraits,
    Ticket,
} from '../../../../posthog-conversations-types'
import { createLogger } from '../../../../utils/logger'
import { getStyles } from './styles'
import { OpenChatButton } from './OpenChatButton'
import { CloseChatButton } from './CloseChatButton'
import { TicketListView } from './TicketListView'
import { IdentificationFormView } from './IdentificationFormView'
import { RestoreRequestView } from './RestoreRequestView'
import { MessagesView } from './MessagesView'

const logger = createLogger('[ConversationsWidget]')

/**
 * Type for the current view in the widget
 */
export type WidgetView = 'tickets' | 'messages' | 'restore_request' | 'identification'

interface WidgetProps {
    config: ConversationsRemoteConfig
    initialState?: ConversationsWidgetState
    initialUserTraits?: UserProvidedTraits | null
    isUserIdentified?: boolean
    initialView?: WidgetView
    initialTickets?: Ticket[]
    hasMultipleTickets?: boolean
    onSendMessage: (message: string) => Promise<void>
    onStateChange?: (state: ConversationsWidgetState) => void
    onIdentify?: (traits: UserProvidedTraits) => void
    onRequestRestoreLink?: (email: string) => Promise<RequestRestoreLinkResponse>
    onSelectTicket?: (ticketId: string) => void
    onNewConversation?: () => void
    onBackToTickets?: () => void
    onViewChange?: (view: WidgetView) => void
}

interface WidgetState {
    state: ConversationsWidgetState
    view: WidgetView
    messages: Message[]
    tickets: Ticket[]
    ticketsLoading: boolean
    inputValue: string
    isLoading: boolean
    error: string | null
    formName: string
    formEmail: string
    formEmailError: string | null
    userTraits: UserProvidedTraits | null
    unreadCount: number
    hasMultipleTickets: boolean
    restoreEmail: string
    restoreEmailError: string | null
    restoreRequestLoading: boolean
    restoreRequestSuccess: boolean
}

export class ConversationsWidget extends Component<WidgetProps, WidgetState> {
    private _messagesEndRef: HTMLDivElement | null = null
    private _inputRef: HTMLTextAreaElement | null = null

    constructor(props: WidgetProps) {
        super(props)

        // Determine if we need to show the identification form
        const userTraits = props.initialUserTraits || null
        const needsIdentification = this._needsIdentification(props.config, userTraits, props.isUserIdentified)

        // If identification is needed, start with that view; otherwise use the provided initial view
        const initialView = needsIdentification ? 'identification' : props.initialView || 'messages'

        this.state = {
            state: props.initialState || 'closed',
            view: initialView,
            messages: [],
            tickets: props.initialTickets || [],
            ticketsLoading: false,
            inputValue: '',
            isLoading: false,
            error: null,
            formName: userTraits?.name || '',
            formEmail: userTraits?.email || '',
            formEmailError: null,
            userTraits,
            unreadCount: 0,
            hasMultipleTickets: props.hasMultipleTickets || false,
            restoreEmail: userTraits?.email || '',
            restoreEmailError: null,
            restoreRequestLoading: false,
            restoreRequestSuccess: false,
        }
    }

    /**
     * Check if we need to show the identification form
     */
    private _needsIdentification(
        config: ConversationsRemoteConfig,
        traits: UserProvidedTraits | null,
        isUserIdentified?: boolean
    ): boolean {
        // If user is already identified via PostHog, no form needed
        // They've called posthog.identify() so we have their identity
        if (isUserIdentified) {
            return false
        }

        // If requireEmail is not set, no identification needed
        if (!config.requireEmail) {
            return false
        }

        // If we already have an email, no form needed
        if (traits?.email) {
            return false
        }

        return true
    }

    componentDidMount() {
        // Add greeting message if no messages exist and we're in message view
        if (this.state.view === 'messages' && this.state.messages.length === 0 && this.props.config.greetingText) {
            this._addGreetingMessage()
        }
    }

    componentDidUpdate(_prevProps: WidgetProps, prevState: WidgetState) {
        // Scroll to bottom when messages change
        if (this.state.messages.length !== prevState.messages.length) {
            this._scrollToBottom()
        }

        // Notify parent of state changes
        if (this.state.state !== prevState.state && this.props.onStateChange) {
            this.props.onStateChange(this.state.state)
        }

        // Focus input and scroll to bottom when opening
        if (this.state.state === 'open' && prevState.state !== 'open') {
            this._focusInput()
            this._scrollToBottom()
        }
    }

    private _addGreetingMessage() {
        const greetingMessage: Message = {
            id: 'greeting',
            content: this.props.config.greetingText || 'Hi! How can we help?',
            author_type: 'AI',
            author_name: 'Support',
            created_at: new Date().toISOString(),
            is_private: false,
        }
        this.setState({ messages: [greetingMessage] })
    }

    private _scrollToBottom() {
        if (this._messagesEndRef) {
            this._messagesEndRef.scrollIntoView({ behavior: 'smooth' })
        }
    }

    private _focusInput() {
        if (this._inputRef) {
            this._inputRef.focus()
        }
    }

    private _handleToggleOpen = () => {
        this.setState((prevState) => ({
            state: prevState.state === 'open' ? 'closed' : 'open',
        }))
    }

    private _handleClose = () => {
        this.setState({ state: 'closed' })
    }

    private _handleSelectTicket = (ticketId: string) => {
        if (this.props.onSelectTicket) {
            this.props.onSelectTicket(ticketId)
        }
    }

    private _handleNewConversation = () => {
        if (this.props.onNewConversation) {
            this.props.onNewConversation()
        }
    }

    private _handleBackToTickets = () => {
        if (this.props.onBackToTickets) {
            this.props.onBackToTickets()
        }
    }

    private _handleOpenRestoreRequest = () => {
        this.setState((prevState) => ({
            view: 'restore_request',
            restoreEmail: prevState.restoreEmail || prevState.userTraits?.email || '',
            restoreEmailError: null,
            restoreRequestSuccess: false,
        }))
        if (this.props.onViewChange) {
            this.props.onViewChange('restore_request')
        }
    }

    private _handleCloseRestoreRequest = () => {
        const returnView = this.state.hasMultipleTickets ? 'tickets' : 'messages'
        this.setState({ view: returnView, restoreEmailError: null, restoreRequestSuccess: false })
        if (this.props.onViewChange) {
            this.props.onViewChange(returnView)
        }
    }

    private _handleInputChange = (e: Event) => {
        const target = e.target as HTMLTextAreaElement
        this.setState({ inputValue: target.value })
    }

    private _handleKeyPress = (e: KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            this._handleSendMessage()
        }
    }

    // Identification form handlers
    private _handleFormNameChange = (e: Event) => {
        const target = e.target as HTMLInputElement
        this.setState({ formName: target.value })
    }

    private _handleFormEmailChange = (e: Event) => {
        const target = e.target as HTMLInputElement
        this.setState({ formEmail: target.value, formEmailError: null })
    }

    private _handleRestoreEmailChange = (e: Event) => {
        const target = e.target as HTMLInputElement
        this.setState({
            restoreEmail: target.value,
            restoreEmailError: null,
            restoreRequestSuccess: false,
        })
    }

    private _validateEmail(email: string): boolean {
        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        return emailRegex.test(email)
    }

    private _handleFormSubmit = (e: Event) => {
        e.preventDefault()

        const { formEmail, formName } = this.state
        const { config, onIdentify } = this.props

        // Validate email if required
        if (config.requireEmail && !formEmail.trim()) {
            this.setState({ formEmailError: 'Email is required' })
            return
        }

        if (formEmail.trim() && !this._validateEmail(formEmail.trim())) {
            this.setState({ formEmailError: 'Please enter a valid email address' })
            return
        }

        // Create traits object
        const traits: UserProvidedTraits = {}
        if (formName.trim()) {
            traits.name = formName.trim()
        }
        if (formEmail.trim()) {
            traits.email = formEmail.trim()
        }

        // Navigate to appropriate view after identification
        const nextView = this.state.hasMultipleTickets ? 'tickets' : 'messages'

        // Update state and notify parent
        this.setState({
            userTraits: traits,
            view: nextView,
        })

        if (onIdentify) {
            onIdentify(traits)
        }

        if (this.props.onViewChange) {
            this.props.onViewChange(nextView)
        }
    }

    private _handleRestoreRequestSubmit = async (e: Event) => {
        e.preventDefault()

        if (!this.props.onRequestRestoreLink) {
            return
        }

        const email = this.state.restoreEmail.trim()
        if (!email) {
            this.setState({ restoreEmailError: 'Email is required' })
            return
        }

        if (!this._validateEmail(email)) {
            this.setState({ restoreEmailError: 'Please enter a valid email address' })
            return
        }

        this.setState({
            restoreRequestLoading: true,
            restoreEmailError: null,
        })

        try {
            await this.props.onRequestRestoreLink(email)
            this.setState({
                restoreRequestLoading: false,
                restoreRequestSuccess: true,
            })
        } catch (error) {
            logger.error('Failed to request restore link', error)
            this.setState({
                restoreRequestLoading: false,
                restoreEmailError: error instanceof Error ? error.message : 'Failed to request restore link',
            })
        }
    }

    private _handleSendMessage = async () => {
        const { inputValue } = this.state
        const trimmedMessage = inputValue.trim()

        if (!trimmedMessage) {
            return
        }

        // Add user message to UI immediately
        const userMessage: Message = {
            id: `temp-${Date.now()}`,
            content: trimmedMessage,
            author_type: 'customer',
            author_name: 'You',
            created_at: new Date().toISOString(),
            is_private: false,
        }

        this.setState({
            messages: [...this.state.messages, userMessage],
            inputValue: '',
            isLoading: true,
            error: null,
        })

        try {
            await this.props.onSendMessage(trimmedMessage)
            // Success - message will be updated via addMessage()
            this.setState({ isLoading: false })
        } catch (error) {
            logger.error('Failed to send message', error)
            this.setState((prevState) => ({
                isLoading: false,
                error: error instanceof Error ? error.message : 'Failed to send message',
                messages: prevState.messages.filter((m) => m.id !== userMessage.id),
            }))
        }
    }

    /**
     * Public method to add messages from outside
     */
    addMessages(messages: Message[]) {
        this.setState((prevState) => {
            // Filter out duplicates
            const existingIds = new Set(prevState.messages.map((m) => m.id))
            const newMessages = messages.filter((m) => !existingIds.has(m.id))

            if (newMessages.length > 0) {
                return {
                    messages: [...prevState.messages, ...newMessages],
                }
            }
            return null
        })
    }

    /**
     * Public method to show the widget
     */
    show() {
        this.setState({ state: 'open' })
    }

    /**
     * Public method to hide the widget
     */
    hide() {
        this.setState({ state: 'closed' })
    }

    /**
     * Get user traits (either provided via form or from props)
     */
    getUserTraits(): UserProvidedTraits | null {
        return this.state.userTraits
    }

    /**
     * Called when user identifies via posthog.identify()
     * Navigates away from identification form since we now know who they are
     */
    setUserIdentified(): void {
        if (this.state.view === 'identification') {
            const nextView = this.state.hasMultipleTickets ? 'tickets' : 'messages'
            this.setState({ view: nextView })
            if (this.props.onViewChange) {
                this.props.onViewChange(nextView)
            }
        }
    }

    /**
     * Set the unread message count (called by manager)
     */
    setUnreadCount(count: number): void {
        this.setState({ unreadCount: count })
    }

    /**
     * Update the tickets list (called by manager during polling)
     */
    updateTickets(tickets: Ticket[]): void {
        this.setState({
            tickets,
            ticketsLoading: false,
            hasMultipleTickets: tickets.length > 1,
        })
    }

    /**
     * Set the current view (tickets list or messages)
     */
    setView(view: WidgetView): void {
        this.setState({ view })
        if (this.props.onViewChange) {
            this.props.onViewChange(view)
        }
    }

    /**
     * Get the current view
     */
    getView(): WidgetView {
        return this.state.view
    }

    /**
     * Set tickets loading state
     */
    setTicketsLoading(loading: boolean): void {
        this.setState({ ticketsLoading: loading })
    }

    /**
     * Clear messages (used when switching tickets or starting new conversation)
     * @param addGreeting - If true, adds the greeting message after clearing
     */
    clearMessages(addGreeting: boolean = false): void {
        this.setState({ messages: [] }, () => {
            if (addGreeting && this.props.config.greetingText) {
                this._addGreetingMessage()
            }
        })
    }

    private _renderIdentificationForm(styles: ReturnType<typeof getStyles>) {
        return (
            <IdentificationFormView
                config={this.props.config}
                styles={styles}
                formName={this.state.formName}
                formEmail={this.state.formEmail}
                formEmailError={this.state.formEmailError}
                onNameChange={this._handleFormNameChange}
                onEmailChange={this._handleFormEmailChange}
                onSubmit={this._handleFormSubmit}
            />
        )
    }

    private _renderBackButton(styles: ReturnType<typeof getStyles>) {
        const onClick =
            this.state.view === 'restore_request' ? this._handleCloseRestoreRequest : this._handleBackToTickets
        return (
            <button style={styles.backButton} onClick={onClick} aria-label="Back to conversations">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="15 18 9 12 15 6" />
                </svg>
            </button>
        )
    }

    private _renderTicketList(styles: ReturnType<typeof getStyles>) {
        const { tickets, ticketsLoading } = this.state

        return (
            <TicketListView
                tickets={tickets}
                isLoading={ticketsLoading}
                styles={styles}
                onSelectTicket={this._handleSelectTicket}
                onNewConversation={this._handleNewConversation}
                onOpenRestoreRequest={this._handleOpenRestoreRequest}
            />
        )
    }

    private _renderMessages(styles: ReturnType<typeof getStyles>, primaryColor: string, placeholderText: string) {
        return (
            <MessagesView
                styles={styles}
                primaryColor={primaryColor}
                placeholderText={placeholderText}
                messages={this.state.messages}
                inputValue={this.state.inputValue}
                isLoading={this.state.isLoading}
                error={this.state.error}
                onInputChange={this._handleInputChange}
                onKeyDown={this._handleKeyPress}
                onSendMessage={this._handleSendMessage}
                messagesEndRef={(el) => {
                    this._messagesEndRef = el
                }}
                inputRef={(el) => {
                    this._inputRef = el
                }}
            />
        )
    }

    private _renderRestoreRequestView(styles: ReturnType<typeof getStyles>) {
        return (
            <RestoreRequestView
                styles={styles}
                restoreEmail={this.state.restoreEmail}
                restoreEmailError={this.state.restoreEmailError}
                restoreRequestLoading={this.state.restoreRequestLoading}
                restoreRequestSuccess={this.state.restoreRequestSuccess}
                onEmailChange={this._handleRestoreEmailChange}
                onSubmit={this._handleRestoreRequestSubmit}
            />
        )
    }

    /**
     * Get the title for the current view
     */
    private _getTitle(view: WidgetView): string {
        switch (view) {
            case 'tickets':
                return 'Conversations'
            case 'restore_request':
                return 'Restore conversations'
            case 'identification':
                return 'Support Chat'
            case 'messages':
                return 'Support Chat'
        }
    }

    /**
     * Render the content for the current view
     */
    private _renderViewContent(
        styles: ReturnType<typeof getStyles>,
        primaryColor: string,
        placeholderText: string
    ): h.JSX.Element {
        switch (this.state.view) {
            case 'identification':
                return this._renderIdentificationForm(styles)
            case 'restore_request':
                return this._renderRestoreRequestView(styles)
            case 'tickets':
                return this._renderTicketList(styles)
            case 'messages':
                return this._renderMessages(styles, primaryColor, placeholderText)
        }
    }

    render() {
        const { config } = this.props
        const { state, view } = this.state
        const primaryColor = config.color || '#5375ff'
        const widgetPosition = config.widgetPosition || 'bottom_right'
        const placeholderText = config.placeholderText || 'Type your message...'
        const styles = getStyles(primaryColor, widgetPosition)

        // Button only (closed state)
        if (state === 'closed') {
            return (
                <OpenChatButton
                    primaryColor={primaryColor}
                    position={widgetPosition}
                    handleToggleOpen={this._handleToggleOpen}
                    unreadCount={this.state.unreadCount}
                />
            )
        }

        // Open state
        const windowStyle = {
            ...styles.window,
            ...styles.windowOpen,
        }

        // Show back button in message view when there are multiple tickets or in restore request view
        const showBackButton = (view === 'messages' && this.state.hasMultipleTickets) || view === 'restore_request'

        // Show recover footer only in tickets and messages views
        const showRecoverFooter = view === 'tickets' || view === 'messages'

        return (
            <div style={styles.widget}>
                <div style={windowStyle}>
                    <div style={styles.header}>
                        <div style={showBackButton ? styles.headerWithBack : styles.headerTitle}>
                            {showBackButton && this._renderBackButton(styles)}
                            <span style={styles.headerTitle}>{this._getTitle(view)}</span>
                        </div>
                        <div style={styles.headerActions}>
                            <CloseChatButton primaryColor={primaryColor} handleClose={this._handleClose} />
                        </div>
                    </div>

                    {this._renderViewContent(styles, primaryColor, placeholderText)}

                    {showRecoverFooter && (
                        <div style={styles.recoverFooter}>
                            Don't see your previous tickets?{' '}
                            <button
                                type="button"
                                style={styles.recoverFooterLink}
                                onClick={this._handleOpenRestoreRequest}
                            >
                                Recover them here
                            </button>
                        </div>
                    )}
                </div>
            </div>
        )
    }
}
