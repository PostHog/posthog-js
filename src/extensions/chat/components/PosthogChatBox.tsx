import * as Preact from 'preact'
import { useState, useEffect, useRef, useCallback, useContext } from 'preact/hooks'
import { createContext } from 'preact'

import { PostHog } from '../../../posthog-core'
import { ChatBubbleLeftRightHeroIconFilled } from './ChatBubbleLeftRightHeroIcon'
import { ChatBubbleXMarkHeroIcon } from './ChatBubbleXMarkHeroIcon'

import { SystemAvatar } from './PosthogAvatar'
import { BRAND_COLOR, styles } from './style'

const BrandColorContext = createContext<string>(BRAND_COLOR)

export type ChatMessageType = {
    id: string
    conversation: string // chat id (UUID)
    content: string
    created_at: string
    read: boolean
    is_assistant: boolean
}

/**
 * Renders the header of the chat box.
 * @param brandColor The primary color used for branding elements in the chat header.
 */
function ChatHeader() {
    const brandColor = useContext(BrandColorContext)
    return (
        <div style={styles.chatHeader(brandColor)}>
            <span style={styles.chatHeaderTitle}>Questions? Chat with us!</span>
        </div>
    )
}

/**
 * Renders a single chat message, distinguishing between assistant and user messages.
 * @param message The chat message object to render.
 * @param brandColor The primary color used for branding assistant messages.
 */
function ChatMessage({ message }: { message: ChatMessageType }) {
    const brandColor = useContext(BrandColorContext)
    if (message.is_assistant) {
        return (
            <div style={styles.assistantMessageContainer}>
                <SystemAvatar />
                <div style={styles.messageContentContainer}>
                    <span style={styles.assistantName}>Assistant</span>
                    <span style={styles.assistantMessageText(brandColor)}>{message.content}</span>
                    <span style={styles.messageTimestamp}>{new Date(message.created_at).toLocaleTimeString()}</span>
                </div>
            </div>
        )
    }

    return (
        <div style={styles.userMessageContainerOuter}>
            <div style={styles.userMessageContainerInner}>
                <div style={styles.userMessageContentContainer}>
                    <span style={styles.userMessageText}>{message.content}</span>
                    <span style={styles.messageTimestamp}>{new Date(message.created_at).toLocaleTimeString()}</span>
                </div>
            </div>
        </div>
    )
}

/**
 * Renders a list of chat messages and handles auto-scrolling to the bottom.
 * @param messages An array of chat message objects to display.
 * @param brandColor The primary color used for branding elements within messages.
 */
function ChatMessages({ messages = [] }: { messages: ChatMessageType[] }) {
    const messagesEndRef = useRef<HTMLDivElement>(null)

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollTo(0, messagesEndRef.current.scrollHeight)
    }

    useEffect(() => {
        scrollToBottom()
    }, [messages])

    return (
        <div ref={messagesEndRef} style={styles.chatMessagesContainer}>
            {messages.map((message) => (
                <ChatMessage message={message} key={message.id} />
            ))}
        </div>
    )
}

/**
 * Renders the input field for typing messages and a send button.
 * @param sendMessage Callback function to send a message.
 * @param brandColor The primary color used for branding the send button.
 */
function ChatInput({ sendMessage, isSending }: { sendMessage: (message: string) => void; isSending: boolean }) {
    const brandColor = useContext(BrandColorContext)
    const [message, setMessage] = useState('')

    const handleSendMessage = () => {
        if (message.trim() === '') {
            return
        }
        sendMessage(message)
        setMessage('')
    }

    return (
        <div style={styles.chatInputContainer(brandColor)}>
            <input
                type="text"
                placeholder="Type your message here..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                style={styles.chatInput}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        handleSendMessage()
                    }
                }}
            />
            <div style={styles.sendButton(brandColor, isSending)} onClick={handleSendMessage}>
                {isSending ? 'Sending...' : 'Send'}
            </div>
        </div>
    )
}

