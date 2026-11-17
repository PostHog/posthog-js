import { window } from '@posthog/browser-common/utils/globals'
import { assignableWindow } from '../../utils/globals'
import { ConsentStatus } from '../../consent'
import posthogErrorWrappingFunctions from './error-wrapping-functions'
import { PostHog } from '../../posthog-core'
import { PostHogConfig, Properties, RemoteConfigResult } from '../../types'

import { createLogger } from '@posthog/browser-common/utils/logger'
import { EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE } from '../../constants'
import { isUndefined, BucketedRateLimiter, isObject, resolveExceptionRateLimiterConfig } from '@posthog/core'
import { ErrorTracking } from '@posthog/core'
import { ExceptionAutoCaptureConfig } from '../../types'

const logger = /* @__PURE__ */ createLogger('[ExceptionAutocapture]')
const MAX_BUFFERED_EXCEPTIONS = 100

type ExceptionCaptureType = keyof ExceptionAutoCaptureConfig

export class ExceptionObserver {
    private _instance: PostHog
    private _rateLimiter: BucketedRateLimiter<string>
    private _remoteEnabled: boolean | undefined
    private _config: Required<ExceptionAutoCaptureConfig>
    private _buffer: {
        properties: ErrorTracking.ErrorProperties
        timestamp: Date
        captureType: ExceptionCaptureType
        capturedProperties: Properties
        consent: ConsentStatus
        cookielessMode: PostHogConfig['cookieless_mode']
    }[] = []
    private _disposed = false
    private _unwrapOnError: (() => void) | undefined
    private _unwrapUnhandledRejection: (() => void) | undefined
    private _unwrapConsoleError: (() => void) | undefined

    constructor(instance: PostHog) {
        this._instance = instance

        // Burst protection is scoped per exception type: captures ten exceptions before rate
        // limiting, then refills at a rate of one token / 10 second period (e.g. captures 1
        // rate-limited exception of that type every 10 seconds until the burst ends). The bucket
        // size and refill rate can be tuned via the `exceptionRateLimiterBucketSize` and
        // `exceptionRateLimiterRefillRate` config options.
        this._rateLimiter = new BucketedRateLimiter({
            ...resolveExceptionRateLimiterConfig(this._instance.config.error_tracking),
            refillInterval: 10000, // ten seconds in milliseconds,
            _logger: logger,
        })

        this._config = this._requiredConfig()
        this.startIfEnabledOrStop()
    }

    private _requiredConfig(): Required<ExceptionAutoCaptureConfig> {
        const providedConfig = this._instance.config.capture_exceptions
        if (
            isUndefined(providedConfig) &&
            isUndefined(this._remoteEnabled) &&
            this._instance._shouldDisableFlags() &&
            !assignableWindow._POSTHOG_REMOTE_CONFIG?.[this._instance.config.token]?.config
        ) {
            this._remoteEnabled = !!this._instance.get_property(EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE)
        }
        let config: Required<ExceptionAutoCaptureConfig> = {
            capture_unhandled_errors: false,
            capture_unhandled_rejections: false,
            capture_console_errors: false,
        }

        if (isObject(providedConfig)) {
            config = { ...config, ...providedConfig }
        } else if (isUndefined(providedConfig) ? this._remoteEnabled !== false : providedConfig) {
            config = { ...config, capture_unhandled_errors: true, capture_unhandled_rejections: true }
        }

        return config
    }

    public get isEnabled(): boolean {
        return (
            !this._disposed &&
            (this._config.capture_console_errors ||
                this._config.capture_unhandled_errors ||
                this._config.capture_unhandled_rejections)
        )
    }

    startIfEnabledOrStop(): void {
        if (this.isEnabled) {
            logger.info('enabled')
            this._startCapturing()
            while (this._buffer.length && this.isEnabled && !this._isWaitingForRemoteConfig()) {
                const pending = this._buffer.shift()!
                if (
                    pending.consent === this._instance.consent.consent &&
                    pending.cookielessMode === this._instance.config.cookieless_mode
                ) {
                    this.captureException(
                        pending.properties,
                        pending.captureType,
                        pending.timestamp,
                        pending.capturedProperties
                    )
                }
            }
        } else {
            this._stopCapturing()
            this.reset()
        }
    }

