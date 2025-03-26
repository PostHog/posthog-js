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
    private unwrapOnError: (() => void) | undefined
    private unwrapUnhandledRejection: (() => void) | undefined
    private unwrapConsoleError: (() => void) | undefined

    constructor(instance: PostHog) {
        this.instance = instance
        this.remoteEnabled = !!this.instance.persistence?.props[EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE]
        this.config = this.requiredConfig()

        this.startIfEnabled()
    }

    private requiredConfig(): Required<ExceptionAutoCaptureConfig> {
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

    get hasHandlers() {
        return (
            !isUndefined(this.unwrapOnError) &&
            !isUndefined(this.unwrapUnhandledRejection) &&
            !isUndefined(this.unwrapConsoleError)
        )
    }

    startIfEnabled(): void {
        if (this.isEnabled && !this.hasHandlers) {
            logger.info('enabled, starting...')
            this.loadScript(this.startCapturing)
        }
    }

    private loadScript(cb: () => void): void {
        if (this.hasHandlers) {
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

    private startCapturing = () => {
        if (!window || !this.isEnabled) {
            return
        }

        const wrapOnError = assignableWindow.__PosthogExtensions__?.errorWrappingFunctions?.wrapOnError
        const wrapUnhandledRejection =
            assignableWindow.__PosthogExtensions__?.errorWrappingFunctions?.wrapUnhandledRejection
        const wrapConsoleError = assignableWindow.__PosthogExtensions__?.errorWrappingFunctions?.wrapConsoleError

        if (!wrapOnError || !wrapUnhandledRejection || !wrapConsoleError) {
            logger.error('failed to load error wrapping functions - cannot start')
            return
        }

        try {
            if (!this.unwrapOnError) {
                this.unwrapOnError = wrapOnError(this.captureException.bind(this))
            }
            if (!this.unwrapUnhandledRejection) {
                this.unwrapUnhandledRejection = wrapUnhandledRejection(this.captureException.bind(this))
            }
            if (!this.unwrapConsoleError) {
                this.unwrapConsoleError = wrapConsoleError(this.captureException.bind(this))
            }
        } catch (e) {
            logger.error('failed to start', e)
            this.stopCapturing()
        }
    }

    private stopCapturing() {
        this.unwrapOnError?.()
        this.unwrapOnError = undefined

        this.unwrapUnhandledRejection?.()
        this.unwrapUnhandledRejection = undefined

        this.unwrapConsoleError?.()
        this.unwrapConsoleError = undefined
    }

    onRemoteConfig(response: RemoteConfig) {
        const autocaptureExceptionsResponse = response.autocaptureExceptions

        // store this in-memory in case persistence is disabled
        this.remoteEnabled = !!autocaptureExceptionsResponse || false
        this.config = this.requiredConfig()

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
