import * as Preact from 'preact'
import { useState, useEffect, useRef, useCallback } from 'preact/hooks'

import { PostHog } from '../../../posthog-core'
import { ChatBubbleLeftRightHeroIconFilled } from './ChatBubbleLeftRightHeroIcon'
import { ChatBubbleXMarkHeroIcon } from './ChatBubbleXMarkHeroIcon'

import { SystemAvatar } from './PosthogAvatar'
import { BRAND_COLOR } from './style'

export type ChatMessageType = {
    id: string
    conversation: string // chat id (UUID)
    content: string
    created_at: string
    read: boolean
    is_assistant: boolean
}

function ChatHeader({ brandColor }: { brandColor: string }) {
    return (
        <div
            style={{
                backgroundColor: brandColor,
                color: 'white',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: 16,
            }}
        >
            <span style={{ fontSize: 11, fontWeight: 'bold' }}>Questions? Chat with us!</span>
        </div>
    )
}

function ChatMessage({ message, brandColor }: { message: ChatMessageType; brandColor: string }) {
    if (message.is_assistant) {
        return (
            <div style={{ width: 284, display: 'flex' }}>
                <SystemAvatar />
                <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 8, marginTop: 4 }}>
                    <span style={{ fontSize: 10, color: 'rgb(146, 169, 193)' }}>Assistant</span>
                    <span
                        style={{
                            fontSize: 12,
                            backgroundColor: brandColor,
                            color: 'white',
                            paddingLeft: 14,
                            paddingRight: 14,
                            paddingTop: 8,
                            paddingBottom: 9,
                            borderRadius: 10,
                            overflow: 'hidden',
                            textAlign: 'left',
                        }}
                    >
                        {message.content}
                    </span>
                    <span style={{ fontSize: 10, color: 'rgb(146, 169, 193)' }}>
                        {new Date(message.created_at).toLocaleTimeString()}
                    </span>
                </div>
            </div>
        )
    }

    return (
        <div style={{ width: '100%', display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{ width: 284 }}>
                <div
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        marginLeft: 8,
                        marginTop: 4,
                        alignItems: 'flex-end',
                    }}
                >
                    <span
                        style={{
                            fontSize: 12,
                            backgroundColor: 'rgb(240, 242, 245)',
                            color: 'rgb(28, 41, 59)',
                            paddingLeft: 14,
                            paddingRight: 14,
                            paddingTop: 8,
                            paddingBottom: 9,
                            borderRadius: 10,
                            overflow: 'hidden',
                            textAlign: 'right',
                        }}
                    >
                        {message.content}
                    </span>
                    <span style={{ fontSize: 10, color: 'rgb(146, 169, 193)' }}>
                        {new Date(message.created_at).toLocaleTimeString()}
                    </span>
                </div>
            </div>
        </div>
    )
}

function ChatMessages({ messages = [], brandColor }: { messages: ChatMessageType[]; brandColor: string }) {
    const messagesEndRef = useRef<HTMLDivElement>(null)

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollTo(0, messagesEndRef.current.scrollHeight)
    }

    useEffect(() => {
        scrollToBottom()
    }, [messages])

    return (
        <div ref={messagesEndRef} style={{ background: 'white', height: 366, padding: 8, overflowY: 'auto' }}>
            {messages.map((message) => (
                <ChatMessage message={message} key={message.id} brandColor={brandColor} />
            ))}
        </div>
    )
}

function ChatInput({ sendMessage, brandColor }: { sendMessage: (message: string) => void; brandColor: string }) {
    const [message, setMessage] = useState('')

    const handleSendMessage = () => {
        sendMessage(message)
        setMessage('')
    }

    return (
        <div style={{ display: 'flex', padding: 8, borderTop: `1px solid ${brandColor}` }}>
            <input
                type="text"
                placeholder="Type your message here..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                style={{
                    width: '100%',
                    height: 40,
                    borderRadius: 8,
                    border: 'none',
                    outline: 'none',
                    padding: '0 10px',
                    boxSizing: 'border-box',
                }}
            />
            <div
                style={{
                    cursor: 'pointer',
                    backgroundColor: brandColor,
                    color: 'white',
                    borderRadius: 10,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '5px 10px',
                    fontSize: 12,
                    fontWeight: 300,
                }}
                onClick={handleSendMessage}
            >
                Send
            </div>
        </div>
    )
}

