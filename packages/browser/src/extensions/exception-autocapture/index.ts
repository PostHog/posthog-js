import { window } from '@posthog/browser-common/utils/globals'
import posthogErrorWrappingFunctions from './error-wrapping-functions'
import { PostHog } from '../../posthog-core'
import { RemoteConfigResult } from '../../types'

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
                this.captureException(pending.properties, pending.captureType, pending.timestamp)
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
            if (!this._config.capture_unhandled_errors) {
                this._unwrapOnError?.()
                this._unwrapOnError = undefined
            } else if (!this._unwrapOnError) {
                this._unwrapOnError = wrapOnError((properties) =>
                    this.captureException(properties, 'capture_unhandled_errors')
                )
            }
            if (!this._config.capture_unhandled_rejections) {
                this._unwrapUnhandledRejection?.()
                this._unwrapUnhandledRejection = undefined
            } else if (!this._unwrapUnhandledRejection) {
                this._unwrapUnhandledRejection = wrapUnhandledRejection((properties) =>
                    this.captureException(properties, 'capture_unhandled_rejections')
                )
            }
            if (!this._config.capture_console_errors) {
                this._unwrapConsoleError?.()
                this._unwrapConsoleError = undefined
            } else if (!this._unwrapConsoleError) {
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
        if (!result.ok) {
            // Failure behaves like a response without an autocaptureExceptions key.
            return
        }

        const response = result.config
        if (!('autocaptureExceptions' in response)) {
            return
        }

        const autocaptureExceptionsResponse = response.autocaptureExceptions

        // store this in-memory in case persistence is disabled
        this._remoteEnabled = !!autocaptureExceptionsResponse || false

        if (this._instance.persistence) {
            this._instance.persistence.register({
                [EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE]: this._remoteEnabled,
            })
        }

        this._config = this._requiredConfig()
        this.startIfEnabledOrStop()
    }

    onConfigChange() {
        this._config = this._requiredConfig()
    }

    captureException(
        errorProperties: ErrorTracking.ErrorProperties,
        captureType: ExceptionCaptureType = 'capture_unhandled_errors',
        timestamp?: Date
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
                    this._buffer.push({ properties: errorProperties, timestamp: timestamp ?? new Date(), captureType })
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

            this._instance.exceptions?.sendExceptionEvent(errorProperties, timestamp)
        } catch {
            // Exception autocapture must never throw into customer code. Do not log here because
            // console.error may be instrumented and would re-enter this method.
        }
    }
}
