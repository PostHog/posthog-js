// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { h, Fragment } from 'preact'
import { Message } from '../../../../posthog-conversations-types'
import { getStyles } from './styles'
import { SendMessageButton } from './SendMessageButton'
import { RichContent } from './RichContent'
import { formatRelativeTime } from './utils'

interface MessagesViewProps {
    styles: ReturnType<typeof getStyles>
    primaryColor: string
    placeholderText: string
    messages: Message[]
    inputValue: string
    isLoading: boolean
    error: string | null
    onInputChange: (e: Event) => void
    onKeyDown: (e: KeyboardEvent) => void
    onSendMessage: () => void
    messagesEndRef: (el: HTMLDivElement | null) => void
    inputRef: (el: HTMLTextAreaElement | null) => void
}

function MessageBubble({
    message,
    styles,
    primaryColor,
}: {
    message: Message
    styles: ReturnType<typeof getStyles>
    primaryColor: string
}) {
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

export function MessagesView({
    styles,
    primaryColor,
    placeholderText,
    messages,
    inputValue,
    isLoading,
    error,
    onInputChange,
    onKeyDown,
    onSendMessage,
    messagesEndRef,
    inputRef,
}: MessagesViewProps) {
    return (
        <>
            <div style={styles.messages}>
                {messages.map((message) => (
                    <MessageBubble key={message.id} message={message} styles={styles} primaryColor={primaryColor} />
                ))}
                <div ref={messagesEndRef} />
            </div>

            {error && <div style={styles.error}>{error}</div>}

            <div style={styles.inputContainer}>
                <textarea
                    ref={inputRef}
                    style={styles.input}
                    placeholder={placeholderText}
                    value={inputValue}
                    onInput={onInputChange}
                    onKeyDown={onKeyDown}
                    rows={1}
                    disabled={isLoading}
                />
                <SendMessageButton
                    primaryColor={primaryColor}
                    inputValue={inputValue}
                    isLoading={isLoading}
                    handleSendMessage={onSendMessage}
                />
            </div>
        </>
    )
}
