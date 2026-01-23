import { PostHog } from '../../posthog-core'
import { RemoteConfig, SDKPolicyConfigUrlTrigger } from '../../types'
import { urlMatchesTriggers, compileRegexCache } from '../../utils/policyMatching'
import { window } from '../../utils/globals'
import { isBoolean, isNullish, isObject, isString } from '@posthog/core'
import { createLogger } from '../../utils/logger'

const logger = createLogger('[Error Tracking]')

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
 */
export interface IngestionDecision {
    /** Whether the error should be captured */
    shouldCapture: boolean
    /** Reason for the decision - useful for debugging */
    reason: 'no_config' | 'url_blocked' | 'linked_flag_pending' | 'sampled_out' | 'capture'
}

/**
 * Manages ingestion controls for error tracking.
 * 
 * Simple model:
 * - By default, errors are captured
 * - Visiting a blocklisted URL → blocks capture
 * - Visiting a trigger URL → unblocks capture
 * - Linked feature flag and sampling are additional conditions
 */
export class ErrorTrackingIngestionControls {
    private _urlTriggers: SDKPolicyConfigUrlTrigger[] = []
    private _urlBlocklist: SDKPolicyConfigUrlTrigger[] = []
    private _linkedFeatureFlag: string | null = null
    private _sampleRate: number | null = null

    private _compiledTriggerRegexes: Map<string, RegExp> = new Map()
    private _compiledBlocklistRegexes: Map<string, RegExp> = new Map()

    private _linkedFlagSeen: boolean = false
    private _flagListenerCleanup: () => void = () => {}

    private _configReceived: boolean = false

    // Simple state: are we currently blocked?
    private _lastCheckedUrl: string = ''
    private _urlMonitoringCleanup: (() => void) | null = null
    private _urlBlocked: boolean = false

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
        this._linkedFeatureFlag = errorTrackingConfig.linked_feature_flag ?? null
        this._sampleRate = errorTrackingConfig.sample_rate ?? null

        this._compileRegexCaches()
        this._setupLinkedFlagListener()
        this._setupUrlMonitoring()

        this._configReceived = true
        logger.info('Ingestion controls configured', {
            urlTriggers: this._urlTriggers.length,
            urlBlocklist: this._urlBlocklist.length,
            linkedFeatureFlag: this._linkedFeatureFlag,
            sampleRate: this._sampleRate,
        })

