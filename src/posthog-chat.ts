import { PostHog } from './posthog-core'
import { CHAT_LOGGER as logger } from './utils/chat-utils'
import { assignableWindow } from './utils/globals'

export class PostHogChat {
    private _isFetchingMessages: boolean = false
    public messages: any[] = []
    public conversationId: string | null = null
    constructor(private readonly _instance: PostHog) {}

    startIfEnabled() {
        logger.info('PostHogChat startIfEnabled')
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

                    this._instance.persistence?.register({
                        $chat_conversation_id: response.json.conversations[0].id,
                    })
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
            this._isFetchingMessages = true
            this._instance._send_request({
                url: this._instance.requestRouter.endpointFor(
                    'api',
                    `/api/chat/?token=${this._instance.config.token}&distinct_id=${this._instance.get_distinct_id()}`
                ),
                method: 'GET',
                timeout: 10000,
                callback: (response) => {
                    this._isFetchingMessages = false
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

                    if (chats.length === 0) {
                        //create chat
                        //this.createChat()
                    }

                    const chat = chats[0]
                    this.messages = chat.messages || []
                    this.conversationId = chat.id
                },
            })
        } catch (e) {
            this._isFetchingMessages = false
            throw e
        }
    }

    /*createChat() {
        this._instance._send_request({
            url: this._instance.requestRouter.endpointFor('api', `/api/chat/`),
            method: 'POST',
            data: {
                token: this._instance.config.token,
                action: 'create_conversation',
                distinct_id: this._instance.get_distinct_id(),
                title: 'Some title',
            },
            timeout: 10000,
            callback: (response) => {
                console.debug('response', response)
                console.debug('response.json', response.json)
            },
        })
    }*/
}
