import * as Preact from 'preact'
import { useState } from 'preact/hooks'

import { ChatBubble } from './ChatBubble'
import { ChatContainer } from './ChatContainer'

export function PosthogChatBox() {
    const [isOpen, setIsOpen] = useState(false)
    return (
        <Preact.Fragment>
            <ChatBubble isOpen={isOpen} setIsOpen={setIsOpen} />
            <ChatContainer isVisible={isOpen} />
        </Preact.Fragment>
    )
}
