import { PostHog } from '../../posthog-core'
import { RemoteConfig, SDKPolicyConfigUrlTrigger } from '../../types'
import { urlMatchesTriggers, compileRegexCache } from '../../utils/policyMatching'
import { window } from '../../utils/globals'
import { isBoolean, isNullish, isObject, isString } from '@posthog/core'
import { createLogger } from '../../utils/logger'

const logger = createLogger('[Error Tracking]')

// Constants for persistence keys
const ERROR_TRACKING_URL_TRIGGER_ACTIVATED_SESSION = '$error_tracking_url_trigger_activated_session'
const ERROR_TRACKING_EVENT_TRIGGER_ACTIVATED_SESSION = '$error_tracking_event_trigger_activated_session'

// Store original history methods for cleanup
let originalPushState: typeof history.pushState | null = null
let originalReplaceState: typeof history.replaceState | null = null

export interface ErrorTrackingRemoteConfig {
    match_type?: 'all'
    sample_rate?: number | null
    linked_feature_flag?: string | null
    event_triggers?: string[]
    url_triggers?: SDKPolicyConfigUrlTrigger[]
    url_blocklist?: SDKPolicyConfigUrlTrigger[]
}

/**
 * Result of checking whether an error should be captured.
 * With match_type: 'all', all configured conditions must pass.
 */
export interface IngestionDecision {
    /** Whether the error should be captured */
    shouldCapture: boolean
    /** Reason for the decision - useful for debugging */
    reason:
        | 'no_config'
        | 'url_blocked'
        | 'url_trigger_pending'
        | 'event_trigger_pending'
        | 'linked_flag_pending'
        | 'sampled_out'
        | 'capture'
}

/**
 * Manages ingestion controls for error tracking.
 * Handles URL triggers/blocklist, event triggers, linked feature flags, and sampling.
 *
 * With match_type: 'all' (the only supported mode currently), all configured conditions
 * must be met for an error to be captured.
 */
export class ErrorTrackingIngestionControls {
    private _urlTriggers: SDKPolicyConfigUrlTrigger[] = []
    private _urlBlocklist: SDKPolicyConfigUrlTrigger[] = []
    private _eventTriggers: string[] = []
    private _linkedFeatureFlag: string | null = null
    private _sampleRate: number | null = null

    private _compiledTriggerRegexes: Map<string, RegExp> = new Map()
    private _compiledBlocklistRegexes: Map<string, RegExp> = new Map()

    private _linkedFlagSeen: boolean = false
    private _flagListenerCleanup: () => void = () => {}

    private _configReceived: boolean = false

    // URL monitoring state
    private _lastCheckedUrl: string = ''
    private _urlMonitoringCleanup: (() => void) | null = null

    constructor(private readonly _instance: PostHog) {}

    /**
     * Process remote config for error tracking ingestion controls.
     */
    onRemoteConfig(response: RemoteConfig): void {
        const errorTrackingConfig = response.errorTracking

        if (!isObject(errorTrackingConfig)) {
            this._configReceived = true
            return
        }

        this._urlTriggers = errorTrackingConfig.url_triggers ?? []
        this._urlBlocklist = errorTrackingConfig.url_blocklist ?? []
        this._eventTriggers = errorTrackingConfig.event_triggers ?? []
        this._linkedFeatureFlag = errorTrackingConfig.linked_feature_flag ?? null
        this._sampleRate = errorTrackingConfig.sample_rate ?? null

        this._compileRegexCaches()
        this._setupLinkedFlagListener()
        this._setupUrlMonitoring()

        this._configReceived = true
        logger.info('Ingestion controls configured', {
            urlTriggers: this._urlTriggers.length,
            urlBlocklist: this._urlBlocklist.length,
            eventTriggers: this._eventTriggers.length,
            linkedFeatureFlag: this._linkedFeatureFlag,
            sampleRate: this._sampleRate,
        })

        // Check initial URL immediately after config is received
        this._checkUrlTrigger()
    }

