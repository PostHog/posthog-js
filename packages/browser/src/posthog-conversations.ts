import { PostHog } from './posthog-core'
import {
    ConversationsRemoteConfig,
    SendMessageResponse,
    GetMessagesResponse,
    UserProvidedTraits,
} from './posthog-conversations-types'
import { RemoteConfig } from './types'
import { assignableWindow } from './utils/globals'
import { createLogger } from './utils/logger'
import { isNullish, isUndefined, isBoolean, isNull } from '@posthog/core'
import { formDataToQuery } from './utils/request-utils'

const logger = createLogger('[Conversations]')

// API interface that the lazy-loaded manager will use
export interface ConversationsApi {
    sendMessage(message: string, ticketId?: string, userTraits?: UserProvidedTraits): Promise<SendMessageResponse>
    getMessages(ticketId: string, after?: string): Promise<GetMessagesResponse>
}

// Will be defined when lazy-loaded
export interface ConversationsManager {
    show(): void
    hide(): void
    sendMessage(message: string): void
    destroy(): void
}

export class PostHogConversations {
    // This is set to undefined until the remote config is loaded
    // then it's set to true if conversations are enabled
    // or false if conversations are disabled in the project settings
    private _isConversationsEnabled?: boolean = undefined
    private _conversationsManager: ConversationsManager | null = null
    private _isInitializing: boolean = false
    private _remoteConfig: ConversationsRemoteConfig | null = null

    constructor(private _instance: PostHog) {}

    onRemoteConfig(response: RemoteConfig) {
        // Don't load conversations if disabled via config
        if (this._instance.config.disable_conversations) {
            return
        }

        const conversations = response['conversations']
        if (isNullish(conversations)) {
            return
        }

        // Handle both boolean and object response
        if (isBoolean(conversations)) {
            this._isConversationsEnabled = conversations
        } else {
            // It's a ConversationsRemoteConfig object
            this._isConversationsEnabled = conversations.enabled
            this._remoteConfig = conversations
            logger.info(`Conversations enabled, token: ${conversations.token ? 'present' : 'missing'}`)
        }

        this.loadIfEnabled()
    }

