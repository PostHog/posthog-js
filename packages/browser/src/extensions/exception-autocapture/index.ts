import { assignableWindow, window } from '../../utils/globals'
import { PostHog } from '../../posthog-core'
import { ExceptionAutoCaptureConfig, RemoteConfig } from '../../types'

import { createLogger } from '../../utils/logger'
import { EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE } from '../../constants'
import { isUndefined, BucketedRateLimiter, isObject } from '@posthog/core'
import { ErrorProperties } from './error-conversion'

const logger = createLogger('[ExceptionAutocapture]')

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
        this._config = this._requiredConfig()

        // by default captures ten exceptions before rate limiting by exception type
        // refills at a rate of one token / 10 second period
        // e.g. will capture 1 exception rate limited exception every 10 seconds until burst ends
        this._rateLimiter = new BucketedRateLimiter({
            refillRate: this._instance.config.error_tracking.__exceptionRateLimiterRefillRate ?? 1,
            bucketSize: this._instance.config.error_tracking.__exceptionRateLimiterBucketSize ?? 10,
            refillInterval: 10000, // ten seconds in milliseconds,
            _logger: logger,
        })

        this.startIfEnabled()
    }

    private _requiredConfig(): Required<ExceptionAutoCaptureConfig> {
        const providedConfig = this._instance.config.capture_exceptions
        let config = {
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

    startIfEnabled(): void {
        if (this.isEnabled) {
            logger.info('enabled')
            this._loadScript(this._startCapturing)
        }
    }

    private _loadScript(cb: () => void): void {
        if (assignableWindow.__PosthogExtensions__?.errorWrappingFunctions) {
            // already loaded
            cb()
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

    onRemoteConfig(response: RemoteConfig) {
        const autocaptureExceptionsResponse = response.autocaptureExceptions

        // store this in-memory in case persistence is disabled
        this._remoteEnabled = !!autocaptureExceptionsResponse || false
        this._config = this._requiredConfig()

        if (this._instance.persistence) {
            this._instance.persistence.register({
                [EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE]: this._remoteEnabled,
            })
        }

        this.startIfEnabled()
    }

    captureException(errorProperties: ErrorProperties) {
        const posthogHost = this._instance.requestRouter.endpointFor('ui')

        errorProperties.$exception_personURL = `${posthogHost}/project/${
            this._instance.config.token
        }/person/${this._instance.get_distinct_id()}`

        const exceptionType = errorProperties.$exception_list[0].type ?? 'Exception'
        const isRateLimited = this._rateLimiter.consumeRateLimit(exceptionType)

        if (isRateLimited) {
            logger.info('Skipping exception capture because of client rate limiting.', {
                exception: errorProperties.$exception_list[0].type,
            })
            return
        }

        this._instance.exceptions.sendExceptionEvent(errorProperties)
    }
}
