import { PostHogLogs as SharedLogs } from '@posthog/browser-common/logs'
import type { BrowserLogsHost } from '@posthog/browser-common/logs-host'
import { createLogger } from '@posthog/browser-common/utils/logger'
import { window } from '@posthog/browser-common/utils/globals'
import { isNullish, stripUrlHash } from '@posthog/core'
import type { LogSdkContext } from './types'
import type { PostHog } from './posthog-core'
import Config from './config'
import { LOAD_EXT_NOT_FOUND, LOGS_CAPTURE_ENABLED_SERVER_SIDE } from './constants'
import { LogsExtension } from './extension-tokens'
import { assignableWindow } from './utils/globals'

export { RECORDER_MAX_AGE_MS } from '@posthog/browser-common/logs'

/** Legacy transport, context, and script-loader mapping for shared logs. */
export class PostHogLogs extends SharedLogs {
    override readonly name = LogsExtension

    constructor(instance: PostHog) {
        const logger = createLogger('[logs]')
        const host: BrowserLogsHost = {
            get config() {
                return instance?.config?.logs
            },
            window,
            get console() {
                return assignableWindow?.console
            },
            get isCapturing() {
                return instance?.is_capturing()
            },
            get isLoaded() {
                return instance.__loaded
            },
            get libraryName() {
                return Config.LIB_NAME
            },
            get libraryVersion() {
                return Config.LIB_VERSION
            },
            get persistedCaptureHint() {
                return !!instance?.persistence?.props?.[LOGS_CAPTURE_ENABLED_SERVER_SIDE]
            },
            // Persisted hints only start a recorder if fresh config can confirm or withdraw them.
            get remoteConfigWillArrive() {
                if (!instance?._shouldDisableFlags?.()) {
                    return true
                }
                return !!assignableWindow._POSTHOG_REMOTE_CONFIG?.[instance.config.token]?.config
            },
            persistCaptureHint: (enabled) => {
                instance?.persistence?.register({ [LOGS_CAPTURE_ENABLED_SERVER_SIDE]: enabled })
            },
            getSdkContext: () => getSdkContext(instance),
            sendRequest: (payload, transport, callback) => {
                instance._send_request({
                    method: 'POST',
                    url:
                        instance.requestRouter.endpointFor('api', '/i/v1/logs') +
                        '?token=' +
                        encodeURIComponent(instance.config.token),
                    data: payload,
                    compression: 'best-available',
                    batchKey: 'logs',
                    ...(callback ? { fireCallbackOnDrop: true, callback } : { transport }),
                })
            },
            getConsoleLoader: () => {
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
                    loadExternalDependency(instance, 'logs', (error) => {
                        const logsExtension = phExtensions.logs
                        callback(
                            error,
                            logsExtension?.initializeLogs
                                ? {
                                      initialize: (client) => logsExtension.initializeLogs!(client ?? instance),
                                      replay: (client, entries) =>
                                          logsExtension.replayConsoleBuffer?.(client ?? instance, entries),
                                  }
                                : undefined
                        )
                    })
                }
            },
        }
        super(host)
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