    reset(): void {
        // Clear any conversation-related data from localStorage
        if (typeof localStorage !== 'undefined') {
            const conversationKeys = []
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i)
                if (key?.startsWith('ph_conversations_')) {
                    conversationKeys.push(key)
                }
            }
            conversationKeys.forEach((key) => localStorage.removeItem(key))
        }

        // Destroy the manager if it exists
        if (this._conversationsManager) {
            this._conversationsManager.destroy()
            this._conversationsManager = null
        }

        // Reset state
        this._isConversationsEnabled = undefined
        this._remoteConfig = null
    }

    loadIfEnabled() {
        // Guard clauses
        if (this._conversationsManager) {
            return // Already loaded
        }
        if (this._isInitializing) {
            logger.info('Already initializing conversations, skipping...')
            return
        }
        if (this._instance.config.disable_conversations) {
            logger.info('Conversations disabled. Not loading.')
            return
        }
        if (this._instance.config.cookieless_mode && this._instance.consent.isOptedOut()) {
            logger.info('Not loading conversations in cookieless mode without consent.')
            return
        }

        const phExtensions = assignableWindow?.__PosthogExtensions__
        if (!phExtensions) {
            logger.error('PostHog Extensions not found.')
            return
        }

        // Wait for remote config to load
        if (isUndefined(this._isConversationsEnabled)) {
            return
        }

        // Check if conversations are enabled
        if (!this._isConversationsEnabled) {
            logger.info('Conversations not enabled for this team.')
            return
        }

        // Check if we have the required config
        if (!this._remoteConfig || !this._remoteConfig.token) {
            logger.error('Conversations enabled but missing token in remote config.')
            return
        }

        this._isInitializing = true

        try {
            const initConversations = phExtensions.initConversations
            if (initConversations) {
                // Conversations code is already loaded
                this._completeInitialization(initConversations)
                return
            }

            // If we reach here, conversations code is not loaded yet
            const loadExternalDependency = phExtensions.loadExternalDependency
            if (!loadExternalDependency) {
                this._handleLoadError('PostHog loadExternalDependency extension not found.')
                return
            }

            // Load the conversations bundle
            loadExternalDependency(this._instance, 'conversations', (err) => {
                if (err || !phExtensions.initConversations) {
                    this._handleLoadError('Could not load conversations script', err)
                } else {
                    // Need to get the function reference again inside the callback
                    this._completeInitialization(phExtensions.initConversations)
                }
            })
        } catch (e) {
            this._handleLoadError('Error initializing conversations', e)
        } finally {
            this._isInitializing = false
        }
    }

    /** Helper to finalize conversations initialization */
    private _completeInitialization(
        initConversationsFn: (
            instance: PostHog,
            config: ConversationsRemoteConfig,
            api: ConversationsApi
        ) => ConversationsManager
    ): void {
        if (!this._remoteConfig) {
            logger.error('Cannot complete initialization: remote config is null')
            return
        }

        try {
            // Create the API object that uses the main bundle's _send_request
            const api = this._createApi()

            this._conversationsManager = initConversationsFn(this._instance, this._remoteConfig, api)
            logger.info('Conversations loaded successfully')
        } catch (e) {
            this._handleLoadError('Error completing conversations initialization', e)
        }
    }

    /** Create the API object for the lazy-loaded manager to use */
    private _createApi(): ConversationsApi {
        const token = this._remoteConfig?.token || ''

        const api = {
            sendMessage: (
                message: string,
                ticketId?: string,
                userTraits?: UserProvidedTraits
            ): Promise<SendMessageResponse> => {
                return this._apiSendMessage(message, ticketId, token, userTraits)
            },
            getMessages: (ticketId: string, after?: string): Promise<GetMessagesResponse> => {
                return this._apiGetMessages(ticketId, after, token)
            },
        }

        return api
    }

    /** Send a message via the API (runs in main bundle) */
    private _apiSendMessage(
        message: string,
        ticketId: string | undefined,
        token: string,
        userTraits?: UserProvidedTraits
    ): Promise<SendMessageResponse> {
        // eslint-disable-next-line compat/compat
        return new Promise((resolve, reject) => {
            const distinctId = this._instance.get_distinct_id()
            const personProperties = this._instance.persistence?.props || {}

            // Priority for traits:
            // 1. User-provided traits from the widget form
            // 2. PostHog person properties
            const name = userTraits?.name || personProperties.$name || personProperties.name || null
            const email = userTraits?.email || personProperties.$email || personProperties.email || null

            const payload = {
                distinct_id: distinctId,
                message: message.trim(),
                traits: {
                    name,
                    email,
                },
                ticket_id: ticketId || null,
            }

            this._instance._send_request({
                url: this._instance.requestRouter.endpointFor('api', '/api/conversations/v1/widget/message'),
                method: 'POST',
                data: payload,
                headers: {
                    'X-Conversations-Token': token,
                },
                callback: (response) => {
                    if (response.statusCode === 429) {
                        reject(new Error('Too many requests. Please wait before trying again.'))
                        return
                    }

                    if (response.statusCode !== 200 && response.statusCode !== 201) {
                        const errorMsg = response.json?.detail || response.json?.message || 'Failed to send message'
                        logger.error('Failed to send message', { status: response.statusCode })
                        reject(new Error(errorMsg))
                        return
                    }

                    if (!response.json) {
                        reject(new Error('Invalid response from server'))
                        return
                    }

                    const data = response.json as SendMessageResponse
                    logger.info('Message sent successfully', { ticketId: data.ticket_id, messageId: data.message_id })
                    resolve(data)
                },
            })
        })
    }

    /** Fetch messages via the API (runs in main bundle) */
    private _apiGetMessages(ticketId: string, after: string | undefined, token: string): Promise<GetMessagesResponse> {
        // eslint-disable-next-line compat/compat
        return new Promise((resolve, reject) => {
            const distinctId = this._instance.get_distinct_id()
            const queryParams: Record<string, string> = {
                distinct_id: distinctId,
                limit: '50',
            }

            if (after) {
                queryParams.after = after
            }

            logger.info('Fetching messages', { ticketId, after })

            this._instance._send_request({
                url: this._instance.requestRouter.endpointFor(
                    'api',
                    `/api/conversations/v1/widget/messages/${ticketId}?${formDataToQuery(queryParams)}`
                ),
                method: 'GET',
                headers: {
                    'X-Conversations-Token': token,
                },
                callback: (response) => {
                    if (response.statusCode === 429) {
                        reject(new Error('Too many requests. Please wait before trying again.'))
                        return
                    }

                    if (response.statusCode !== 200) {
                        const errorMsg = response.json?.detail || response.json?.message || 'Failed to fetch messages'
                        logger.error('Failed to fetch messages', { status: response.statusCode })
                        reject(new Error(errorMsg))
                        return
                    }

                    if (!response.json) {
                        reject(new Error('Invalid response from server'))
                        return
                    }

                    const data = response.json as GetMessagesResponse
                    logger.info('Messages fetched', { count: data.messages.length, hasMore: data.has_more })
                    resolve(data)
                },
            })
        })
    }

    /** Helper to handle initialization errors */
    private _handleLoadError(message: string, error?: any): void {
        logger.error(message, error)
        this._conversationsManager = null
        this._isInitializing = false
    }

    // Public API methods

    /**
     * Opens the conversations widget
     */
    open(): void {
        if (!this._conversationsManager) {
            logger.warn('Conversations not loaded yet. Call loadIfEnabled() first.')
            return
        }
        this._conversationsManager.show()
    }

    /**
     * Closes/minimizes the conversations widget
     */
    close(): void {
        if (!this._conversationsManager) {
            logger.warn('Conversations not loaded yet.')
            return
        }
        this._conversationsManager.hide()
    }

    /**
     * Sends a message in the current conversation
     * @param message - The message text to send
     */
    sendMessage(message: string): void {
        if (!this._conversationsManager) {
            logger.warn('Conversations not loaded yet. Cannot send message.')
            return
        }
        if (!message || message.trim().length === 0) {
            logger.warn('Cannot send empty message.')
            return
        }
        this._conversationsManager.sendMessage(message)
    }

    /**
     * Check if conversations are currently loaded and available
     */
    isLoaded(): boolean {
        return !isNull(this._conversationsManager)
    }

    /**
     * Check if conversations are enabled (based on remote config)
     */
    isEnabled(): boolean {
        return this._isConversationsEnabled === true
    }
}
