// oxlint-disable-next-line typescript/no-unused-vars
import { h, Fragment } from 'preact'
import { Message } from '../../../../posthog-conversations-types'
import { getStyles } from './styles'
import { SendMessageButton } from './SendMessageButton'
import { RichContent } from './RichContent'
import { NewConversationButton } from './NewConversationButton'
import { formatRelativeTime } from './utils'

interface MessagesViewProps {
    styles: ReturnType<typeof getStyles>
    placeholderText: string
    messages: Message[]
    inputValue: string
    isLoading: boolean
    error: string | null
    isResolved: boolean
    onInputChange: (e: Event) => void
    onKeyDown: (e: KeyboardEvent) => void
    onSendMessage: () => void
    onStartNewConversation: () => void
    messagesEndRef: (el: HTMLDivElement | null) => void
}

function MessageBubble({ message, styles }: { message: Message; styles: ReturnType<typeof getStyles> }) {
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
                    isGreeting={message.id === 'greeting'}
                    isCustomer={isCustomer}
                />
            </div>
            <div style={styles.messageTime}>{formatRelativeTime(message.created_at)}</div>
        </div>
    )
}

export function MessagesView({
    styles,
    placeholderText,
    messages,
    inputValue,
    isLoading,
    error,
    isResolved,
    onInputChange,
    onKeyDown,
    onSendMessage,
    onStartNewConversation,
    messagesEndRef,
}: MessagesViewProps) {
    return (
        <>
            <div style={styles.messages}>
                {messages.map((message) => (
                    <MessageBubble key={message.id} message={message} styles={styles} />
                ))}
                <div ref={messagesEndRef} />
            </div>

            {error && <div style={styles.error}>{error}</div>}

            {isResolved ? (
                <div style={styles.resolvedBanner}>
                    <div style={styles.resolvedBannerText}>This conversation was resolved.</div>
                    <NewConversationButton styles={styles} onClick={onStartNewConversation} />
                </div>
            ) : (
                <div style={styles.inputContainer}>
                    <textarea
                        style={styles.input}
                        placeholder={placeholderText}
                        value={inputValue}
                        onInput={onInputChange}
                        onKeyDown={onKeyDown}
                        rows={1}
                        disabled={isLoading}
                        autoFocus
                    />
                    <SendMessageButton
                        inputValue={inputValue}
                        isLoading={isLoading}
                        handleSendMessage={onSendMessage}
                    />
                </div>
            )}
        </>
    )
}
