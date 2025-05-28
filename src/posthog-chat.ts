import { PostHog } from './posthog-core'
import { CHAT_LOGGER as logger } from './utils/chat-utils'
import { assignableWindow } from './utils/globals'
import { RemoteConfig, PostHogChatConfig } from './types'
import { ChatMessageType } from './extensions/chat/components/PosthogChatBox'

// Define a generic callback type for PostHogChat methods
type PostHogChatCallback<T = void> = (error: any, result?: T) => void

export class PostHogChat {
    public isEnabled: boolean = false
    public messages: ChatMessageType[] = []
    public conversationId: string | null = null
    public chat_config: PostHogChatConfig | null = null
    public isMessageSending: boolean = false
    constructor(private readonly _instance: PostHog) {}

    startIfEnabled() {
        if (!this.isEnabled) {
            return
        }
        const loadChat = assignableWindow?.__PosthogExtensions__?.loadChat

        if (!loadChat) {
            assignableWindow.__PosthogExtensions__?.loadExternalDependency?.(this._instance, 'chat', (err) => {
                if (err) {
                    return logger.error('Could not load script', err)
                }

                assignableWindow.__PosthogExtensions__?.loadChat?.(this._instance)
            })
        }
    }

    onRemoteConfig(response: RemoteConfig) {
        // only load surveys if they are enabled and there are surveys to load
        if (response.chat_opt_in) {
            this.chat_config = response.chat_config || null
            this.isEnabled = true
            if (this.chat_config && this.chat_config.start_message && this.messages.length === 0) {
                //this.chat_config.start_message = this.chat_config.start_message || 'Questions? Chat with us!'
                this.messages.push({
                    id: 'start',
                    conversation: '',
                    content: this.chat_config.start_message || 'Questions? Chat with us!',
                    created_at: new Date().toISOString(),
                    read: false,
                    is_assistant: true,
                })
            }
            this.startIfEnabled()
        }
    }

    sendMessage(conversationId: string, message: string, callback?: PostHogChatCallback<void>): void {
        logger.info('PostHogChat sendMessage', message)
        this.isMessageSending = true
        try {
            assignableWindow.__PosthogExtensions__?.chat?.sendMessage(
                conversationId,
                message,
                this._instance,
                () => {
                    // Extension's resolve callback
                    this.isMessageSending = false
                    if (callback) callback(null)
                },
                (error) => {
                    // Extension's reject callback
                    this.isMessageSending = false
                    logger.error('Error in PostHogChat.sendMessage from extension', error)
                    if (callback) callback(error)
                }
            )
        } catch (error) {
            this.isMessageSending = false
            logger.error('Synchronous error in PostHogChat.sendMessage calling extension', error)
            if (callback) callback(error)
        }
    }

    getChat(callback?: PostHogChatCallback<{ messages?: ChatMessageType[]; conversationId?: string }>): void {
        if (!this.isEnabled) {
            if (callback) callback(null, {}) // Not enabled, callback with empty result
            return
        }

        try {
            assignableWindow.__PosthogExtensions__?.chat?.getChat(
                this._instance,
                (result) => {
                    // Extension's resolve callback
                    logger.info('PostHogChat getChat result:', result)
                    if (result?.messages && result?.conversationId) {
                        this.messages = result.messages
                        this.conversationId = result.conversationId
                    }
                    if (callback) callback(null, result)
                },
                (error) => {
                    // Extension's reject callback
                    logger.error('Error in PostHogChat.getChat from extension', error)
                    if (callback) callback(error)
                }
            )
        } catch (error) {
            logger.error('Synchronous error in PostHogChat.getChat calling extension', error)
            if (callback) callback(error)
        }
    }
}
