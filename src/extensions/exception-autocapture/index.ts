import { window } from '../../utils/globals'
import { PostHog } from '../../posthog-core'
import { DecideResponse, Properties } from '../../types'

import { isObject } from '../../utils/type-utils'
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

        const wrapOnError = (window as any).posthogErrorHandlers.wrapOnError
        const wrapUnhandledRejection = (window as any).posthogErrorHandlers.wrapUnhandledRejection

        if (!wrapOnError || !wrapUnhandledRejection) {
            logger.error(LOGGER_PREFIX + ' failed to load error wrapping functions - cannot start')
            return
        }

        try {
            this.unwrapOnError = wrapOnError(this.captureException.bind(this))
            this.unwrapUnhandledRejection = wrapUnhandledRejection(this.captureException.bind(this))
        } catch (e) {
            logger.error(LOGGER_PREFIX + 'PostHog failed to start', e)
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

    captureException(errorProperties: Properties) {
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
