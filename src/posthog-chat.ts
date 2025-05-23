import { PostHog } from './posthog-core'
import { CHAT_LOGGER as logger } from './utils/chat-utils'
import { assignableWindow } from './utils/globals'
import { RemoteConfig, PostHogChatConfig } from './types'

export class PostHogChat {
    public _isFetchingMessages: boolean = false
    public isEnabled: boolean = false
    public messages: any[] = []
    public conversationId: string | null = null
    public chat_config: PostHogChatConfig | null = null
    constructor(private readonly _instance: PostHog) {}

    startIfEnabled() {
        logger.info('PostHogChat startIfEnabled')
        if (!this.isEnabled) {
            return
        }
        const loadChat = assignableWindow?.__PosthogExtensions__?.loadChat

        if (!loadChat) {
            // if (this._surveyEventReceiver == null) {
            //     this._surveyEventReceiver = new SurveyEventReceiver(this.instance)
            // }

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
            this.startIfEnabled()
        }
    }

    sendMessage(conversationId: string, message: string) {
        logger.info('PostHogChat sendMessage', message)

        if (!conversationId) {
            this._instance._send_request({
                url: this._instance.requestRouter.endpointFor('api', `/api/chat/`),
                method: 'POST',
                data: {
                    token: this._instance.config.token,
                    action: 'create_conversation',
                    distinct_id: this._instance.get_distinct_id(),
                    title: 'Some title',
                    conversation_id: conversationId,
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

                    this.getChat()

                    /*this._instance.persistence?.register({
                        $chat_conversation_id: response.json.conversations[0].id,
                    })*/
                },
            })
        } else {
            this._instance._send_request({
                url: this._instance.requestRouter.endpointFor('api', `/api/chat/`),
                method: 'POST',
                data: {
                    token: this._instance.config.token,
                    action: 'send_message',
                    conversation_id: conversationId,
                    message: message,
                    distinct_id: this._instance.get_distinct_id(),
                },
                timeout: 10000,
                callback: (response) => {
                    const statusCode = response.statusCode
                    if (statusCode !== 200 || !response.json) {
                        const error = `Chat message could not be sent, status: ${statusCode}`
                        logger.error(error)
                    }

                    this.getChat()
                },
            })
        }
    }

    getChat() {
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
