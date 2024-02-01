import { window } from '../../utils/globals'
import { PostHog } from '../../posthog-core'
import { DecideResponse, Properties } from '../../types'
import { ErrorEventArgs, ErrorProperties, errorToProperties, unhandledRejectionToProperties } from './error-conversion'
import { isPrimitive } from './type-checking'

import { _isArray, _isObject, _isUndefined } from '../../utils/type-utils'
import { logger } from '../../utils/logger'

const EXCEPTION_INGESTION_ENDPOINT = '/e/'

export const extendPostHog = (instance: PostHog, response: DecideResponse) => {
    const exceptionObserver = new ExceptionObserver(instance)
    exceptionObserver.afterDecideResponse(response)
    return exceptionObserver
}

export class ExceptionObserver {
    instance: PostHog
    remoteEnabled: boolean | undefined
    private originalOnErrorHandler: Window['onerror'] | null | undefined = undefined
    private originalOnUnhandledRejectionHandler: Window['onunhandledrejection'] | null | undefined = undefined

    private errorsToIgnore: RegExp[] = []

    constructor(instance: PostHog) {
        this.instance = instance
    }

    startCapturing() {
        if (!window || !this.isEnabled() || (window.onerror as any)?.__POSTHOG_INSTRUMENTED__) {
            return
        }

        try {
            this.originalOnErrorHandler = window.onerror

            window.onerror = function (this: ExceptionObserver, ...args: ErrorEventArgs): boolean {
                this.captureException(args)

                if (this.originalOnErrorHandler) {
                    // eslint-disable-next-line prefer-rest-params
                    return this.originalOnErrorHandler.apply(this, args)
                }

                return false
            }.bind(this)
            ;(window.onerror as any).__POSTHOG_INSTRUMENTED__ = true

            this.originalOnUnhandledRejectionHandler = window.onunhandledrejection

            window.onunhandledrejection = function (
                this: ExceptionObserver,
                ...args: [ev: PromiseRejectionEvent]
            ): boolean {
                const errorProperties: ErrorProperties = unhandledRejectionToProperties(args)
                this.sendExceptionEvent(errorProperties)

                if (window && this.originalOnUnhandledRejectionHandler) {
                    // eslint-disable-next-line prefer-rest-params
                    return this.originalOnUnhandledRejectionHandler.apply(window, args)
                }

                return true
            }.bind(this)
            ;(window.onunhandledrejection as any).__POSTHOG_INSTRUMENTED__ = true
        } catch (e) {
            logger.error('PostHog failed to start exception autocapture', e)
            this.stopCapturing()
        }
    }

    stopCapturing() {
        if (!window) {
            return
        }
        if (!_isUndefined(this.originalOnErrorHandler)) {
            window.onerror = this.originalOnErrorHandler
            this.originalOnErrorHandler = null
        }
        delete (window.onerror as any)?.__POSTHOG_INSTRUMENTED__

        if (!_isUndefined(this.originalOnUnhandledRejectionHandler)) {
            window.onunhandledrejection = this.originalOnUnhandledRejectionHandler
            this.originalOnUnhandledRejectionHandler = null
        }
        delete (window.onunhandledrejection as any)?.__POSTHOG_INSTRUMENTED__
    }

    isCapturing() {
        return !!(window?.onerror as any)?.__POSTHOG_INSTRUMENTED__
    }

    isEnabled() {
        return this.remoteEnabled ?? false
    }

    afterDecideResponse(response: DecideResponse) {
        const autocaptureExceptionsResponse = response.autocaptureExceptions
        this.remoteEnabled = !!autocaptureExceptionsResponse || false
        if (
            !isPrimitive(autocaptureExceptionsResponse) &&
            'errors_to_ignore' in autocaptureExceptionsResponse &&
            _isArray(autocaptureExceptionsResponse.errors_to_ignore)
        ) {
            const dropRules = autocaptureExceptionsResponse.errors_to_ignore

            this.errorsToIgnore = dropRules.map((rule) => {
                return new RegExp(rule)
            })
        }

        if (this.isEnabled()) {
            this.startCapturing()
            logger.info(
                '[Exception Capture] Remote config for exception autocapture is enabled, starting with config: ',
                _isObject(autocaptureExceptionsResponse) ? autocaptureExceptionsResponse : {}
            )
        }
    }

    captureException(args: ErrorEventArgs, properties?: Properties) {
        const errorProperties = errorToProperties(args)

        if (this.errorsToIgnore.some((regex) => regex.test(errorProperties.$exception_message || ''))) {
            logger.info('[Exception Capture] Ignoring exception based on remote config', errorProperties)
            return
        }

        const propertiesToSend = { ...properties, ...errorProperties }

        const posthogHost = this.instance.requestRouter.endpointFor('ui')
        errorProperties.$exception_personURL = posthogHost + '/person/' + this.instance.get_distinct_id()

        this.sendExceptionEvent(propertiesToSend)
    }

    /**
     * :TRICKY: Make sure we batch these requests
     */
    sendExceptionEvent(properties: { [key: string]: any }) {
        this.instance.capture('$exception', properties, {
            method: 'POST',
            endpoint: EXCEPTION_INGESTION_ENDPOINT,
            _noTruncate: true,
            _batchKey: 'exceptionEvent',
        })
    }
}
