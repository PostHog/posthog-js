import { ChatMessage } from './ChatMessage'

export type ChatMessageType = {
    id: string
    conversation: string // chat id (UUID)
    content: string
    created_at: string
    read: boolean
    is_assistant: boolean
}

export function ChatMessages() {
    const messages: ChatMessageType[] = [
        {
            content: 'How can we help with BizPlanner AI?',
            is_assistant: true,
            created_at: '2023-10-01T12:00:00Z',
            id: '1',
            conversation: '1',
            read: true,
        },
        {
            content: 'Can I get a refund for my subscription?',
            is_assistant: false,
            created_at: '2023-10-01T12:01:00Z',
            id: '2',
            conversation: '1',
            read: true,
        },
    ]
    return (
        <div style={{ background: 'white', width: '100%', height: 366, padding: 8 }}>
            {messages.map((message) => (
                <ChatMessage message={message} key={message.id} />
            ))}
        </div>
    )
}
