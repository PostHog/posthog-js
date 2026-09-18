import { PostHogLogs as SharedLogs } from '@posthog/browser-common/logs'
import type { ConsoleLogsLoader } from '@posthog/browser-common/logs-types'
import { createLogger } from '@posthog/browser-common/utils/logger'
import { isNullish, stripUrlHash } from '@posthog/core'
import type { LogSdkContext } from './types'
import type { PostHog } from './posthog-core'
import { LOAD_EXT_NOT_FOUND, LOGS_CAPTURE_ENABLED_SERVER_SIDE } from './constants'
import { LogsExtension } from './extension-tokens'
import { assignableWindow } from './utils/globals'

export { RECORDER_MAX_AGE_MS } from '@posthog/browser-common/logs'

/** Legacy configuration, log context, and console script loading. */
export class PostHogLogs extends SharedLogs {
    override readonly name = LogsExtension

    constructor(private readonly _instance: PostHog) {
        super({
            get: () => _instance?.config?.logs,
            captureHintKey: LOGS_CAPTURE_ENABLED_SERVER_SIDE,
            get remoteConfigWillArrive() {
                return (
                    !_instance._shouldDisableFlags?.() ||
                    !!assignableWindow._POSTHOG_REMOTE_CONFIG?.[_instance.config.token]?.config
                )
            },
        })
        // Reset the breaker before application reconnect handlers can capture new logs.
        this._listenForReconnect()
    }

    protected override get _isRequestReady(): boolean {
        return this._instance.__loaded
    }

    protected override _getSdkContext(): LogSdkContext {
        return getSdkContext(this._instance)
    }

    protected override _getConsoleLoader(): ConsoleLogsLoader | undefined {
        const logger = createLogger('[logs]')
        const phExtensions = assignableWindow?.__PosthogExtensions__
        if (!phExtensions) {
            logger.error('PostHog Extensions not found.')
            return undefined
        }
        const loadExternalDependency = phExtensions.loadExternalDependency
        if (!loadExternalDependency) {
            logger.error(LOAD_EXT_NOT_FOUND)
            return undefined
        }
        return (callback) => {
            loadExternalDependency(this._instance, 'logs', (error) => {
                const logsExtension = phExtensions.logs
                callback(
                    error,
                    logsExtension?.initializeLogs
                        ? {
                              initialize: (client) => logsExtension.initializeLogs!(client),
                              replay: (client, entries) => logsExtension.replayConsoleBuffer?.(client, entries),
                          }
                        : undefined
                )
            })
        }
    }
}

function getSdkContext(instance: PostHog): LogSdkContext {
    const context: LogSdkContext = {}
    context.distinctId = instance.get_distinct_id()
    if (instance.sessionManager) {
        const { sessionId, windowId, sessionStartTimestamp, lastActivityTimestamp } =
            instance.sessionManager.checkAndGetSessionAndWindowId(true)
        context.sessionId = sessionId
        context.windowId = windowId
        if (!isNullish(sessionStartTimestamp)) context.sessionStartTimestamp = sessionStartTimestamp
        if (!isNullish(lastActivityTimestamp)) context.lastActivityTimestamp = lastActivityTimestamp
    }
    if (assignableWindow?.location?.href) {
        context.currentUrl = instance.config.disable_capture_url_hashes
            ? stripUrlHash(assignableWindow.location.href)
            : assignableWindow.location.href
    }
    if (instance.featureFlags) {
        const flags = instance.featureFlags.getFlags()
        if (flags && flags.length > 0) context.activeFeatureFlags = flags
    }
    return context
}
