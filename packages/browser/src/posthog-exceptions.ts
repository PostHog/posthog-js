import { ERROR_TRACKING_CAPTURE_EXTENSION_EXCEPTIONS, ERROR_TRACKING_SUPPRESSION_RULES } from './constants'
import { Extension } from './extensions/types'
import { PostHog } from './posthog-core'
import { CaptureResult, ErrorTrackingSuppressionRule, Properties, RemoteConfigResult } from './types'
import { createLogger } from '@posthog/browser-common/utils/logger'
import {
    addExceptionStep,
    buildErrorPropertiesBuilder,
    getExceptionDrop,
    isStackOverflowError,
    withExceptionContext,
} from '@posthog/browser-common/error-tracking'
import { ErrorTracking } from '@posthog/core'

const logger = /* @__PURE__ */ createLogger('[Error tracking]')

export { buildErrorPropertiesBuilder }

export class PostHogExceptions implements Extension {
    private readonly _instance: PostHog
    private _suppressionRules: ErrorTrackingSuppressionRule[] = []
    private _errorPropertiesBuilder: ErrorTracking.ErrorPropertiesBuilder = buildErrorPropertiesBuilder()
    private _exceptionStepsBuffer: ErrorTracking.ExceptionStepsBuffer
    private _exceptionStepsConfig: ErrorTracking.ResolvedExceptionStepsConfig

    constructor(instance: PostHog) {
        this._instance = instance
        this._suppressionRules = this._instance.persistence?.get_property(ERROR_TRACKING_SUPPRESSION_RULES) ?? []
        this._exceptionStepsConfig = ErrorTracking.resolveExceptionStepsConfig(this._getExceptionStepsConfig())
        this._exceptionStepsBuffer = new ErrorTracking.ExceptionStepsBuffer(this._exceptionStepsConfig)
    }

    onConfigChange() {
        this._exceptionStepsConfig = ErrorTracking.resolveExceptionStepsConfig(this._getExceptionStepsConfig())
        this._exceptionStepsBuffer.setConfig(this._exceptionStepsConfig)
    }

    onRemoteConfig(result: RemoteConfigResult) {
        if (!result.ok) {
            // Failure behaves like a response without an errorTracking key.
            return
        }

        const response = result.config
        if (!('errorTracking' in response)) {
            return
        }

        const suppressionRules = response.errorTracking?.suppressionRules ?? []
        const captureExtensionExceptions = response.errorTracking?.captureExtensionExceptions

        // store this in-memory in case persistence is disabled
        this._suppressionRules = suppressionRules

        if (this._instance.persistence) {
            this._instance.persistence.register({
                [ERROR_TRACKING_SUPPRESSION_RULES]: this._suppressionRules,
                [ERROR_TRACKING_CAPTURE_EXTENSION_EXCEPTIONS]: captureExtensionExceptions,
            })
        }
    }

    private get _captureExtensionExceptions() {
        const enabled_server_side = !!this._instance.get_property(ERROR_TRACKING_CAPTURE_EXTENSION_EXCEPTIONS)
        const enabled_client_side = this._instance.config.error_tracking.captureExtensionExceptions
        return enabled_client_side ?? enabled_server_side ?? false
    }

    buildProperties(
        input: unknown,
        metadata?: { handled?: boolean; syntheticException?: Error }
    ): ErrorTracking.ErrorProperties {
        return this._errorPropertiesBuilder.buildFromUnknown(input, {
            syntheticException: metadata?.syntheticException,
            mechanism: {
                handled: metadata?.handled,
            },
        })
    }

    addExceptionStep(message: string, properties?: Properties): void {
        if (this._exceptionStepsConfig.enabled) {
            addExceptionStep(this._exceptionStepsBuffer, message, properties, logger)
        }
    }

    sendExceptionEvent(properties: Properties): CaptureResult | undefined {
        try {
            const drop = getExceptionDrop(
                properties.$exception_list,
                {
                    suppressionRules: this._suppressionRules,
                    captureExtensionExceptions: this._captureExtensionExceptions,
                    capturePostHogExceptions: !!this._instance.config.error_tracking.__capturePostHogExceptions,
                },
                logger
            )
            if (drop) {
                if (this._exceptionStepsConfig.enabled) {
                    addExceptionStep(this._exceptionStepsBuffer, drop.step, undefined, logger)
                }
                logger.info(drop.log)
                return
            }

            const propertiesForExceptionCapture = withExceptionContext(
                properties,
                this._exceptionStepsConfig.enabled ? this._exceptionStepsBuffer : undefined,
                logger
            )

            try {
                const result = this._instance.capture('$exception', propertiesForExceptionCapture, {
                    _noTruncate: true,
                    _batchKey: 'exceptionEvent',
                    _originatedFromCaptureException: true,
                })

                if (result) {
                    this._exceptionStepsBuffer.clear()
                }

                return result
            } catch (error) {
                if (!isStackOverflowError(error)) {
                    logger.error('Failed to capture exception event. Dropping this exception.', error)
                }
                this._exceptionStepsBuffer.clear()
                return
            }
        } catch (error) {
            if (!isStackOverflowError(error)) {
                logger.error('Failed to process exception event. Ignoring this exception.', error)
            }
            return
        }
    }

    private _getExceptionStepsConfig(): ErrorTracking.ExceptionStepsConfig {
        return this._instance.config.error_tracking?.exception_steps ?? {}
    }
}