    private _isWaitingForRemoteConfig(): boolean {
        return isUndefined(this._instance.config.capture_exceptions) && isUndefined(this._remoteEnabled)
    }

    reset(): void {
        this._buffer = []
    }

    dispose(): void {
        this._disposed = true
        this._stopCapturing()
        this.reset()
    }

    private _startCapturing = () => {
        if (!window || !this.isEnabled) {
            return
        }

        const { wrapOnError, wrapUnhandledRejection, wrapConsoleError } = posthogErrorWrappingFunctions

        try {
            // Re-wrap the current handlers in case application code replaced them after init.
            this._stopCapturing()
            if (this._config.capture_unhandled_errors) {
                this._unwrapOnError = wrapOnError((properties) =>
                    this.captureException(properties, 'capture_unhandled_errors')
                )
            }
            if (this._config.capture_unhandled_rejections) {
                this._unwrapUnhandledRejection = wrapUnhandledRejection((properties) =>
                    this.captureException(properties, 'capture_unhandled_rejections')
                )
            }
            if (this._config.capture_console_errors) {
                this._unwrapConsoleError = wrapConsoleError((properties) =>
                    this.captureException(properties, 'capture_console_errors')
                )
            }
        } catch (e) {
            logger.error('failed to start', e)
            this._stopCapturing()
        }
    }

    private _stopCapturing() {
        this._unwrapOnError?.()
        this._unwrapOnError = undefined

        this._unwrapUnhandledRejection?.()
        this._unwrapUnhandledRejection = undefined

        this._unwrapConsoleError?.()
        this._unwrapConsoleError = undefined
    }

    onRemoteConfig(result: RemoteConfigResult) {
        if (result.ok && 'autocaptureExceptions' in result.config) {
            // Store this in memory too, in case persistence is disabled.
            this._remoteEnabled = !!result.config.autocaptureExceptions
            this._instance.persistence?.register({
                [EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE]: this._remoteEnabled,
            })
        } else if (isUndefined(this._remoteEnabled)) {
            // A completed request without enablement must not leave startup events waiting forever.
            this._remoteEnabled = !!this._instance.get_property(EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE)
        }

        this._config = this._requiredConfig()
        this.startIfEnabledOrStop()
    }

    onConfigChange(config: Partial<PostHogConfig> = {}) {
        if (
            [
                'property_denylist',
                'sanitize_properties',
                'mask_personal_data_properties',
                'custom_personal_data_properties',
                'disable_capture_url_hashes',
            ].some((key) => key in config)
        ) {
            this.reset()
        }
        this._config = this._requiredConfig()
    }

    captureException(
        errorProperties: ErrorTracking.ErrorProperties,
        captureType: ExceptionCaptureType = 'capture_unhandled_errors',
        timestamp?: Date,
        capturedProperties?: Properties
    ) {
        try {
            if (!this._instance.is_capturing()) {
                this.reset()
                return
            }
            if (!this.isEnabled || !this._config[captureType]) {
                return
            }
            if (this._isWaitingForRemoteConfig()) {
                if (this._buffer.length < MAX_BUFFERED_EXCEPTIONS) {
                    const occurredAt = timestamp ?? new Date()
                    const properties = this._instance.exceptions?.prepareExceptionProperties(
                        errorProperties,
                        occurredAt
                    )
                    if (properties) {
                        this._buffer.push({
                            properties: errorProperties,
                            capturedProperties: properties,
                            timestamp: occurredAt,
                            captureType,
                            consent: this._instance.consent.consent,
                            cookielessMode: this._instance.config.cookieless_mode,
                        })
                    }
                }
                return
            }

            const exceptionType = errorProperties?.$exception_list?.[0]?.type ?? 'Exception'
            const isRateLimited = this._rateLimiter.consumeRateLimit(exceptionType)

            if (isRateLimited) {
                logger.info('Skipping exception capture because of client rate limiting.', {
                    exception: exceptionType,
                })
                return
            }

            this._instance.exceptions?.sendExceptionEvent(errorProperties, timestamp, capturedProperties)
        } catch {
            // Exception autocapture must never throw into customer code. Do not log here because
            // console.error may be instrumented and would re-enter this method.
        }
    }
}