    /**
     * Check whether an error should be captured based on all configured conditions.
     * With match_type: 'all', all conditions must pass.
     */
    shouldCaptureError(): IngestionDecision {
        // If no config received yet, allow capture (fail open)
        if (!this._configReceived) {
            return { shouldCapture: true, reason: 'no_config' }
        }

        const sessionId = this._instance.get_session_id()

        // Check URL blocklist first - always blocks regardless of other conditions
        if (this._isUrlBlocked()) {
            return { shouldCapture: false, reason: 'url_blocked' }
        }

        // With match_type: 'all', all configured conditions must pass
        // If no conditions are configured, we capture

        // Check URL triggers (if configured, current URL must match)
        if (this._urlTriggers.length > 0 && !this._isUrlTriggerActivated(sessionId)) {
            return { shouldCapture: false, reason: 'url_trigger_pending' }
        }

        // Check event triggers (if configured, a trigger event must have fired this session)
        if (this._eventTriggers.length > 0 && !this._isEventTriggerActivated(sessionId)) {
            return { shouldCapture: false, reason: 'event_trigger_pending' }
        }

        // Check linked feature flag (if configured, flag must be enabled)
        if (!isNullish(this._linkedFeatureFlag) && !this._linkedFlagSeen) {
            return { shouldCapture: false, reason: 'linked_flag_pending' }
        }

        // Check sample rate (if configured, apply sampling)
        if (!isNullish(this._sampleRate) && !this._isSampled()) {
            return { shouldCapture: false, reason: 'sampled_out' }
        }

        return { shouldCapture: true, reason: 'capture' }
    }

    /**
     * Check if the current URL matches any blocklist pattern.
     */
    private _isUrlBlocked(): boolean {
        if (this._urlBlocklist.length === 0) {
            return false
        }

        const url = this._getCurrentUrl()
        if (!url) {
            return false
        }

        return urlMatchesTriggers(url, this._urlBlocklist, this._compiledBlocklistRegexes)
    }

    /**
     * Check if URL trigger has been activated for this session.
     * Activation happens via URL monitoring, not at error capture time.
     */
    private _isUrlTriggerActivated(sessionId: string): boolean {
        const activatedSession = this._instance.get_property(ERROR_TRACKING_URL_TRIGGER_ACTIVATED_SESSION)
        return activatedSession === sessionId
    }

    /**
     * Check the current URL against triggers and activate if matched.
     * This is called on navigation events and when config is received.
     */
    private _checkUrlTrigger(): void {
        if (this._urlTriggers.length === 0) {
            return
        }

        const url = this._getCurrentUrl()
        if (!url || url === this._lastCheckedUrl) {
            return
        }
        this._lastCheckedUrl = url

        const sessionId = this._instance.get_session_id()
        const alreadyActivated = this._instance.get_property(ERROR_TRACKING_URL_TRIGGER_ACTIVATED_SESSION) === sessionId

        if (!alreadyActivated && urlMatchesTriggers(url, this._urlTriggers, this._compiledTriggerRegexes)) {
            this._instance.register_for_session({
                [ERROR_TRACKING_URL_TRIGGER_ACTIVATED_SESSION]: sessionId,
            })
            logger.info('URL trigger activated', { url })
        }
    }

    /**
     * Set up monitoring for URL changes to activate triggers on navigation.
     * This ensures triggers activate when the user visits matching URLs,
     * not just when errors occur.
     */
    private _setupUrlMonitoring(): void {
        // Clean up any existing monitoring
        this._urlMonitoringCleanup?.()

        if (this._urlTriggers.length === 0 || typeof window === 'undefined') {
            return
        }

        const checkUrl = () => this._checkUrlTrigger()

        // Listen for popstate (back/forward navigation)
        window.addEventListener('popstate', checkUrl)

        // Wrap pushState and replaceState for SPA navigation
        if (window.history) {
            if (!originalPushState) {
                originalPushState = window.history.pushState.bind(window.history)
            }
            if (!originalReplaceState) {
                originalReplaceState = window.history.replaceState.bind(window.history)
            }

            window.history.pushState = function (...args) {
                originalPushState?.apply(this, args)
                checkUrl()
            }

            window.history.replaceState = function (...args) {
                originalReplaceState?.apply(this, args)
                checkUrl()
            }
        }

        // Also listen for hashchange
        window.addEventListener('hashchange', checkUrl)

        // Capture window reference for cleanup (we already checked it's defined above)
        const win = window

        // Store cleanup function
        this._urlMonitoringCleanup = () => {
            win.removeEventListener('popstate', checkUrl)
            win.removeEventListener('hashchange', checkUrl)

            // Restore original history methods
            if (originalPushState && win.history) {
                win.history.pushState = originalPushState
            }
            if (originalReplaceState && win.history) {
                win.history.replaceState = originalReplaceState
            }
        }
    }

