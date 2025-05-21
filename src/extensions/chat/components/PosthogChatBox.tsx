import * as Preact from 'preact'
import { useState, useEffect } from 'preact/hooks'

import { ChatBubble } from './ChatBubble'
import { ChatContainer } from './ChatContainer'
import { PostHog } from '../../../posthog-core'

export function PosthogChatBox({ posthog }: { posthog: PostHog }) {
    const [isOpen, setIsOpen] = useState(false)
    const [messages, setMessages] = useState<any[]>([])
    const [conversationId, setConversationId] = useState<string | null>(null)

    const sendMessage = (message: string) => {
        if (conversationId) {
            posthog.chat.sendMessage(conversationId, message)
            getMessages()
        }
    }

    const getMessages = () => {
        posthog.chat.getChat()
        //setMessages(data.messages)
    }

    useEffect(() => {
        if (posthog.chat.messages.length > 0) {
            setMessages(posthog.chat.messages)
        }
    }, [posthog.chat.messages.length])

    useEffect(() => {
        if (posthog.chat.conversationId) {
            setConversationId(posthog.chat.conversationId)
        }
    }, [posthog.chat.conversationId])

    return (
        <Preact.Fragment>
            <ChatBubble isOpen={isOpen} setIsOpen={setIsOpen} />
            <ChatContainer isVisible={isOpen} sendMessage={sendMessage} messages={messages} />
        </Preact.Fragment>
    )
}
