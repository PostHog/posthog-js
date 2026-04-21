import { ERROR_TRACKING_CAPTURE_EXTENSION_EXCEPTIONS, ERROR_TRACKING_SUPPRESSION_RULES } from './constants'
import { Extension } from './extensions/types'
import { PostHog } from './posthog-core'
import { CaptureResult, ErrorTrackingSuppressionRule, Properties, RemoteConfig } from './types'
import { createLogger } from './utils/logger'
import { propertyComparisons } from './utils/property-utils'
import { isString, isArray, isObject, ErrorTracking, isNullish } from '@posthog/core'

const logger = createLogger('[Error tracking]')

export function buildErrorPropertiesBuilder() {
    return new ErrorTracking.ErrorPropertiesBuilder(
        [
            new ErrorTracking.DOMExceptionCoercer(),
            new ErrorTracking.PromiseRejectionEventCoercer(),
            new ErrorTracking.ErrorEventCoercer(),
            new ErrorTracking.ErrorCoercer(),
            new ErrorTracking.EventCoercer(),
            new ErrorTracking.ObjectCoercer(),
            new ErrorTracking.StringCoercer(),
            new ErrorTracking.PrimitiveCoercer(),
        ],
        ErrorTracking.createDefaultStackParser()
    )
}
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

    onRemoteConfig(response: RemoteConfig) {
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
        if (!this._exceptionStepsConfig.enabled) {
            return
        }

        try {
            if (!isString(message) || message.trim().length === 0) {
                logger.warn('Ignoring exception step because message must be a non-empty string')
                return
            }

            const userProperties = this._coerceExceptionStepProperties(properties)

            const { sanitizedProperties, droppedKeys } = ErrorTracking.stripReservedExceptionStepFields(userProperties)

            if (droppedKeys.length > 0) {
                logger.warn('Ignoring reserved exception step fields', { droppedKeys })
            }

            this._exceptionStepsBuffer.add({
                [ErrorTracking.EXCEPTION_STEP_INTERNAL_FIELDS.MESSAGE]: message,
                [ErrorTracking.EXCEPTION_STEP_INTERNAL_FIELDS.TIMESTAMP]: new Date().toISOString(),
                ...sanitizedProperties,
            })
        } catch (error) {
            logger.error('Failed to add exception step. Ignoring breadcrumb.', error)
        }
    }

    sendExceptionEvent(properties: Properties): CaptureResult | undefined {
        try {
            const exceptionList = properties.$exception_list

            if (this._isExceptionList(exceptionList)) {
                if (this._matchesSuppressionRule(exceptionList)) {
                    this._addDroppedExceptionStep('Exception dropped: matched a suppression rule')
                    logger.info('Skipping exception capture because a suppression rule matched')
                    return
                }

                if (!this._captureExtensionExceptions && this._isExtensionException(exceptionList)) {
                    this._addDroppedExceptionStep('Exception dropped: thrown by a browser extension')
                    logger.info('Skipping exception capture because it was thrown by an extension')
                    return
                }

                if (
                    !this._instance.config.error_tracking.__capturePostHogExceptions &&
                    this._isPostHogException(exceptionList)
                ) {
                    this._addDroppedExceptionStep('Exception dropped: thrown by the PostHog SDK')
                    logger.info('Skipping exception capture because it was thrown by the PostHog SDK')
                    return
                }
            }

            const propertiesForExceptionCapture =
                this._exceptionStepsConfig.enabled && isNullish(properties.$exception_steps)
                    ? this._addBufferedExceptionSteps(properties)
                    : properties

            try {
                return this._instance.capture('$exception', propertiesForExceptionCapture, {
                    _noTruncate: true,
                    _batchKey: 'exceptionEvent',
                    _originatedFromCaptureException: true,
                })
            } catch (error) {
                logger.error('Failed to capture exception event. Dropping this exception.', error)
                return
            } finally {
                this._exceptionStepsBuffer.clear()
            }
        } catch (error) {
            logger.error('Failed to process exception event. Ignoring this exception.', error)
            return
        }
    }

    private _addBufferedExceptionSteps(properties: Properties): Properties {
        try {
            const exceptionSteps = this._exceptionStepsBuffer.getAttachable()

            if (exceptionSteps.length === 0) {
                return properties
            }

            return {
                ...properties,
                $exception_steps: exceptionSteps,
            }
        } catch (error) {
            logger.error('Failed to read buffered exception steps. Capturing exception without steps.', error)
            return properties
        }
    }

    private _addDroppedExceptionStep(message: string): void {
        if (this._exceptionStepsConfig.enabled) {
            this._exceptionStepsBuffer.add({
                [ErrorTracking.EXCEPTION_STEP_INTERNAL_FIELDS.MESSAGE]: message,
                [ErrorTracking.EXCEPTION_STEP_INTERNAL_FIELDS.TIMESTAMP]: new Date().toISOString(),
            })
        }
    }

    private _coerceExceptionStepProperties(properties?: Properties): Record<string, unknown> {
        if (!isObject(properties)) {
            return {}
        }

        return { ...(properties as Record<string, unknown>) }
    }

    private _getExceptionStepsConfig(): ErrorTracking.ExceptionStepsConfig {
        return this._instance.config.error_tracking?.exception_steps ?? {}
    }

    private _matchesSuppressionRule(exceptionList: ErrorTracking.ExceptionList): boolean {
        if (exceptionList.length === 0) {
            return false
        }

        const exceptionValues = exceptionList.reduce(
            (acc, { type, value }) => {
                if (isString(type) && type.length > 0) {
                    acc['$exception_types'].push(type)
                }
                if (isString(value) && value.length > 0) {
                    acc['$exception_values'].push(value)
                }
                return acc
            },
            {
                $exception_types: [] as string[],
                $exception_values: [] as string[],
            }
        )

        return this._suppressionRules.some((rule) => {
            const results = rule.values.map((v) => {
                const compare = propertyComparisons[v.operator]
                const targets = isArray(v.value) ? v.value : [v.value]
                const values = exceptionValues[v.key] ?? []
                return targets.length > 0 ? compare(targets, values) : false
            })
            return rule.type === 'OR' ? results.some(Boolean) : results.every(Boolean)
        })
    }

    private _isExtensionException(exceptionList: ErrorTracking.ExceptionList): boolean {
        const frames = exceptionList.flatMap((e) => e.stacktrace?.frames ?? [])
        return frames.some((f) => f.filename && f.filename.startsWith('chrome-extension://'))
    }

    private _isPostHogException(exceptionList: ErrorTracking.ExceptionList): boolean {
        if (exceptionList.length > 0) {
            const exception = exceptionList[0]
            const frames = exception.stacktrace?.frames ?? []
            const lastFrame = frames[frames.length - 1]
            return lastFrame?.filename?.includes('posthog.com/static') ?? false
        }

        return false
    }

    private _isExceptionList(candidate: unknown): candidate is ErrorTracking.ExceptionList {
        return !isNullish(candidate) && isArray(candidate)
    }
}