/**
 * Renders the main chat container, including header, messages, and input.
 * @param isVisible Controls the visibility of the chat container.
 * @param sendMessage Callback function to send a message, passed to the ChatInput.
 * @param messages An array of chat message objects, passed to ChatMessages.
 * @param brandColor The primary color used for branding elements within the container.
 */
function ChatContainer({
    isVisible,
    sendMessage,
    messages,
    isSending,
}: {
    isVisible: boolean
    sendMessage: (message: string) => void
    messages: ChatMessageType[]
    isSending: boolean
}) {
    return (
        <div style={styles.chatContainer(isVisible)}>
            <ChatHeader />
            <ChatMessages messages={messages} />
            <ChatInput sendMessage={sendMessage} isSending={isSending} />
        </div>
    )
}

/**
 * Renders the chat bubble that toggles the chat container visibility.
 * @param isOpen Indicates whether the chat container is currently open.
 * @param setIsOpen Callback function to toggle the open state of the chat container.
 * @param brandColor The primary color used for the chat bubble.
 */
export function ChatBubble({ isOpen, setIsOpen }: { isOpen: boolean; setIsOpen: (isOpen: boolean) => void }) {
    const brandColor = useContext(BrandColorContext)
    return (
        <div
            style={styles.chatBubble(brandColor)}
            onClick={() => {
                setIsOpen(!isOpen)
            }}
        >
            <div style={styles.chatBubbleIconContainer}>
                <ChatBubbleLeftRightHeroIconFilled isVisible={!isOpen} />
                <ChatBubbleXMarkHeroIcon isVisible={isOpen} />
            </div>
        </div>
    )
}

/**
 * Main component for the PostHog chat box, managing state and interactions.
 * @param posthog The PostHog instance used for chat interactions.
 */
export function PosthogChatBox({ posthog }: { posthog: PostHog }) {
    const [isOpen, setIsOpen] = useState(false)
    const [messages, setMessages] = useState<ChatMessageType[]>([])
    const [conversationId, setConversationId] = useState<string | null>(null)

    const sendMessage = useCallback(
        (message: string) => {
            posthog.chat.sendMessage(conversationId ?? '', message)
        },
        [conversationId, posthog]
    )

    const loadMessages = () => {
        posthog.chat.getChat()
        const newChatMessages = (posthog.chat.messages || []) as ChatMessageType[]
        setMessages((prevMessages) => {
            if (newChatMessages.length !== prevMessages.length) {
                return newChatMessages
            }

            // If lengths are the same, compare content of each message
            for (let i = 0; i < newChatMessages.length; i++) {
                const prevMsg = prevMessages[i]
                const newMsg = newChatMessages[i]

                // Check if critical fields have changed
                if (prevMsg.id !== newMsg.id || prevMsg.content !== newMsg.content || prevMsg.read !== newMsg.read) {
                    return newChatMessages
                }
            }

            return prevMessages // No change detected, return the same array reference
        })
    }

    useEffect(() => {
        const intervalId = setInterval(() => {
            loadMessages()
        }, 1000)

        // Clear the interval when the component unmounts
        return () => clearInterval(intervalId)
    }, [posthog]) // Only depends on posthog due to functional update for setMessages

    useEffect(() => {
        if (posthog.chat.conversationId !== conversationId) {
            setConversationId(posthog.chat.conversationId)
        }
    }, [posthog.chat.conversationId])

    const currentBrandColor = posthog.chat.chat_config?.brand_color || BRAND_COLOR

    return (
        <BrandColorContext.Provider value={currentBrandColor}>
            <Preact.Fragment>
                <ChatBubble isOpen={isOpen} setIsOpen={setIsOpen} />
                <ChatContainer
                    isVisible={isOpen}
                    sendMessage={sendMessage}
                    messages={messages}
                    isSending={posthog.chat.isMessageSending}
                />
            </Preact.Fragment>
        </BrandColorContext.Provider>
    )
}
