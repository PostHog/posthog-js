import * as Preact from 'preact'
import { useState } from 'preact/hooks'

import { ChatBubble } from './ChatBubble'
import { ChatContainer } from './ChatContainer'
import { PostHog } from '../../../posthog-core'

export function PosthogChatBox({ posthog }: { posthog: PostHog }) {
    const [isOpen, setIsOpen] = useState(false)
    const sendMessage = (message: string) => {
        posthog.chat.sendMessage(message)
    }
    return (
        <Preact.Fragment>
            <ChatBubble isOpen={isOpen} setIsOpen={setIsOpen} />
            <ChatContainer isVisible={isOpen} sendMessage={sendMessage} />
        </Preact.Fragment>
    )
}
