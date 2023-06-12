import { window } from '../../utils'
import { PostHog } from '../../posthog-core'
import { DecideResponse, Properties } from '../../types'
import { ErrorEventArgs, ErrorProperties, errorToProperties, unhandledRejectionToProperties } from './error-conversion'

const EXCEPTION_INGESTION_ENDPOINT = '/e/'

export class ExceptionObserver {
    instance: PostHog
    remoteEnabled: boolean | undefined
    private originalOnErrorHandler: (typeof window)['onerror'] | null | undefined = undefined
    private originalOnUnhandledRejectionHandler: (typeof window)['onunhandledrejection'] | null | undefined = undefined

    constructor(instance: PostHog) {
        this.instance = instance
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
        this.remoteEnabled = response.autocaptureExceptions || false
        if (this.isEnabled()) {
            this.startCapturing()
        }
    }

    captureException(args: ErrorEventArgs, properties?: Properties) {
        const errorProperties = errorToProperties(args)
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
