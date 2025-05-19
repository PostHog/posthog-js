import { PostHog } from './posthog-core'
import { CHAT_LOGGER as logger } from './utils/chat-utils'
import { assignableWindow } from './utils/globals'

export class PostHogChat {
    private _isFetchingMessages: boolean = false

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

    sendMessage(message: string) {
        logger.info('PostHogChat sendMessage', message)
        const conversationId = this._instance.get_property('$chat_conversation_id')

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
                    source_url: window.location.href,
                },
                timeout: 10000,
                callback: (response) => {
                    const statusCode = response.statusCode
                    if (statusCode !== 200 || !response.json) {
                        const error = `Chat message could not be sent, status: ${statusCode}`
                        logger.error(error)
                    }

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
                    console.debug('response', response)
                    console.debug('response.json', response.json)
                },
            })
        }
    }

    getMessages() {
        // const existingSurveys = this._instance.get_property(SURVEYS)
        // if (existingSurveys && !forceReload) {
        //     return callback(existingSurveys, {
        //         isLoaded: true,
        //     })
        // }

        // // Prevent concurrent API calls
        // if (this._isFetchingMessages) {
        //     return callback([], {
        //         isLoaded: false,
        //         error: 'Surveys are already being loaded',
        //     })
        // }

        try {
            this._isFetchingMessages = true
            this._instance._send_request({
                url: this._instance.requestRouter.endpointFor('api', `/api/chat/?token=${this._instance.config.token}`),
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
                    console.debug('response', response)
                    console.debug('response.json', response.json)
                    const messages = response.json.messages || []

                    // this._instance.persistence?.register({ [SURVEYS]: surveys })
                    // return callback(surveys, {
                    //     isLoaded: true,
                    // })
                },
            })
        } catch (e) {
            this._isFetchingMessages = false
            throw e
        }
    }
}
