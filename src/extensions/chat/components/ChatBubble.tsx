import { ChatBubbleLeftRightHeroIconFilled } from './ChatBubbleLeftRightHeroIcon'
import { ChatBubbleXMarkHeroIcon } from './ChatBubbleXMarkHeroIcon'
import { BRAND_COLOR } from './style'

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
                backgroundColor: BRAND_COLOR,
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
