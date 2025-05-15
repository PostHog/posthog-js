import { ChatHeader } from './ChatHeader'
import { ChatMessages } from './ChatMessages'

export function ChatContainer({ isVisible }: { isVisible: boolean }) {
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
            }}
        >
            <ChatHeader />
            <ChatMessages />
        </div>
    )
}
