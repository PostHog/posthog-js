import { window } from '@posthog/browser-common/utils/globals'
import { assignableWindow } from '../../utils/globals'
import { PostHog } from '../../posthog-core'
import { RemoteConfigResult } from '../../types'

import { createLogger } from '@posthog/browser-common/utils/logger'
import { EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE } from '../../constants'
import { BucketedRateLimiter, ErrorTracking } from '@posthog/core'
import {
    createExceptionRateLimiter,
    exceptionRateLimitKey,
    resolveExceptionAutocaptureConfig,
} from '@posthog/browser-common/error-tracking'
import { ExceptionAutoCaptureConfig } from '../../types'
import { getExtensionLoader } from '../../utils/extension-loader'

const logger = /* @__PURE__ */ createLogger('[ExceptionAutocapture]')

export class ExceptionObserver {
    private _instance: PostHog
    private _rateLimiter: BucketedRateLimiter<string>
    private _remoteEnabled: boolean | undefined
    private _config: Required<ExceptionAutoCaptureConfig>
    private _unwrapOnError: (() => void) | undefined
    private _unwrapUnhandledRejection: (() => void) | undefined
    private _unwrapConsoleError: (() => void) | undefined

    constructor(instance: PostHog) {
        this._instance = instance
        this._remoteEnabled = !!this._instance.persistence?.props[EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE]

        // Burst protection is scoped per exception type. The bucket size and refill rate can be tuned
        // via the `exceptionRateLimiterBucketSize` and `exceptionRateLimiterRefillRate` config options.
        this._rateLimiter = createExceptionRateLimiter(this._instance.config.error_tracking, logger)

        this._config = this._requiredConfig()
        this.startIfEnabledOrStop()
    }

    private _requiredConfig(): Required<ExceptionAutoCaptureConfig> {
        return resolveExceptionAutocaptureConfig(this._instance.config.capture_exceptions, this._remoteEnabled)
    }

    public get isEnabled(): boolean {
        return (
            this._config.capture_console_errors ||
            this._config.capture_unhandled_errors ||
            this._config.capture_unhandled_rejections
        )
    }

    startIfEnabledOrStop(): void {
        if (this.isEnabled) {
            logger.info('enabled')
            this._stopCapturing()
            this._loadScript(this._startCapturing)
        } else {
            this._stopCapturing()
        }
    }

    private _loadScript(cb: () => void): void {
        if (assignableWindow.__PosthogExtensions__?.errorWrappingFunctions) {
            // already loaded
            cb()
            return
        }

        getExtensionLoader(this._instance)?.(this._instance, 'exception-autocapture', (err) => {
            if (err) {
                return logger.error('failed to load script', err)
            }
            cb()
        })
    }

    private _startCapturing = () => {
        if (!window || !this.isEnabled || !assignableWindow.__PosthogExtensions__?.errorWrappingFunctions) {
            return
        }

        const wrapOnError = assignableWindow.__PosthogExtensions__.errorWrappingFunctions.wrapOnError
        const wrapUnhandledRejection =
            assignableWindow.__PosthogExtensions__.errorWrappingFunctions.wrapUnhandledRejection
        const wrapConsoleError = assignableWindow.__PosthogExtensions__.errorWrappingFunctions.wrapConsoleError

        try {
            if (!this._unwrapOnError && this._config.capture_unhandled_errors) {
                this._unwrapOnError = wrapOnError(this.captureException.bind(this))
            }
            if (!this._unwrapUnhandledRejection && this._config.capture_unhandled_rejections) {
                this._unwrapUnhandledRejection = wrapUnhandledRejection(this.captureException.bind(this))
            }
            if (!this._unwrapConsoleError && this._config.capture_console_errors) {
                this._unwrapConsoleError = wrapConsoleError(this.captureException.bind(this))
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

    captureException(errorProperties: ErrorTracking.ErrorProperties) {
        try {
            const exceptionType = exceptionRateLimitKey(errorProperties)
            const isRateLimited = this._rateLimiter.consumeRateLimit(exceptionType)

            if (isRateLimited) {
                logger.info('Skipping exception capture because of client rate limiting.', {
                    exception: exceptionType,
                })
                return
            }

            this._instance.exceptions?.sendExceptionEvent(errorProperties)
        } catch {
            // Exception autocapture must never throw into customer code. Do not log here because
            // console.error may be instrumented and would re-enter this method.
        }
    }
}
