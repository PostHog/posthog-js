import { ChatMessage } from './ChatMessage'

export type ChatMessageType = {
    id: string
    conversation: string // chat id (UUID)
    content: string
    created_at: string
    read: boolean
    is_assistant: boolean
}

export function ChatMessages({ messages = [] }: { messages: ChatMessageType[] }) {
    return (
        <div style={{ background: 'white', height: 366, padding: 8, overflowY: 'auto' }}>
            {messages.map((message) => (
                <ChatMessage message={message} key={message.id} />
            ))}
        </div>
    )
}