        // Check initial URL immediately after config is received
        this._checkUrlConditions()
    }

    /**
     * Check whether an error should be captured.
     * 
     * Simple logic:
     * - If blocked by URL → don't capture
     * - If linked flag configured but not seen → don't capture
     * - If sampled out → don't capture
     * - Otherwise → capture
     */
    shouldCaptureError(): IngestionDecision {
        const url = this._getCurrentUrl()

        logger.info('Evaluating ingestion controls', {
            configReceived: this._configReceived,
            currentUrl: url,
            urlBlocked: this._urlBlocked,
        })

        // If no config received yet, allow capture (fail open)
        if (!this._configReceived) {
            logger.info('Decision: capture (no config received yet)')
            return { shouldCapture: true, reason: 'no_config' }
        }

        // Check if currently blocked by URL
        if (this._urlBlocked) {
            logger.info('Decision: block (currently blocked by URL)')
            return { shouldCapture: false, reason: 'url_blocked' }
        }

        // Check linked feature flag (if configured, flag must be enabled)
        if (!isNullish(this._linkedFeatureFlag) && !this._linkedFlagSeen) {
            logger.info('Decision: block (linked feature flag not matched)', {
                flag: this._linkedFeatureFlag,
                seen: this._linkedFlagSeen,
            })
            return { shouldCapture: false, reason: 'linked_flag_pending' }
        }

        // Check sample rate (if configured, apply sampling)
        if (!isNullish(this._sampleRate) && !this._isSampled()) {
            logger.info('Decision: block (sampled out)', { sampleRate: this._sampleRate })
            return { shouldCapture: false, reason: 'sampled_out' }
        }

        logger.info('Decision: capture')
        return { shouldCapture: true, reason: 'capture' }
    }

    /**
     * Check the current URL against triggers and blocklist.
     * 
     * Simple logic:
     * - Visiting blocklisted URL → blocked = true
     * - Visiting trigger URL → blocked = false
     * - Other URLs → no change
     */
    private _checkUrlConditions(): void {
        const url = this._getCurrentUrl()
        if (!url || url === this._lastCheckedUrl) {
            return
        }
        this._lastCheckedUrl = url

        const matchesBlocklist =
            this._urlBlocklist.length > 0 &&
            urlMatchesTriggers(url, this._urlBlocklist, this._compiledBlocklistRegexes)
        const matchesTrigger =
            this._urlTriggers.length > 0 &&
            urlMatchesTriggers(url, this._urlTriggers, this._compiledTriggerRegexes)

        logger.info('URL navigation detected', {
            url,
            matchesBlocklist,
            matchesTrigger,
            wasBlocked: this._urlBlocked,
        })

        if (matchesBlocklist) {
            if (!this._urlBlocked) {
                this._urlBlocked = true
                logger.info('URL BLOCKED - errors will not be captured until a trigger URL is visited', { url })
            }
        } else if (matchesTrigger) {
            if (this._urlBlocked) {
                this._urlBlocked = false
                logger.info('URL UNBLOCKED - trigger URL visited, errors can now be captured', { url })
            }
        }
    }

    /**
     * Set up monitoring for URL changes.
     */
    private _setupUrlMonitoring(): void {
        this._urlMonitoringCleanup?.()

        const hasUrlConfig = this._urlTriggers.length > 0 || this._urlBlocklist.length > 0
        if (!hasUrlConfig || typeof window === 'undefined') {
            return
        }

        const checkUrl = () => this._checkUrlConditions()

        window.addEventListener('popstate', checkUrl)
        window.addEventListener('hashchange', checkUrl)

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

        const win = window
        this._urlMonitoringCleanup = () => {
            win.removeEventListener('popstate', checkUrl)
            win.removeEventListener('hashchange', checkUrl)

            if (originalPushState && win.history) {
                win.history.pushState = originalPushState
            }
            if (originalReplaceState && win.history) {
                win.history.replaceState = originalReplaceState
            }
        }
    }

    /**
     * Check if this session passes sampling.
     */
    private _isSampled(): boolean {
        if (isNullish(this._sampleRate)) {
            return true
        }

        const sessionId = this._instance.get_session_id()
        if (!sessionId) {
            return true
        }

        // Simple hash of session ID for deterministic sampling
        let hash = 0
        for (let i = 0; i < sessionId.length; i++) {
            const char = sessionId.charCodeAt(i)
            hash = (hash << 5) - hash + char
            hash = hash & hash
        }
        const normalizedHash = Math.abs(hash) / 2147483647

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
        this._flagListenerCleanup()
        this._linkedFlagSeen = false

        if (isNullish(this._linkedFeatureFlag)) {
            return
        }

        const flagKey = this._linkedFeatureFlag
        logger.info('Setting up linked feature flag listener', { flag: flagKey })

        this._flagListenerCleanup = this._instance.onFeatureFlags((_flags, variants) => {
            if (!isObject(variants) || !(flagKey in variants)) {
                return
            }

            const variantValue = variants[flagKey]
            let flagMatches = false

            if (isBoolean(variantValue)) {
                flagMatches = variantValue === true
            } else if (isString(variantValue)) {
                flagMatches = variantValue.length > 0
            }

            logger.info('Linked feature flag evaluation', {
                flag: flagKey,
                value: variantValue,
                matches: flagMatches,
            })

            if (flagMatches && !this._linkedFlagSeen) {
                this._linkedFlagSeen = true
                logger.info('Linked feature flag ACTIVATED', { flag: flagKey })
            }
        })
    }

    /**
     * Clean up resources.
     */
    stop(): void {
        this._flagListenerCleanup()
        this._urlMonitoringCleanup?.()
        this._lastCheckedUrl = ''
        this._urlBlocked = false
    }
}