function ChatContainer({
    isVisible,
    sendMessage,
    messages,
    brandColor,
}: {
    isVisible: boolean
    sendMessage: (message: string) => void
    messages: ChatMessageType[]
    brandColor: string
}) {
    return (
        <div
            style={{
                position: 'fixed',
                right: 14,
                bottom: 75,
                transition: 'width .15s ease-in-out !important',
                borderRadius: 12,
                backgroundColor: '#fff',
                boxShadow: '0 6px 6px 0 rgba(0,0,0,.02), 0 8px 24px 0 rgba(0,0,0,.12)',
                width: 360,
                visibility: isVisible ? 'visible' : 'hidden',
                overflow: 'hidden',
                zIndex: 9999,
            }}
        >
            <ChatHeader brandColor={brandColor} />
            <ChatMessages messages={messages} brandColor={brandColor} />
            <ChatInput sendMessage={sendMessage} brandColor={brandColor} />
        </div>
    )
}

export function ChatBubble({
    isOpen,
    setIsOpen,
    brandColor,
}: {
    isOpen: boolean
    setIsOpen: (isOpen: boolean) => void
    brandColor: string
}) {
    return (
        <div
            style={{
                position: 'fixed',
                right: 14,
                bottom: 14,
                borderRadius: 54,
                width: 54,
                height: 54,
                backgroundColor: brandColor,
                color: 'white',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                cursor: 'pointer',
            }}
            onClick={() => {
                setIsOpen(!isOpen)
            }}
        >
            <div style={{ position: 'relative', width: 24, height: 24 }}>
                <ChatBubbleLeftRightHeroIconFilled isVisible={!isOpen} />
                <ChatBubbleXMarkHeroIcon isVisible={isOpen} />
            </div>
        </div>
    )
}

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

    useEffect(() => {
        const intervalId = setInterval(() => {
            posthog.chat.getChat()
            const newChatMessages = (posthog.chat.messages || []) as ChatMessageType[]

            setMessages((prevMessages) => {
                // Helper to get a consistent, comparable representation of a message's key fields
                const simplifyMessage = (msg: ChatMessageType) => ({
                    id: msg.id,
                    content: msg.content,
                    read: msg.read,
                })

                if (newChatMessages.length !== prevMessages.length) {
                    return newChatMessages
                }

                // If lengths are the same, compare content of each message
                for (let i = 0; i < newChatMessages.length; i++) {
                    // Ensure both messages exist before trying to simplify, though length check should cover prevMessages[i]
                    if (!prevMessages[i] || !newChatMessages[i]) {
                        // Should not happen if lengths are equal and arrays are valid
                        return newChatMessages // Fallback to update
                    }
                    const oldMsgSimplified = JSON.stringify(simplifyMessage(prevMessages[i]))
                    const newMsgSimplified = JSON.stringify(simplifyMessage(newChatMessages[i]))

                    if (oldMsgSimplified !== newMsgSimplified) {
                        return newChatMessages
                    }
                }

                return prevMessages // No change detected, return the same array reference
            })
        }, 1000)

        // Clear the interval when the component unmounts
        return () => clearInterval(intervalId)
    }, [posthog]) // Only depends on posthog due to functional update for setMessages

    useEffect(() => {
        if (posthog.chat.conversationId !== conversationId) {
            setConversationId(posthog.chat.conversationId)
        }
    }, [posthog.chat.conversationId])

    return (
        <Preact.Fragment>
            <ChatBubble
                isOpen={isOpen}
                setIsOpen={setIsOpen}
                brandColor={posthog.chat.chat_config?.brand_color || BRAND_COLOR}
            />
            <ChatContainer
                isVisible={isOpen}
                sendMessage={sendMessage}
                messages={messages}
                brandColor={posthog.chat.chat_config?.brand_color || BRAND_COLOR}
            />
        </Preact.Fragment>
    )
}
