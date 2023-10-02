import { window } from '../../utils'
import { PostHog } from '../../posthog-core'
import { DecideResponse, Properties } from '../../types'
import { ErrorEventArgs, ErrorProperties, errorToProperties, unhandledRejectionToProperties } from './error-conversion'
import { isPrimitive } from './type-checking'

const EXCEPTION_INGESTION_ENDPOINT = '/e/'

export class ExceptionObserver {
    instance: PostHog
    remoteEnabled: boolean | undefined
    private originalOnErrorHandler: typeof window['onerror'] | null | undefined = undefined
    private originalOnUnhandledRejectionHandler: typeof window['onunhandledrejection'] | null | undefined = undefined

    private errorsToIgnore: RegExp[] = []

    constructor(instance: PostHog) {
        this.instance = instance
    }

    private debugLog(...args: any[]) {
        if (this.instance.config.debug) {
            console.log('PostHog.js [PostHog.ExceptionObserver]', ...args)
        }
    }

    startCapturing() {
        if (!this.isEnabled() || (window.onerror as any)?.__POSTHOG_INSTRUMENTED__) {
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

                if (this.originalOnUnhandledRejectionHandler) {
                    // eslint-disable-next-line prefer-rest-params
                    return this.originalOnUnhandledRejectionHandler.apply(window, args)
                }

                return true
            }.bind(this)
            ;(window.onunhandledrejection as any).__POSTHOG_INSTRUMENTED__ = true
        } catch (e) {
            console.error('PostHog failed to start exception autocapture', e)
            this.stopCapturing()
        }
    }

    stopCapturing() {
        if (this.originalOnErrorHandler !== undefined) {
            window.onerror = this.originalOnErrorHandler
            this.originalOnErrorHandler = null
        }
        delete (window.onerror as any)?.__POSTHOG_INSTRUMENTED__

        if (this.originalOnUnhandledRejectionHandler !== undefined) {
            window.onunhandledrejection = this.originalOnUnhandledRejectionHandler
            this.originalOnUnhandledRejectionHandler = null
        }
        delete (window.onunhandledrejection as any)?.__POSTHOG_INSTRUMENTED__
    }

    isCapturing() {
        return !!(window.onerror as any)?.__POSTHOG_INSTRUMENTED__
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
            Array.isArray(autocaptureExceptionsResponse.errors_to_ignore)
        ) {
            const dropRules = autocaptureExceptionsResponse.errors_to_ignore

            this.errorsToIgnore = dropRules.map((rule) => {
                return new RegExp(rule)
            })
        }

        if (this.isEnabled()) {
            this.startCapturing()
            this.debugLog('Remote config for exception autocapture is enabled, starting', autocaptureExceptionsResponse)
        } else {
            this.debugLog(
                'Remote config for exception autocapture is disabled, not starting',
                autocaptureExceptionsResponse
            )
        }
    }

    captureException(args: ErrorEventArgs, properties?: Properties) {
        const errorProperties = errorToProperties(args)

        if (this.errorsToIgnore.some((regex) => regex.test(errorProperties.$exception_message || ''))) {
            this.debugLog('Ignoring exception based on remote config', errorProperties)
            return
        }

        const propertiesToSend = { ...properties, ...errorProperties }

        const posthogHost = this.instance.config.ui_host || this.instance.config.api_host
        errorProperties.$exception_personURL = posthogHost + '/person/' + this.instance.get_distinct_id()

        this.sendExceptionEvent(propertiesToSend)
    }

    /**
     * :TRICKY: Make sure we batch these requests
     */
    sendExceptionEvent(properties: { [key: string]: any }) {
        this.instance.capture('$exception', properties, {
            transport: 'XHR',
            method: 'POST',
            endpoint: EXCEPTION_INGESTION_ENDPOINT,
            _noTruncate: true,
            _batchKey: 'exceptionEvent',
        })
    }
}
