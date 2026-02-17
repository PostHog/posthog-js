// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { h, Component, Fragment } from 'preact'
import {
    ConversationsRemoteConfig,
    Message,
    ConversationsWidgetState,
    UserProvidedTraits,
    Ticket,
} from '../../../../posthog-conversations-types'
import { createLogger } from '../../../../utils/logger'
import { getStyles } from './styles'
import { OpenChatButton } from './OpenChatButton'
import { SendMessageButton } from './SendMessageButton'
import { CloseChatButton } from './CloseChatButton'
import { RichContent } from './RichContent'
import { TicketListView } from './TicketListView'
import { formatRelativeTime } from './utils'

const logger = createLogger('[ConversationsWidget]')

/**
 * Type for the current view in the widget
 */
export type WidgetView = 'tickets' | 'messages'

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
    showIdentificationForm: boolean
    formName: string
    formEmail: string
    formEmailError: string | null
    userTraits: UserProvidedTraits | null
    unreadCount: number
    hasMultipleTickets: boolean
}

export class ConversationsWidget extends Component<WidgetProps, WidgetState> {
    private _messagesEndRef: HTMLDivElement | null = null
    private _inputRef: HTMLTextAreaElement | null = null

    constructor(props: WidgetProps) {
        super(props)

        // Determine if we need to show the identification form
        const userTraits = props.initialUserTraits || null
        const needsIdentification = this._needsIdentification(props.config, userTraits, props.isUserIdentified)

        this.state = {
            state: props.initialState || 'closed',
            view: props.initialView || 'messages',
            messages: [],
            tickets: props.initialTickets || [],
            ticketsLoading: false,
            inputValue: '',
            isLoading: false,
            error: null,
            showIdentificationForm: needsIdentification,
            formName: userTraits?.name || '',
            formEmail: userTraits?.email || '',
            formEmailError: null,
            userTraits,
            unreadCount: 0,
            hasMultipleTickets: props.hasMultipleTickets || false,
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

        // Update state and notify parent
        this.setState({
            userTraits: traits,
            showIdentificationForm: false,
        })

        if (onIdentify) {
            onIdentify(traits)
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
            this.setState({
                isLoading: false,
                error: error instanceof Error ? error.message : 'Failed to send message',
            })

            // Remove the temporary message on error
            this.setState((prevState) => ({
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
     * Public method to close the widget completely
     */
    close() {
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
     * Hides the identification form since we now know who they are
     */
    setUserIdentified(): void {
        if (this.state.showIdentificationForm) {
            this.setState({ showIdentificationForm: false })
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
        const { config } = this.props
        const { formName, formEmail, formEmailError } = this.state

        const title = config.identificationFormTitle || 'Before we start...'
        const description =
            config.identificationFormDescription || 'Please provide your details so we can help you better.'
        const showNameField = config.collectName !== false // Show by default unless explicitly disabled

        return (
            <div style={styles.identificationForm}>
                <div style={styles.formTitle}>{title}</div>
                <div style={styles.formDescription}>{description}</div>

                <form onSubmit={this._handleFormSubmit}>
                    {showNameField && (
                        <div style={styles.formField}>
                            <label style={styles.formLabel}>
                                Name <span style={styles.formOptional}>(optional)</span>
                            </label>
                            <input
                                type="text"
                                style={styles.formInput}
                                value={formName}
                                onInput={this._handleFormNameChange}
                                placeholder="Your name"
                                autoComplete="name"
                            />
                        </div>
                    )}

                    <div style={styles.formField}>
                        <label style={styles.formLabel}>
                            Email {!config.requireEmail && <span style={styles.formOptional}>(optional)</span>}
                        </label>
                        <input
                            type="email"
                            style={{
                                ...styles.formInput,
                                ...(formEmailError ? styles.formInputError : {}),
                            }}
                            value={formEmail}
                            onInput={this._handleFormEmailChange}
                            placeholder="you@example.com"
                            autoComplete="email"
                        />
                        {formEmailError && <div style={styles.formError}>{formEmailError}</div>}
                    </div>

                    <button
                        type="submit"
                        style={styles.formSubmitButton}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.opacity = '0.9'
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.opacity = '1'
                        }}
                    >
                        Start Chat
                    </button>
                </form>
            </div>
        )
    }

    private _renderMessage(message: Message, styles: ReturnType<typeof getStyles>, primaryColor: string) {
        const isCustomer = message.author_type === 'customer'
        const messageStyle = {
            ...styles.message,
            ...(isCustomer ? styles.messageCustomer : styles.messageAgent),
        }
        const contentStyle = {
            ...styles.messageContent,
            ...(isCustomer ? styles.messageContentCustomer : styles.messageContentAgent),
        }

        return (
            <div key={message.id} style={messageStyle}>
                {!isCustomer && message.author_name && <div style={styles.messageAuthor}>{message.author_name}</div>}
                <div style={contentStyle}>
                    <RichContent
                        richContent={message.rich_content}
                        content={message.content}
                        isCustomer={isCustomer}
                        primaryColor={primaryColor}
                    />
                </div>
                <div style={styles.messageTime}>{formatRelativeTime(message.created_at)}</div>
            </div>
        )
    }

    private _renderBackButton(styles: ReturnType<typeof getStyles>) {
        return (
            <button style={styles.backButton} onClick={this._handleBackToTickets} aria-label="Back to conversations">
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
            />
        )
    }

    private _renderMessages(styles: ReturnType<typeof getStyles>, primaryColor: string, placeholderText: string) {
        const { messages, inputValue, isLoading, error } = this.state

        return (
            <>
                <div style={styles.messages}>
                    {messages.map((message) => this._renderMessage(message, styles, primaryColor))}
                    <div
                        ref={(el) => {
                            this._messagesEndRef = el
                        }}
                    />
                </div>

                {/* Error message */}
                {error && <div style={styles.error}>{error}</div>}

                {/* Input */}
                <div style={styles.inputContainer}>
                    <textarea
                        ref={(el) => {
                            this._inputRef = el
                        }}
                        style={styles.input}
                        placeholder={placeholderText}
                        value={inputValue}
                        onInput={this._handleInputChange}
                        onKeyPress={this._handleKeyPress}
                        rows={1}
                        disabled={isLoading}
                    />
                    <SendMessageButton
                        primaryColor={primaryColor}
                        inputValue={inputValue}
                        isLoading={isLoading}
                        handleSendMessage={this._handleSendMessage}
                    />
                </div>
            </>
        )
    }

    render() {
        const { config } = this.props
        const { state, view, showIdentificationForm } = this.state
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

        // Determine header title based on view
        const headerTitle = view === 'tickets' ? 'Conversations' : 'Support Chat'

        // Show back button in message view when there are multiple tickets
        const showBackButton = view === 'messages' && this.state.hasMultipleTickets

        return (
            <div style={styles.widget}>
                <div style={windowStyle}>
                    {/* Header */}
                    <div style={styles.header}>
                        <div style={showBackButton ? styles.headerWithBack : styles.headerTitle}>
                            {showBackButton && this._renderBackButton(styles)}
                            <span style={styles.headerTitle}>{headerTitle}</span>
                        </div>
                        <div style={styles.headerActions}>
                            <CloseChatButton primaryColor={primaryColor} handleClose={this._handleClose} />
                        </div>
                    </div>

                    {/* Show identification form if needed */}
                    {showIdentificationForm
                        ? this._renderIdentificationForm(styles)
                        : view === 'tickets'
                          ? // Ticket list view
                            this._renderTicketList(styles)
                          : // Messages view
                            this._renderMessages(styles, primaryColor, placeholderText)}
                </div>
            </div>
        )
    }
}
