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

        const done = (err?: any): void => {
            this.isMessageSending = false
            if (callback) {
                callback(err) // For void result, only error is passed or null for success
            } else if (err) {
                logger.error('Unhandled error in PostHogChat.sendMessage (no callback):', err)
            }
        }

        try {
            const chatExtension = assignableWindow.__PosthogExtensions__?.chat
            if (!chatExtension?.sendMessage) {
                return done(new Error('Chat sendMessage extension not available'))
            }

            chatExtension.sendMessage(
                conversationId,
                message,
                this._instance,
                () => done(), // Extension's resolve
                (error) => {
                    // Extension's reject
                    logger.error('Error from sendMessage extension:', error)
                    done(error)
                }
            )
        } catch (error) {
            // Synchronous error during invocation
            logger.error('Synchronous error calling sendMessage extension:', error)
            done(error)
        }
    }

    getChat(callback?: PostHogChatCallback<{ messages?: ChatMessageType[]; conversationId?: string }>): void {
        if (!this.isEnabled) {
            if (callback) callback(null, {}) // Not enabled, callback with empty result
            return
        }

        const done = (err: any, result?: { messages?: ChatMessageType[]; conversationId?: string }): void => {
            if (callback) {
                callback(err, result)
            } else if (err) {
                logger.error('Unhandled error in PostHogChat.getChat (no callback):', err)
            }
        }

        try {
            const chatExtension = assignableWindow.__PosthogExtensions__?.chat
            if (!chatExtension?.getChat) {
                return done(new Error('Chat getChat extension not available'), undefined)
            }

            chatExtension.getChat(
                this._instance,
                (result) => {
                    // Extension's resolve
                    logger.info('PostHogChat getChat result:', result)
                    if (result?.messages && result?.conversationId) {
                        this.messages = result.messages
                        this.conversationId = result.conversationId
                    }
                    done(null, result)
                },
                (error) => {
                    // Extension's reject
                    logger.error('Error from getChat extension:', error)
                    done(error, undefined)
                }
            )
        } catch (error) {
            // Synchronous error during invocation
            logger.error('Synchronous error calling getChat extension:', error)
            done(error, undefined)
        }
    }
}
