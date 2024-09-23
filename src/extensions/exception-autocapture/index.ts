import { assignableWindow, window } from '../../utils/globals'
import { PostHog } from '../../posthog-core'
import { DecideResponse, Properties } from '../../types'

import { logger } from '../../utils/logger'
import { EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE } from '../../constants'

const LOGGER_PREFIX = '[Exception Autocapture]'

export class ExceptionObserver {
    instance: PostHog
    remoteEnabled: boolean | undefined
    private originalOnUnhandledRejectionHandler: Window['onunhandledrejection'] | null | undefined = undefined
    private unwrapOnError: (() => void) | undefined
    private unwrapUnhandledRejection: (() => void) | undefined

    constructor(instance: PostHog) {
        this.instance = instance
        this.remoteEnabled = !!this.instance.persistence?.props[EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE]

        this.startIfEnabled()
    }

    get isEnabled() {
        return this.remoteEnabled ?? false
    }

    get isCapturing() {
        return !!(window?.onerror as any)?.__POSTHOG_INSTRUMENTED__
    }

    get hasHandlers() {
        return this.originalOnUnhandledRejectionHandler || this.unwrapOnError
    }

    startIfEnabled(): void {
        if (this.isEnabled && !this.isCapturing) {
            logger.info(LOGGER_PREFIX + ' enabled, starting...')
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
                    return logger.error(LOGGER_PREFIX + ' failed to load script', err)
                }
                cb()
            }
        )
    }

    private startCapturing = () => {
        if (!window || !this.isEnabled || this.hasHandlers || this.isCapturing) {
            return
        }

        const wrapOnError = assignableWindow.__PosthogExtensions__?.errorWrappingFunctions?.wrapOnError
        const wrapUnhandledRejection =
            assignableWindow.__PosthogExtensions__?.errorWrappingFunctions?.wrapUnhandledRejection

        if (!wrapOnError || !wrapUnhandledRejection) {
            logger.error(LOGGER_PREFIX + ' failed to load error wrapping functions - cannot start')
            return
        }

        try {
            this.unwrapOnError = wrapOnError(this.captureException.bind(this))
            this.unwrapUnhandledRejection = wrapUnhandledRejection(this.captureException.bind(this))
        } catch (e) {
            logger.error(LOGGER_PREFIX + ' failed to start', e)
            this.stopCapturing()
        }
    }

    private stopCapturing() {
        this.unwrapOnError?.()
        this.unwrapUnhandledRejection?.()
    }

    afterDecideResponse(response: DecideResponse) {
        const autocaptureExceptionsResponse = response.autocaptureExceptions

        // store this in-memory in case persistence is disabled
        this.remoteEnabled = !!autocaptureExceptionsResponse || false

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
