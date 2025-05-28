import { loadChat } from '../extensions/chat'

import { assignableWindow } from '../utils/globals'
import { PostHog } from '../posthog-core'
import { CHAT_LOGGER as logger } from '../utils/chat-utils'
import { ChatMessageType } from '../extensions/chat/components/PosthogChatBox'
import { request } from '../request'
import { isUndefined } from '../utils/type-utils'

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.loadChat = loadChat

assignableWindow.__PosthogExtensions__.chat = assignableWindow.__PosthogExtensions__.chat || {
    sendMessage: (
        conversationId: string,
        message: string,
        posthog: PostHog,
        resolve: (value: void) => void, // Inlined type
        reject: (reason?: any) => void // Inlined type
    ) => {
        const commonHeaders = {}
        let url: string
        let requestData: Record<string, any>
        let actionDescription: string

        if (!conversationId) {
            url = posthog.requestRouter.endpointFor('api', `/api/chat/`)
            requestData = {
                token: posthog.config.token,
                action: 'create_conversation',
                distinct_id: posthog.get_distinct_id(),
                title: 'Chat widget',
                message: message,
                source_url: 'chat-widget',
            }
            actionDescription = 'create_conversation'
        } else {
            url = posthog.requestRouter.endpointFor('api', `/api/chat/`)
            requestData = {
                token: posthog.config.token,
                action: 'send_message',
                conversation_id: conversationId,
                message: message,
                distinct_id: posthog.get_distinct_id(),
            }
            actionDescription = 'send_message'
        }

        request({
            url: url,
            method: 'POST',
            headers: commonHeaders,
            data: requestData,
            timeout: 10000,
            callback: (response) => {
                const statusCode = response.statusCode
                if (statusCode === 0) {
                    const errorMsg = `Network error or no response sending chat message (${actionDescription}).`
                    logger.error(errorMsg, response.text)
                    reject(new Error(errorMsg))
                    return
                }
                if (statusCode >= 200 && statusCode < 300) {
                    if (isUndefined(response.json) && statusCode !== 204) {
                        logger.warn(
                            `Chat message (${actionDescription}) sent but no JSON response (status: ${statusCode}).`
                        )
                    }
                    resolve()
                } else {
                    const errorMsg = `Chat message (${actionDescription}) could not be sent, status: ${statusCode}`
                    logger.error(errorMsg, response.text)
                    reject(new Error(errorMsg))
                }
            },
        })
    },
    getChat: (
        posthog: PostHog,
        resolve: (value: { messages?: ChatMessageType[]; conversationId?: string }) => void, // Inlined type
        reject: (reason?: any) => void // Inlined type
    ) => {
        const url = posthog.requestRouter.endpointFor(
            'api',
            `/api/chat/?token=${posthog.config.token}&distinct_id=${posthog.get_distinct_id()}`
        )

        request({
            url: url,
            method: 'GET',
            timeout: 10000,
            callback: (response) => {
                const statusCode = response.statusCode
                if (statusCode === 0) {
                    const errorMsg = 'Network error or no response getting chat.'
                    logger.error(errorMsg, response.text)
                    reject(new Error(errorMsg))
                    return
                }
                if (statusCode === 200 && !isUndefined(response.json)) {
                    const chats = response.json.conversations || []
                    if (chats.length > 0) {
                        const chat = chats[0]
                        resolve({
                            messages: chat.messages || [],
                            conversationId: chat.id,
                        })
                    } else {
                        resolve({})
                    }
                } else if (statusCode === 200 && isUndefined(response.json)) {
                    logger.warn('Chat API loaded (status 200) but no JSON response.')
                    resolve({})
                } else {
                    const errorMsg = `Chat API could not be loaded, status: ${statusCode}`
                    logger.error(errorMsg, response.text)
                    reject(new Error(errorMsg))
                }
            },
        })
    },
}

export default loadChat
