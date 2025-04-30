import { assignableWindow, window } from '../../utils/globals'
import { PostHog } from '../../posthog-core'
import { ExceptionAutoCaptureConfig, Properties, RemoteConfig } from '../../types'

import { createLogger } from '../../utils/logger'
import { EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE } from '../../constants'
import { isObject, isUndefined } from '../../utils/type-utils'

const logger = createLogger('[ExceptionAutocapture]')

export class ExceptionObserver {
    instance: PostHog
    remoteEnabled: boolean | undefined
    config: Required<ExceptionAutoCaptureConfig>
    private _unwrapOnError: (() => void) | undefined
    private _unwrapUnhandledRejection: (() => void) | undefined
    private _unwrapConsoleError: (() => void) | undefined

    constructor(instance: PostHog) {
        this.instance = instance
        this.remoteEnabled = !!this.instance.persistence?.props[EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE]
        this.config = this._requiredConfig()

        this.startIfEnabled()
    }

    private _requiredConfig(): Required<ExceptionAutoCaptureConfig> {
        const providedConfig = this.instance.config.capture_exceptions
        let config = {
            capture_unhandled_errors: false,
            capture_unhandled_rejections: false,
            capture_console_errors: false,
        }

        if (isObject(providedConfig)) {
            config = { ...config, ...providedConfig }
        } else if (isUndefined(providedConfig) ? this.remoteEnabled : providedConfig) {
            config = { ...config, capture_unhandled_errors: true, capture_unhandled_rejections: true }
        }

        return config
    }

    public get isEnabled(): boolean {
        return (
            this.config.capture_console_errors ||
            this.config.capture_unhandled_errors ||
            this.config.capture_unhandled_rejections
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
            this.instance,
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
            if (!this._unwrapOnError && this.config.capture_unhandled_errors) {
                this._unwrapOnError = wrapOnError(this.captureException.bind(this))
            }
            if (!this._unwrapUnhandledRejection && this.config.capture_unhandled_rejections) {
                this._unwrapUnhandledRejection = wrapUnhandledRejection(this.captureException.bind(this))
            }
            if (!this._unwrapConsoleError && this.config.capture_console_errors) {
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
        this.remoteEnabled = !!autocaptureExceptionsResponse || false
        this.config = this._requiredConfig()

        if (this.instance.persistence) {
            this.instance.persistence.register({
                [EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE]: this.remoteEnabled,
            })
        }

        this.startIfEnabled()
    }

    captureException(errorProperties: Properties) {
        const posthogHost = this.instance.requestRouter.endpointFor('ui')

        errorProperties.$exception_personURL = `${posthogHost}/project/${
            this.instance.config.token
        }/person/${this.instance.get_distinct_id()}`

        this.instance.exceptions.sendExceptionEvent(errorProperties)
    }
}