    /**
     * Check if an event trigger has been activated for this session.
     */
    private _isEventTriggerActivated(sessionId: string): boolean {
        const activatedSession = this._instance.get_property(ERROR_TRACKING_EVENT_TRIGGER_ACTIVATED_SESSION)
        return activatedSession === sessionId
    }

    /**
     * Call this when a captured event matches an event trigger.
     * This should be called from the event capture flow.
     */
    onEventCaptured(eventName: string): void {
        if (this._eventTriggers.length === 0) {
            return
        }

        if (this._eventTriggers.includes(eventName)) {
            const sessionId = this._instance.get_session_id()
            this._instance.register_for_session({
                [ERROR_TRACKING_EVENT_TRIGGER_ACTIVATED_SESSION]: sessionId,
            })
            logger.info('Event trigger activated', { event: eventName })
        }
    }

    /**
     * Check if this session passes sampling.
     * Sampling is determined once per session.
     */
    private _isSampled(): boolean {
        if (isNullish(this._sampleRate)) {
            return true
        }

        // Use the session ID to deterministically decide sampling
        // This ensures the same session always gets the same result
        const sessionId = this._instance.get_session_id()
        if (!sessionId) {
            return true
        }

        // Simple hash of session ID to get a deterministic 0-1 value
        let hash = 0
        for (let i = 0; i < sessionId.length; i++) {
            const char = sessionId.charCodeAt(i)
            hash = (hash << 5) - hash + char
            hash = hash & hash // Convert to 32bit integer
        }
        const normalizedHash = Math.abs(hash) / 2147483647 // Normalize to 0-1

        return normalizedHash < this._sampleRate
    }

    private _getCurrentUrl(): string | null {
        if (typeof window === 'undefined' || !window.location?.href) {
            return null
        }
        return window.location.href
    }

    private _compileRegexCaches(): void {
        this._compiledTriggerRegexes = compileRegexCache(this._urlTriggers, 'Error tracking URL trigger')
        this._compiledBlocklistRegexes = compileRegexCache(this._urlBlocklist, 'Error tracking URL blocklist')
    }

    private _setupLinkedFlagListener(): void {
        // Clean up any existing listener
        this._flagListenerCleanup()
        this._linkedFlagSeen = false

        if (isNullish(this._linkedFeatureFlag)) {
            return
        }

        const flagKey = this._linkedFeatureFlag

        this._flagListenerCleanup = this._instance.onFeatureFlags((_flags, variants) => {
            if (!isObject(variants) || !(flagKey in variants)) {
                return
            }

            const variantValue = variants[flagKey]
            let flagMatches = false

            if (isBoolean(variantValue)) {
                flagMatches = variantValue === true
            } else if (isString(variantValue)) {
                // Any truthy string variant counts as enabled
                flagMatches = variantValue.length > 0
            }

            if (flagMatches && !this._linkedFlagSeen) {
                this._linkedFlagSeen = true
                logger.info('Linked feature flag matched', { flag: flagKey })
            }
        })
    }

    /**
     * Clean up resources (e.g., flag listeners, URL monitoring).
     */
    stop(): void {
        this._flagListenerCleanup()
        this._urlMonitoringCleanup?.()
        this._lastCheckedUrl = ''
    }
}
