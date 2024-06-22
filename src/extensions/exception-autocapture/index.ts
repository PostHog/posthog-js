import { window } from '../../utils/globals'
import { PostHog } from '../../posthog-core'
import { DecideResponse, ErrorConversions, ErrorEventArgs, ErrorProperties } from '../../types'

import { isObject, isUndefined } from '../../utils/type-utils'
import { logger } from '../../utils/logger'
import { EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE, EXCEPTION_CAPTURE_ENDPOINT } from '../../constants'
import { loadScript } from '../../utils'
import Config from '../../config'

// TODO: move this to /x/ as default
const BASE_ENDPOINT = '/e/'
const LOGGER_PREFIX = '[Exception Capture]'

export class ExceptionObserver {
    private _endpoint: string = BASE_ENDPOINT
    instance: PostHog
    remoteEnabled: boolean | undefined
    private originalOnErrorHandler: Window['onerror'] | null | undefined = undefined
    private originalOnUnhandledRejectionHandler: Window['onunhandledrejection'] | null | undefined = undefined

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
        return this.originalOnUnhandledRejectionHandler || this.originalOnErrorHandler
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

        loadScript(
            this.instance.requestRouter.endpointFor(
                'assets',
                `/static/exception-autocapture.js?v=${Config.LIB_VERSION}`
            ),
            (err) => {
                if (err) {
                    logger.error(LOGGER_PREFIX + ' failed to load script', err)
                }
                cb()
            }
        )
    }

    private startCapturing = () => {
        if (!window || !this.isEnabled || this.hasHandlers || (window.onerror as any)?.__POSTHOG_INSTRUMENTED__) {
            return
        }

        if (!(window as any).posthogErrorConversion) {
            logger.error(LOGGER_PREFIX + ' failed to load error conversion scripts - error capture cannot start')
            return
        }

        const { errorToProperties, unhandledRejectionToProperties } = (window as any)
            .posthogErrorConversion as ErrorConversions

        try {
            this.originalOnErrorHandler = window.onerror

            window.onerror = function (this: ExceptionObserver, ...args: ErrorEventArgs): boolean {
                this.captureException(args, errorToProperties)

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

    private stopCapturing() {
        if (!window) {
            return
        }
        if (!isUndefined(this.originalOnErrorHandler)) {
            window.onerror = this.originalOnErrorHandler
            this.originalOnErrorHandler = null
        }
        delete (window.onerror as any)?.__POSTHOG_INSTRUMENTED__

        if (!isUndefined(this.originalOnUnhandledRejectionHandler)) {
            window.onunhandledrejection = this.originalOnUnhandledRejectionHandler
            this.originalOnUnhandledRejectionHandler = null
        }
        delete (window.onunhandledrejection as any)?.__POSTHOG_INSTRUMENTED__
    }

    afterDecideResponse(response: DecideResponse) {
        const autocaptureExceptionsResponse = response.autocaptureExceptions

        // store this in-memory in case persistence is disabled
        this.remoteEnabled = !!autocaptureExceptionsResponse || false
        this._endpoint = isObject(autocaptureExceptionsResponse)
            ? autocaptureExceptionsResponse.endpoint || BASE_ENDPOINT
            : BASE_ENDPOINT

        if (this.instance.persistence) {
            this.instance.persistence.register({
                [EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE]: this.remoteEnabled,
            })
            // when we come to moving the endpoint to not /e/ we'll want that to persist between startup and decide response
            // TODO: once BASE_ENDPOINT is no longer /e/ this can be removed
            this.instance.persistence.register({
                [EXCEPTION_CAPTURE_ENDPOINT]: this._endpoint,
            })
        }

        this.startIfEnabled()
    }

    captureException(args: ErrorEventArgs, errorToProperties: ErrorConversions['errorToProperties']) {
        const errorProperties = errorToProperties(args)

        const posthogHost = this.instance.requestRouter.endpointFor('ui')

        errorProperties.$exception_personURL = `${posthogHost}/project/${
            this.instance.config.token
        }/person/${this.instance.get_distinct_id()}`

        this.sendExceptionEvent(errorProperties)
    }

    /**
     * :TRICKY: Make sure we batch these requests
     */
    sendExceptionEvent(properties: { [key: string]: any }) {
        this.instance.capture('$exception', properties, {
            _noTruncate: true,
            _batchKey: 'exceptionEvent',
            _noHeatmaps: true,
            _url: this._endpoint,
        })
    }
}
