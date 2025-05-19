import { ChatHeader } from './ChatHeader'
import { ChatInput } from './ChatInput'
import { ChatMessages } from './ChatMessages'

export function ChatContainer({
    isVisible,
    sendMessage,
}: {
    isVisible: boolean
    sendMessage: (message: string) => void
}) {
    return (
        <div
            style={{
                position: 'fixed',
                right: 24,
                bottom: 96,
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
            <ChatHeader />
            <ChatMessages />
            <ChatInput sendMessage={sendMessage} />
        </div>
    )
}
