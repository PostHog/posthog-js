import { LOAD_EXT_NOT_FOUND } from './constants'
import Config from './config'
import { PostHog } from './posthog-core'
import type { CaptureLogOptions, RemoteConfig, Logger, LogSdkContext, LogAttributeValue, OtlpLogRecord } from './types'
import { buildOtlpLogRecord, buildOtlpLogsPayload, isNullish } from '@posthog/core'
import { assignableWindow } from './utils/globals'
import { createLogger } from './utils/logger'
import { Extension } from './extensions/types'

const DEFAULT_FLUSH_INTERVAL_MS = 3000
const DEFAULT_MAX_BUFFER_SIZE = 100
const DEFAULT_MAX_LOGS_PER_INTERVAL = 1000

interface BufferedLogEntry {
    record: OtlpLogRecord
}

export class PostHogLogs implements Extension {
    private _isLogsEnabled: boolean = false
    private _isLoaded: boolean = false
    private readonly _logger = createLogger('[logs]')

    private _logBuffer: BufferedLogEntry[] = []
    private _flushTimeout: ReturnType<typeof setTimeout> | undefined
    private _logger_instance: Logger | undefined

    private _intervalLogCount: number = 0
    private _intervalWindowStart: number = 0
    private _droppedWarned: boolean = false

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
        this._intervalLogCount = 0
        this._intervalWindowStart = 0
        this._droppedWarned = false
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

        if (!options || !options.body) {
            this._logger.warn('captureLog requires a body')
            return
        }

        const flushIntervalMs = this._instance.config.logs?.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS
        const maxLogsPerInterval = this._instance.config.logs?.maxLogsPerInterval ?? DEFAULT_MAX_LOGS_PER_INTERVAL
        const now = Date.now()
        if (now - this._intervalWindowStart >= flushIntervalMs) {
            this._intervalWindowStart = now
            this._intervalLogCount = 0
            this._droppedWarned = false
        }
        if (this._intervalLogCount >= maxLogsPerInterval) {
            if (!this._droppedWarned) {
                this._logger.warn(
                    `captureLog dropping logs: exceeded ${maxLogsPerInterval} logs per ${flushIntervalMs}ms`
                )
                this._droppedWarned = true
            }
            return
        }
        this._intervalLogCount++

        const sdkContext = this._getSdkContext()
        const record = buildOtlpLogRecord(options, sdkContext)

        this._logBuffer.push({ record })

        const maxBufferSize = this._instance.config.logs?.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE
        if (this._logBuffer.length >= maxBufferSize) {
            this.flushLogs()
        } else {
            this._scheduleFlush()
        }
    }

    get logger(): Logger {
        if (!this._logger_instance) {
            this._logger_instance = {
                trace: (body, attributes) => this.captureLog({ body, level: 'trace', attributes }),
                debug: (body, attributes) => this.captureLog({ body, level: 'debug', attributes }),
                info: (body, attributes) => this.captureLog({ body, level: 'info', attributes }),
                warn: (body, attributes) => this.captureLog({ body, level: 'warn', attributes }),
                error: (body, attributes) => this.captureLog({ body, level: 'error', attributes }),
                fatal: (body, attributes) => this.captureLog({ body, level: 'fatal', attributes }),
            }
        }
        return this._logger_instance
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

        const logsConfig = this._instance.config.logs
        const resourceAttributes: Record<string, LogAttributeValue> = {
            'service.name': logsConfig?.serviceName || 'unknown_service',
            ...(logsConfig?.environment && { 'deployment.environment': logsConfig.environment }),
            ...(logsConfig?.serviceVersion && { 'service.version': logsConfig.serviceVersion }),
            ...logsConfig?.resourceAttributes,
        }

        const payload = buildOtlpLogsPayload(
            entries.map((e) => e.record),
            resourceAttributes,
            Config.LIB_NAME,
            Config.LIB_VERSION
        )

        const url =
            this._instance.requestRouter.endpointFor('api', '/i/v1/logs') +
            '?token=' +
            encodeURIComponent(this._instance.config.token)

        this._instance._send_retriable_request({
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
        }, this._instance.config.logs?.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS)
    }

    private _getSdkContext(): LogSdkContext {
        const context: LogSdkContext = {}

        context.distinctId = this._instance.get_distinct_id()

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
