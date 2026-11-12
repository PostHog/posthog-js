import { window } from '@posthog/browser-common/utils/globals'
import { assignableWindow } from '../../utils/globals'
import { PostHog } from '../../posthog-core'
import { RemoteConfigResult } from '../../types'

import { createLogger } from '@posthog/browser-common/utils/logger'
import { addEventListener } from '@posthog/browser-common/utils/general-utils'
import { EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE } from '../../constants'
import { isUndefined, BucketedRateLimiter, isObject, resolveExceptionRateLimiterConfig } from '@posthog/core'
import { ErrorTracking } from '@posthog/core'
import { ExceptionAutoCaptureConfig } from '../../types'

const logger = /* @__PURE__ */ createLogger('[ExceptionAutocapture]')

// Errors are held until exception-autocapture.js loads, capped in case the page throws in a loop.
const MAX_EARLY_EVENTS = 20
const EARLY_EVENT_TYPES = ['error', 'unhandledrejection']

export class ExceptionObserver {
    private _instance: PostHog
    private _rateLimiter: BucketedRateLimiter<string>
    private _remoteEnabled: boolean | undefined
    private _config: Required<ExceptionAutoCaptureConfig>
    private _unwrapOnError: (() => void) | undefined
    private _unwrapUnhandledRejection: (() => void) | undefined
    private _unwrapConsoleError: (() => void) | undefined
    private _earlyEvents: Event[] = []

    constructor(instance: PostHog) {
        this._instance = instance
        this._remoteEnabled = !!this._instance.persistence?.props[EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE]

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
        } else if (isUndefined(providedConfig) ? this._remoteEnabled : providedConfig) {
            config = { ...config, capture_unhandled_errors: true, capture_unhandled_rejections: true }
        }

        return config
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
            // Adding the same listener again is a no-op, so a mid-load restart keeps the buffer.
            EARLY_EVENT_TYPES.forEach((type) => {
                addEventListener(window, type, this._bufferEarlyEvent)
            })
            this._loadScript(this._startCapturing)
        } else {
            this._stopCapturing()
        }
    }

    private _bufferEarlyEvent = (event: Event) => {
        const enabled =
            event.type === 'error' ? this._config.capture_unhandled_errors : this._config.capture_unhandled_rejections
        if (enabled && this._earlyEvents.length < MAX_EARLY_EVENTS) {
            this._earlyEvents.push(event)
        }
    }

    private _loadScript(cb: () => void): void {
        if (assignableWindow.__PosthogExtensions__?.errorWrappingFunctions) {
            // already loaded
            cb()
            return
        }

        assignableWindow.__PosthogExtensions__?.loadExternalDependency?.(
            this._instance,
            'exception-autocapture',
            (err) => {
                if (err) {
                    return logger.error('failed to load script', err)
                }
                cb()
            }
        )
    }

    private _startCapturing = () => {
        // Stop buffering before wrapping, otherwise later errors would be captured twice.
        const earlyEvents = this._earlyEvents
        this._earlyEvents = []
        EARLY_EVENT_TYPES.forEach((type) => {
            window?.removeEventListener(type, this._bufferEarlyEvent)
        })

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

        const exceptions = this._instance.exceptions
        if (!exceptions) {
            return
        }
        earlyEvents.forEach((event) => {
            try {
                this.captureException(exceptions.buildProperties(event, { handled: false }))
            } catch {
                // Exception autocapture must never throw into customer code.
            }
        })
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
            const exceptionType = errorProperties?.$exception_list?.[0]?.type ?? 'Exception'
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
