import { window } from '../../utils'
import { PostHog } from '../../posthog-core'
import { DecideResponse } from '../../types'
import { toErrorProperties } from './error-conversion'

const EXCEPTION_INGESTION_ENDPOINT = '/e/'

export class ExceptionObserver {
    instance: PostHog
    remoteEnabled: boolean | undefined
    private originalOnErrorHandler: typeof window['onerror'] | null | undefined = undefined
    private originalOnUnhandledRejectionHandler: typeof window['onunhandledrejection'] | null | undefined = undefined

    constructor(instance: PostHog) {
        this.instance = instance
    }

    startObservingIfEnabled() {
        if (this.isEnabled()) {
            this.startObserving()
        } else {
            this.stopCapturing()
        }
    }

    startObserving() {
        if ((window.onerror as any)?.__POSTHOG_INSTRUMENTED__) {
            return
        }

        try {
            this.originalOnErrorHandler = window.onerror

            window.onerror = function (
                this: ExceptionObserver,
                ...args: [
                    event: string | Event,
                    source?: string | undefined,
                    lineno?: number | undefined,
                    colno?: number | undefined,
                    error?: Error | undefined
                ]
            ): boolean {
                const errorProperties = toErrorProperties(args)
                if (errorProperties) {
                    this.captureExceptionEvent(errorProperties)
                }
                // TODO: what do we do if we couldn't capture the error?

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
                this.captureExceptionEvent({ wat: 'unhandledrejection', e: args[0] })

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
            delete (window.onerror as any).__POSTHOG_INSTRUMENTED__
        }

        if (this.originalOnUnhandledRejectionHandler !== undefined) {
            window.onunhandledrejection = this.originalOnUnhandledRejectionHandler
            this.originalOnUnhandledRejectionHandler = null
            delete (window.onunhandledrejection as any).__POSTHOG_INSTRUMENTED__
        }
    }

    isCapturing() {
        return !!(window.onerror as any).__POSTHOG_INSTRUMENTED__
    }

    isEnabled() {
        return this.instance.get_config('exception_autocapture') ?? this.remoteEnabled ?? false
    }

    afterDecideResponse(response: DecideResponse) {
        this.remoteEnabled = response.autocaptureExceptions || false
        if (this.isEnabled()) {
            this.startObserving()
        }
    }

    /**
     * :TRICKY: Make sure we batch these requests
     */
    captureExceptionEvent(properties: { [key: string]: any }) {
        this.instance.capture('$exception', properties, {
            transport: 'XHR',
            method: 'POST',
            endpoint: EXCEPTION_INGESTION_ENDPOINT,
            _noTruncate: true,
            _batchKey: 'exceptionEvent',
        })
    }
}
