import { LOAD_EXT_NOT_FOUND } from './constants'
import { PostHog } from './posthog-core'
import { CaptureLogOptions, RemoteConfig } from './types'
import { isNullish } from '@posthog/core'
import { assignableWindow } from './utils/globals'
import { createLogger } from './utils/logger'
import { Extension } from './extensions/types'
import { buildOtlpLogRecord, buildOtlpLogsPayload, type LogSdkContext, type OtlpLogRecord } from './logs-utils'

const FLUSH_INTERVAL_MS = 3000
const MAX_BUFFER_SIZE = 100

interface BufferedLogEntry {
    record: OtlpLogRecord
    resourceAttributes?: Record<string, string | number | boolean>
}

export class PostHogLogs implements Extension {
    private _isLogsEnabled: boolean = false
    private _isLoaded: boolean = false
    private readonly _logger = createLogger('[logs]')

    private _logBuffer: BufferedLogEntry[] = []
    private _flushTimeout: ReturnType<typeof setTimeout> | undefined

    constructor(private readonly _instance: PostHog) {
        if (this._instance && this._instance.config.logs?.captureConsoleLogs) {
            this._isLogsEnabled = true
        }
    }

    initialize() {
        this.loadIfEnabled()
    }

    onRemoteConfig(response: RemoteConfig) {
        // only load logs if they are enabled
        const logCapture = response.logs?.captureConsoleLogs
        if (isNullish(logCapture) || !logCapture) {
            return
        }
        this._isLogsEnabled = true
        this.loadIfEnabled()
    }

    reset(): void {
        this._logBuffer = []
        if (this._flushTimeout) {
            clearTimeout(this._flushTimeout)
            this._flushTimeout = undefined
        }
    }

    loadIfEnabled() {
        if (!this._isLogsEnabled || this._isLoaded) {
            return
        }

        const phExtensions = assignableWindow?.__PosthogExtensions__
        if (!phExtensions) {
            this._logger.error('PostHog Extensions not found.')
            return
        }

        const loadExternalDependency = phExtensions.loadExternalDependency
        if (!loadExternalDependency) {
            this._logger.error(LOAD_EXT_NOT_FOUND)
            return
        }

        loadExternalDependency(this._instance, 'logs', (err) => {
            if (err || !phExtensions.logs?.initializeLogs) {
                this._logger.error('Could not load logs script', err)
            } else {
                phExtensions.logs.initializeLogs(this._instance)
                this._isLoaded = true
            }
        })
    }

    // ========================================================================
    // captureLog — sends logs directly to the OTEL logs endpoint
    // ========================================================================

    captureLog(options: CaptureLogOptions): void {
        if (!this._instance.is_capturing()) {
            return
        }
        if (!this._instance.featureFlags?.isFeatureEnabled('logs-sdk-capture', { send_event: false })) {
            return
        }

        if (!options || !options.body) {
            this._logger.warn('captureLog requires a body')
            return
        }

        const sdkContext = this._getSdkContext(options)
        const record = buildOtlpLogRecord(options, sdkContext)

        this._logBuffer.push({
            record,
            resourceAttributes: options.resource_attributes,
        })

        if (this._logBuffer.length >= MAX_BUFFER_SIZE) {
            this.flushLogs()
        } else {
            this._scheduleFlush()
        }
    }

    flushLogs(transport?: 'XHR' | 'fetch' | 'sendBeacon'): void {
        if (this._flushTimeout) {
            clearTimeout(this._flushTimeout)
            this._flushTimeout = undefined
        }

        if (this._logBuffer.length === 0) {
            return
        }

        const entries = this._logBuffer
        this._logBuffer = []

        const resourceAttributes: Record<string, string | number | boolean> = {
            'service.name': 'posthog-js',
        }

        for (const entry of entries) {
            if (entry.resourceAttributes) {
                Object.assign(resourceAttributes, entry.resourceAttributes)
            }
        }

        const payload = buildOtlpLogsPayload(
            entries.map((e) => e.record),
            resourceAttributes
        )

        const url =
            this._instance.requestRouter.endpointFor('api', '/i/v1/logs') +
            '?token=' +
            encodeURIComponent(this._instance.config.token)

        this._instance._send_request({
            method: 'POST',
            url,
            data: payload,
            compression: 'best-available',
            batchKey: 'logs',
            transport,
        })
    }

    private _scheduleFlush(): void {
        if (this._flushTimeout) {
            return
        }
        this._flushTimeout = setTimeout(() => {
            this._flushTimeout = undefined
            this.flushLogs()
        }, FLUSH_INTERVAL_MS)
    }

    private _getSdkContext(options: CaptureLogOptions): LogSdkContext {
        const context: LogSdkContext = {
            lib: options.service_name || 'posthog-js',
        }

        if (this._instance.get_distinct_id) {
            context.distinctId = this._instance.get_distinct_id()
        }

        if (this._instance.sessionManager) {
            const { sessionId } = this._instance.sessionManager.checkAndGetSessionAndWindowId(true)
            context.sessionId = sessionId
        }

        if (assignableWindow?.location?.href) {
            context.currentUrl = assignableWindow.location.href
        }

        if (this._instance.featureFlags) {
            const flags = this._instance.featureFlags.getFlags()
            if (flags && flags.length > 0) {
                context.activeFeatureFlags = flags
            }
        }

        return context
    }
}
