import { assignableWindow, window } from '../../utils/globals'
import { PostHog } from '../../posthog-core'
import { Properties, RemoteConfig } from '../../types'

import { createLogger } from '../../utils/logger'
import { EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE } from '../../constants'
import { isBoolean, isUndefined } from '../../utils/type-utils'

const logger = createLogger('[ExceptionAutocapture]')

export class ExceptionObserver {
    instance: PostHog
    remoteEnabled: boolean | undefined
    private unwrapOnError: (() => void) | undefined
    private unwrapUnhandledRejection: (() => void) | undefined

    constructor(instance: PostHog) {
        this.instance = instance
        this.remoteEnabled = !!this.instance.persistence?.props[EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE]

        this.startIfEnabled()
    }

    public get isEnabled(): boolean {
        if (isBoolean(this.instance.config.capture_exceptions)) {
            return this.instance.config.capture_exceptions
        }
        return this.remoteEnabled ?? false
    }

    get hasHandlers() {
        return !isUndefined(this.unwrapOnError)
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
        if (!window || !this.isEnabled || this.hasHandlers) {
            return
        }

        const wrapOnError = assignableWindow.__PosthogExtensions__?.errorWrappingFunctions?.wrapOnError
        const wrapUnhandledRejection =
            assignableWindow.__PosthogExtensions__?.errorWrappingFunctions?.wrapUnhandledRejection

        if (!wrapOnError || !wrapUnhandledRejection) {
            logger.error('failed to load error wrapping functions - cannot start')
            return
        }

        try {
            this.unwrapOnError = wrapOnError(this.captureException.bind(this))
            this.unwrapUnhandledRejection = wrapUnhandledRejection(this.captureException.bind(this))
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
    }

    onRemoteConfig(response: RemoteConfig) {
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
