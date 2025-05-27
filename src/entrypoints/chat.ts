import { loadChat } from '../extensions/chat'

import { assignableWindow } from '../utils/globals'
import { PostHog } from '../posthog-core'
import { CHAT_LOGGER as logger } from '../utils/chat-utils'
import { ChatMessageType } from '../extensions/chat/components/PosthogChatBox'

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.loadChat = loadChat

assignableWindow.__PosthogExtensions__.chat = assignableWindow.__PosthogExtensions__.chat || {
    sendMessage: (conversationId: string, message: string, posthog: PostHog) => {
        if (!conversationId) {
            posthog._send_request({
                url: posthog.requestRouter.endpointFor('api', `/api/chat/`),
                method: 'POST',
                data: {
                    token: posthog.config.token,
                    action: 'create_conversation',
                    distinct_id: posthog.get_distinct_id(),
                    title: 'Chat widget',
                    message: message,
                    source_url: 'chat-widget',
                },
                timeout: 10000,
                callback: (response) => {
                    const statusCode = response.statusCode
                    if (statusCode !== 200 || !response.json) {
                        const error = `Chat message could not be sent, status: ${statusCode}`
                        logger.error(error)
                    }
                },
            })
        } else {
            posthog._send_request({
                url: posthog.requestRouter.endpointFor('api', `/api/chat/`),
                method: 'POST',
                data: {
                    token: posthog.config.token,
                    action: 'send_message',
                    conversation_id: conversationId,
                    message: message,
                    distinct_id: posthog.get_distinct_id(),
                },
                timeout: 10000,
                callback: (response) => {
                    const statusCode = response.statusCode
                    if (statusCode !== 200 || !response.json) {
                        const error = `Chat message could not be sent, status: ${statusCode}`
                        logger.error(error)
                    }
                },
            })
        }
    },
    getChat: (posthog: PostHog): { messages?: ChatMessageType[]; conversationId?: string } => {
        try {
            posthog._send_request({
                url: posthog.requestRouter.endpointFor(
                    'api',
                    `/api/chat/?token=${posthog.config.token}&distinct_id=${posthog.get_distinct_id()}`
                ),
                method: 'GET',
                timeout: 10000,
                callback: (response) => {
                    const statusCode = response.statusCode
                    if (statusCode !== 200 || !response.json) {
                        const error = `Chat API could not be loaded, status: ${statusCode}`
                        logger.error(error)
                        // return callback([], {
                        //     isLoaded: false,
                        //     error,
                        // })
                    }
                    const chats = response.json.conversations || []

                    if (chats.length > 0) {
                        const chat = chats[0]
                        return {
                            messages: chat.messages || [],
                            conversationId: chat.id,
                        }
                    }
                    return {}
                },
            })
        } catch (e) {
            logger.error('PostHogChat getChat', e)
            throw e
        }

        return {}
    },
}

export default loadChat
