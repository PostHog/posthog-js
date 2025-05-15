import * as Preact from 'preact'
import { useState } from 'preact/hooks'

import { ChatBubble } from './ChatBubble'

export function PosthogChatBox() {
    const [isOpen, setIsOpen] = useState(false)
    return (
        <Preact.Fragment>
            <ChatBubble isOpen={isOpen} setIsOpen={setIsOpen} />
        </Preact.Fragment>
    )
}
