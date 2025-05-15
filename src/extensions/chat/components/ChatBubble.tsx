import { ChatBubbleLeftRightHeroIcon } from './ChatBubbleLeftRightHeroIcon'
import { ChatBubbleXMarkHeroIcon } from './ChatBubbleXMarkHeroIcon'

export function ChatBubble({ isOpen, setIsOpen }: { isOpen: boolean; setIsOpen: (isOpen: boolean) => void }) {
    return (
        <div
            style={{
                position: 'fixed',
                right: 14,
                bottom: 14,
                borderRadius: 54,
                width: 54,
                height: 54,
                backgroundColor: '#fff',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
            }}
            onClick={() => {
                setIsOpen(!isOpen)
            }}
        >
            <div style={{ position: 'relative', width: 24, height: 24 }}>
                <ChatBubbleLeftRightHeroIcon isVisible={!isOpen} />
                <ChatBubbleXMarkHeroIcon isVisible={isOpen} />
            </div>
        </div>
    )
}
