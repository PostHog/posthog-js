// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { h, Component, Fragment } from 'preact'
import {
    ConversationsRemoteConfig,
    Message,
    ConversationsWidgetState,
    UserProvidedTraits,
} from '../../../../posthog-conversations-types'
import { createLogger } from '../../../../utils/logger'
import { getStyles } from './styles'
import { OpenChatButton } from './OpenChatButton'
import { SendMessageButton } from './SendMessageButton'
import { CloseChatButton } from './CloseChatButton'

const logger = createLogger('[ConversationsWidget]')

interface WidgetProps {
    config: ConversationsRemoteConfig
    initialState?: ConversationsWidgetState
    initialUserTraits?: UserProvidedTraits | null
    onSendMessage: (message: string) => Promise<void>
    onStateChange?: (state: ConversationsWidgetState) => void
    onIdentify?: (traits: UserProvidedTraits) => void
}

interface WidgetState {
    state: ConversationsWidgetState
    messages: Message[]
    inputValue: string
    isLoading: boolean
    error: string | null
    showIdentificationForm: boolean
    formName: string
    formEmail: string
    formEmailError: string | null
    userTraits: UserProvidedTraits | null
    unreadCount: number
}

export class ConversationsWidget extends Component<WidgetProps, WidgetState> {
    private _messagesEndRef: HTMLDivElement | null = null
    private _inputRef: HTMLTextAreaElement | null = null

    constructor(props: WidgetProps) {
        super(props)

        // Determine if we need to show the identification form
        const userTraits = props.initialUserTraits || null
        const needsIdentification = this._needsIdentification(props.config, userTraits)

        this.state = {
            state: props.initialState || ConversationsWidgetState.CLOSED,
            messages: [],
            inputValue: '',
            isLoading: false,
            error: null,
            showIdentificationForm: needsIdentification,
            formName: userTraits?.name || '',
            formEmail: userTraits?.email || '',
            formEmailError: null,
            userTraits,
            unreadCount: 0,
        }
    }

    /**
     * Check if we need to show the identification form
     */
    private _needsIdentification(config: ConversationsRemoteConfig, traits: UserProvidedTraits | null): boolean {
        // If requireEmail is not set, no identification needed
        if (!config.requireEmail) {
            //return false
        }

        // If we already have an email, no form needed
        if (traits?.email) {
            return false
        }

        return true
    }

    componentDidMount() {
        // Add greeting message if no messages exist
        if (this.state.messages.length === 0 && this.props.config.greetingText) {
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
        if (this.state.state === ConversationsWidgetState.OPEN && prevState.state !== ConversationsWidgetState.OPEN) {
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
            state:
                prevState.state === ConversationsWidgetState.OPEN
                    ? ConversationsWidgetState.CLOSED
                    : ConversationsWidgetState.OPEN,
        }))
    }

    private _handleClose = () => {
        this.setState({ state: ConversationsWidgetState.CLOSED })
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

    private _formatTime(isoString: string): string {
        const date = new Date(isoString)
        const now = new Date()
        const diffMs = now.getTime() - date.getTime()
        const diffMins = Math.floor(diffMs / 60000)

        if (diffMins < 1) {
            return 'Just now'
        } else if (diffMins < 60) {
            return `${diffMins}m ago`
        } else if (diffMins < 1440) {
            return `${Math.floor(diffMins / 60)}h ago`
        } else {
            return date.toLocaleDateString()
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
        this.setState({ state: ConversationsWidgetState.OPEN })
    }

    /**
     * Public method to hide the widget
     */
    hide() {
        this.setState({ state: ConversationsWidgetState.CLOSED })
    }

    /**
     * Public method to close the widget completely
     */
    close() {
        this.setState({ state: ConversationsWidgetState.CLOSED })
    }

    /**
     * Get user traits (either provided via form or from props)
     */
    getUserTraits(): UserProvidedTraits | null {
        return this.state.userTraits
    }

    /**
     * Set the unread message count (called by manager)
     */
    setUnreadCount(count: number): void {
        this.setState({ unreadCount: count })
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

    private _renderMessage(message: Message, styles: ReturnType<typeof getStyles>) {
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
                <div style={contentStyle}>{message.content}</div>
                <div style={styles.messageTime}>{this._formatTime(message.created_at)}</div>
            </div>
        )
    }

    render() {
        const { config } = this.props
        const { state, messages, inputValue, isLoading, error, showIdentificationForm } = this.state
        const primaryColor = config.color || '#5375ff'
        const placeholderText = config.placeholderText || 'Type your message...'
        const styles = getStyles(primaryColor)

        // Button only (closed state)
        if (state === ConversationsWidgetState.CLOSED) {
            return (
                <OpenChatButton
                    primaryColor={primaryColor}
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

        return (
            <div style={styles.widget}>
                <div style={windowStyle}>
                    {/* Header */}
                    <div style={styles.header}>
                        <div style={styles.headerTitle}>
                            <span>Support Chat</span>
                        </div>
                        <div style={styles.headerActions}>
                            <CloseChatButton primaryColor={primaryColor} handleClose={this._handleClose} />
                        </div>
                    </div>

                    {/* Show identification form if needed, otherwise show chat */}
                    {showIdentificationForm ? (
                        this._renderIdentificationForm(styles)
                    ) : (
                        <>
                            <div style={styles.messages}>
                                {messages.map((message) => this._renderMessage(message, styles))}
                                {isLoading && (
                                    <div style={{ ...styles.message, ...styles.messageAgent }}>
                                        <div
                                            style={{
                                                ...styles.messageContent,
                                                ...styles.messageContentAgent,
                                                ...styles.typing,
                                            }}
                                        >
                                            <span style={styles.typingDot}></span>
                                            <span style={{ ...styles.typingDot, animationDelay: '0.2s' }}></span>
                                            <span style={{ ...styles.typingDot, animationDelay: '0.4s' }}></span>
                                        </div>
                                    </div>
                                )}
                                <div ref={(el) => (this._messagesEndRef = el)} />
                            </div>

                            {/* Error message */}
                            {error && <div style={styles.error}>{error}</div>}

                            {/* Input */}
                            <div style={styles.inputContainer}>
                                <textarea
                                    ref={(el) => (this._inputRef = el)}
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
                    )}
                </div>
            </div>
        )
    }
}
