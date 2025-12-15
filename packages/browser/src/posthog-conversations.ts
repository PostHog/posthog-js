import { PostHog } from './posthog-core'
import { ConversationsRemoteConfig } from './posthog-conversations-types'
import { RemoteConfig } from './types'
import { assignableWindow, LazyLoadedConversationsInterface, window as _window } from './utils/globals'
import { createLogger } from './utils/logger'
import { isNullish, isUndefined, isBoolean, isNull } from '@posthog/core'

const logger = createLogger('[Conversations]')

/**
 * Extract hostname from a domain string (handles URLs and plain hostnames)
 */
function extractHostname(domain: string): string | null {
    // Remove protocol if present
    let hostname = domain.replace(/^https?:\/\//, '')
    // Remove path, query, port if present
    hostname = hostname.split('/')[0].split('?')[0].split(':')[0]
    return hostname || null
}

/**
 * Check if the current domain matches the allowed domains list.
 * Returns true if:
 * - domains is empty or not present (no restriction)
 * - current hostname matches any allowed domain
 */
function isCurrentDomainAllowed(domains: string[] | undefined): boolean {
    // No domain restriction - allow all
    if (!domains || domains.length === 0) {
        return true
    }

    const currentHostname = _window?.location?.hostname
    if (!currentHostname) {
        // Can't determine hostname (SSR, etc.) - allow by default
        return true
    }

    return domains.some((domain) => {
        const allowedHostname = extractHostname(domain)
        if (!allowedHostname) {
            return false
        }

        if (allowedHostname.startsWith('*.')) {
            // Wildcard match: *.example.com matches foo.example.com and example.com
            const pattern = allowedHostname.slice(2) // Remove "*."
            return currentHostname.endsWith(`.${pattern}`) || currentHostname === pattern
        }

        // Exact match
        return currentHostname === allowedHostname
    })
}

export type ConversationsManager = LazyLoadedConversationsInterface

export class PostHogConversations {
    // This is set to undefined until the remote config is loaded
    // then it's set to true if conversations are enabled
    // or false if conversations are disabled in the project settings
    private _isConversationsEnabled?: boolean = undefined
    private _conversationsManager: LazyLoadedConversationsInterface | null = null
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
        }

        this.loadIfEnabled()
    }

    reset(): void {
        // Delegate cleanup to the lazy-loaded manager (which knows about persistence keys)
        // If not loaded, there's nothing to reset anyway
        this._conversationsManager?.reset()
        this._conversationsManager = null

        // Reset local state
        this._isConversationsEnabled = undefined
        this._remoteConfig = null
    }

    loadIfEnabled() {
        if (this._conversationsManager) {
            return
        }
        if (this._isInitializing) {
            return
        }
        if (this._instance.config.disable_conversations) {
            return
        }
        if (this._instance.config.cookieless_mode && this._instance.consent.isOptedOut()) {
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
            return
        }

        // Check if we have the required config
        if (!this._remoteConfig || !this._remoteConfig.token) {
            logger.error('Conversations enabled but missing token in remote config.')
            return
        }

        // Check if current domain is allowed
        if (!isCurrentDomainAllowed(this._remoteConfig.domains)) {
            return
        }

        this._isInitializing = true

        try {
            const initConversations = phExtensions.initConversations
            if (initConversations) {
                // Conversations code is already loaded
                this._completeInitialization(initConversations)
                this._isInitializing = false
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
                    this._completeInitialization(phExtensions.initConversations)
                }
                this._isInitializing = false
            })
        } catch (e) {
            this._handleLoadError('Error initializing conversations', e)
            this._isInitializing = false
        }
    }

    /** Helper to finalize conversations initialization */
    private _completeInitialization(
        initConversationsFn: (config: ConversationsRemoteConfig, posthog: PostHog) => LazyLoadedConversationsInterface
    ): void {
        if (!this._remoteConfig) {
            logger.error('Cannot complete initialization: remote config is null')
            return
        }

        try {
            // Pass config and PostHog instance to the extension
            this._conversationsManager = initConversationsFn(this._remoteConfig, this._instance)
            logger.info('Conversations loaded successfully')
        } catch (e) {
            this._handleLoadError('Error completing conversations initialization', e)
        }
    }

    /** Helper to handle initialization errors */
    private _handleLoadError(message: string, error?: any): void {
        logger.error(message, error)
        this._conversationsManager = null
        this._isInitializing = false
    }

    /**
     * Show the conversations widget (button and chat panel)
     */
    enable(): void {
        if (!this._conversationsManager) {
            logger.warn('Conversations not loaded yet.')
            return
        }
        this._conversationsManager.enable()
    }

    /**
     * Hide the conversations widget completely (button and chat panel)
     */
    disable(): void {
        if (!this._conversationsManager) {
            return
        }
        this._conversationsManager.disable()
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
