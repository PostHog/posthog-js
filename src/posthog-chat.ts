import { PostHog } from './posthog-core'
import { CHAT_LOGGER as logger } from './utils/chat-utils'
import { assignableWindow } from './utils/globals'
import { RemoteConfig, PostHogChatConfig } from './types'
import { ChatMessageType } from './extensions/chat/components/PosthogChatBox'

export class PostHogChat {
    public isEnabled: boolean = false
    public messages: ChatMessageType[] = []
    public conversationId: string | null = null
    public chat_config: PostHogChatConfig | null = null
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

    sendMessage(conversationId: string, message: string) {
        logger.info('PostHogChat sendMessage', message)

        assignableWindow.__PosthogExtensions__?.chat?.sendMessage(conversationId, message, this._instance)
    }

    getChat() {
        /** No calls if chat is not enabled */
        if (!this.isEnabled) {
            return
        }

        try {
            this._instance._send_request({
                url: this._instance.requestRouter.endpointFor(
                    'api',
                    `/api/chat/?token=${this._instance.config.token}&distinct_id=${this._instance.get_distinct_id()}`
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
                        this.messages = chat.messages || []
                        this.conversationId = chat.id
                    }
                },
            })
        } catch (e) {
            logger.error('PostHogChat getChat', e)
            throw e
        }
    }
}
