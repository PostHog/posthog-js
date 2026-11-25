import type { Logger } from '@posthog/core'
// Exact subpaths keep the unrelated root barrel out of lazily loaded error tracking chunks.
import * as ErrorTracking from '@posthog/core/error-tracking'
import {
    BucketedRateLimiter,
    isArray,
    isError,
    isNullish,
    isObject,
    isString,
    isUndefined,
    resolveExceptionRateLimiterConfig,
} from '@posthog/core/utils'
import { propertyComparisons } from '@posthog/core/surveys'
import type { ExceptionAutoCaptureConfig, ExceptionRateLimiterConfig } from '@posthog/types'
import type { ErrorTrackingSuppressionRule } from './types/remote-config'

type ExceptionLogger = Pick<Logger, 'warn' | 'error'>

/** Persisted remote suppression rules. */
export const ERROR_TRACKING_SUPPRESSION_RULES = '$error_tracking_suppression_rules'
/** Persisted remote decision to capture browser extension exceptions. */
export const ERROR_TRACKING_CAPTURE_EXTENSION_EXCEPTIONS = '$error_tracking_capture_extension_exceptions'

// Safari masks the URL of extension content scripts as `webkit-masked-url://hidden/`. It masks
// some of the page's own scripts the same way, so a masked frame alone does not prove the
// exception came from an extension (see isExtensionException).
const MASKED_URL_PREFIX = 'webkit-masked-url:'

const MASKED_EXTENSION_EXCEPTION_VALUE = [
    { value: 'isolatedAPI.contexts.topHostname', exact: false },
    { value: 'No response from target', exact: true },
]

// Browser extensions serve their content scripts from these schemes. `safari-extension:` and
// `safari-web-extension:` are synthesised by the stack parser (see extractSafariExtensionDetails)
// rather than being real URLs, but they mark the frame just as definitively.
const EXTENSION_URL_PREFIXES = [
    'chrome-extension://',
    'moz-extension://',
    'safari-extension:',
    'safari-web-extension:',
    MASKED_URL_PREFIX,
]

// Some mobile browsers inject their own user scripts into every page. These scripts read
// browser-private globals, and when a script runs before its global exists it throws. The
// browser attributes the injected script to the host document, so the frame filename is the
// page URL and EXTENSION_URL_PREFIXES cannot catch it. We match the private global in the
// exception value instead. No page or SDK code references these names.
const INJECTED_BROWSER_SCRIPT_GLOBALS = ['__firefox__', '__gCrWeb']

/** Creates the browser error properties builder: coercers for browser error shapes plus the default stack parser. */
export function buildErrorPropertiesBuilder(): ErrorTracking.ErrorPropertiesBuilder {
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

export const isStackOverflowError = (error: unknown): boolean =>
    isError(error) &&
    ((error.name === 'RangeError' && error.message.indexOf('Maximum call stack size exceeded') === 0) ||
        (error.name === 'InternalError' && error.message === 'too much recursion'))

/**
 * Resolves which automatic exception sources are enabled. An explicit boolean or object wins;
 * otherwise the remote setting enables unhandled errors and rejections.
 */
export function resolveExceptionAutocaptureConfig(
    provided: boolean | ExceptionAutoCaptureConfig | undefined,
    remoteEnabled: boolean | undefined
): Required<ExceptionAutoCaptureConfig> {
    const config: Required<ExceptionAutoCaptureConfig> = {
        capture_unhandled_errors: false,
        capture_unhandled_rejections: false,
        capture_console_errors: false,
    }
    if (isObject(provided)) {
        return { ...config, ...(provided as ExceptionAutoCaptureConfig) }
    }
    if (isUndefined(provided) ? remoteEnabled : provided) {
        return { ...config, capture_unhandled_errors: true, capture_unhandled_rejections: true }
    }
    return config
}

/**
 * Burst protection for automatically captured exceptions, scoped per exception type. The exception
 * that empties a type's bucket is limited, so a bucket of ten admits nine exceptions in a burst;
 * then `refillRate` tokens refill every ten seconds.
 */
export function createExceptionRateLimiter(
    config: ExceptionRateLimiterConfig | undefined,
    logger: Logger
): BucketedRateLimiter<string> {
    return new BucketedRateLimiter<string>({
        ...resolveExceptionRateLimiterConfig(config),
        refillInterval: 10000,
        _logger: logger,
    })
}

/** The rate-limit key of an exception: the type of its outermost exception. */
export const exceptionRateLimitKey = (properties: ErrorTracking.ErrorProperties | undefined): string =>
    properties?.$exception_list?.[0]?.type ?? 'Exception'

export interface ExceptionFilterOptions {
    readonly suppressionRules: readonly ErrorTrackingSuppressionRule[]
    readonly captureExtensionExceptions: boolean
    readonly capturePostHogExceptions: boolean
}

/** Why an exception is dropped before capture: the exception step recorded and the diagnostic logged. */
export interface ExceptionDrop {
    readonly step: string
    readonly log: string
}

/** Returns why an exception list must not be captured, or undefined when it may be captured. */
export function getExceptionDrop(
    exceptionList: unknown,
    options: ExceptionFilterOptions,
    logger: ExceptionLogger
): ExceptionDrop | undefined {
    if (isNullish(exceptionList) || !isArray(exceptionList)) {
        return undefined
    }
    const list = exceptionList as ErrorTracking.ExceptionList
    if (matchesSuppressionRule(list, options.suppressionRules, logger)) {
        return {
            step: 'Exception dropped: matched a suppression rule',
            log: 'Skipping exception capture because a suppression rule matched',
        }
    }
    if (!options.captureExtensionExceptions && isExtensionException(list)) {
        return {
            step: 'Exception dropped: thrown by a browser extension',
            log: 'Skipping exception capture because it was thrown by an extension',
        }
    }
    if (!options.captureExtensionExceptions && isInjectedBrowserScriptException(list)) {
        return {
            step: 'Exception dropped: thrown by an injected browser script',
            log: 'Skipping exception capture because it was thrown by an injected browser script',
        }
    }
    if (!options.capturePostHogExceptions && isPostHogException(list)) {
        return {
            step: 'Exception dropped: thrown by the PostHog SDK',
            log: 'Skipping exception capture because it was thrown by the PostHog SDK',
        }
    }
    return undefined
}

/** Creates the exception steps buffer, or returns undefined when exception steps are disabled. */
export function createExceptionStepsBuffer(
    config: ErrorTracking.ExceptionStepsConfig | undefined
): ErrorTracking.ExceptionStepsBuffer | undefined {
    const resolved = ErrorTracking.resolveExceptionStepsConfig(config)
    return resolved.enabled ? new ErrorTracking.ExceptionStepsBuffer(resolved) : undefined
}

/** Records one exception step, ignoring invalid messages and reserved fields. Never throws. */
export function addExceptionStep(
    buffer: ErrorTracking.ExceptionStepsBuffer,
    message: unknown,
    properties: unknown,
    logger: ExceptionLogger
): void {
    try {
        if (!isString(message) || message.trim().length === 0) {
            logger.warn('Ignoring exception step because message must be a non-empty string')
            return
        }

        const userProperties = isObject(properties) ? { ...(properties as Record<string, unknown>) } : {}
        const { sanitizedProperties, droppedKeys } = ErrorTracking.stripReservedExceptionStepFields(userProperties)

        if (droppedKeys.length > 0) {
            logger.warn('Ignoring reserved exception step fields', { droppedKeys })
        }

        buffer.add({
            [ErrorTracking.EXCEPTION_STEP_INTERNAL_FIELDS.MESSAGE]: message,
            [ErrorTracking.EXCEPTION_STEP_INTERNAL_FIELDS.TIMESTAMP]: new Date().toISOString(),
            ...sanitizedProperties,
        })
    } catch (error) {
        logger.error('Failed to add exception step. Ignoring breadcrumb.', error)
    }
}

/**
 * Adds buffered exception steps when the caller supplied none, and the injected release ID.
 * Pass no buffer when exception steps are disabled.
 */
export function withExceptionContext<T extends Record<string, any>>(
    properties: T,
    buffer: ErrorTracking.ExceptionStepsBuffer | undefined,
    logger: ExceptionLogger
): T {
    let result = properties
    if (buffer && isNullish(properties.$exception_steps)) {
        try {
            const exceptionSteps = buffer.getAttachable()
            if (exceptionSteps.length > 0) {
                result = { ...properties, $exception_steps: exceptionSteps }
            }
        } catch (error) {
            logger.error('Failed to read buffered exception steps. Capturing exception without steps.', error)
        }
    }

    const injectedReleaseId = ErrorTracking.getInjectedReleaseId()
    return injectedReleaseId ? { ...result, $release_id: injectedReleaseId } : result
}

function matchesSuppressionRule(
    exceptionList: ErrorTracking.ExceptionList,
    suppressionRules: readonly ErrorTrackingSuppressionRule[],
    logger: ExceptionLogger
): boolean {
    if (exceptionList.length === 0) {
        return false
    }

    try {
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

        return suppressionRules.some((rule) => {
            const results = rule.values.map((v) => {
                const compare: ((targets: string[], values: string[]) => boolean) | undefined =
                    propertyComparisons[v.operator]
                const values: string[] | undefined = exceptionValues[v.key]

                if (!compare || !values) {
                    return false
                }

                const targets = isArray(v.value) ? v.value : [v.value]
                return targets.length > 0 ? compare(targets, values) : false
            })
            return rule.type === 'OR' ? results.some(Boolean) : results.every(Boolean)
        })
    } catch (error) {
        // Suppression only ever filters what we capture, so failing to evaluate it must not cost
        // us the exception.
        logger.warn('Failed to evaluate suppression rules. Capturing the exception.', error)
        return false
    }
}

function isExtensionException(exceptionList: ErrorTracking.ExceptionList): boolean {
    const frames = exceptionList.flatMap((e) => e.stacktrace?.frames ?? [])
    const extensionFrames = frames.filter(
        ({ filename }) => !!filename && EXTENSION_URL_PREFIXES.some((prefix) => filename.startsWith(prefix))
    )
    if (extensionFrames.length === 0) {
        return false
    }

    // Safari also masks blob, eval'd, and injected application code, so a masked URL alone does
    // not prove the exception came from an extension. For an all-masked stack, require a known
    // extension-only signature and no remaining page frame. Ignore masked frames when checking
    // for page code because the Sentry integration may forward them with `in_app: true`.
    const onlyMaskedExtensionFrames = extensionFrames.every(
        ({ filename }) => !!filename && filename.startsWith(MASKED_URL_PREFIX)
    )
    if (onlyMaskedExtensionFrames) {
        const hasKnownExtensionSignature = exceptionList.some(
            ({ type, value }) =>
                type === 'NoResponse' ||
                (isString(value) &&
                    MASKED_EXTENSION_EXCEPTION_VALUE.some(({ value: signature, exact }) =>
                        exact ? value === signature : value.includes(signature)
                    ))
        )
        return (
            hasKnownExtensionSignature &&
            !frames.some(({ in_app, filename }) => in_app && !filename?.startsWith(MASKED_URL_PREFIX))
        )
    }

    return true
}

function isInjectedBrowserScriptException(exceptionList: ErrorTracking.ExceptionList): boolean {
    return exceptionList.some(({ value }) => {
        return isString(value) && INJECTED_BROWSER_SCRIPT_GLOBALS.some((global) => value.includes(global))
    })
}

function isPostHogException(exceptionList: ErrorTracking.ExceptionList): boolean {
    const frames = exceptionList[0]?.stacktrace?.frames ?? []
    const lastFrame = frames[frames.length - 1]
    return lastFrame?.filename?.includes('posthog.com/static') ?? false
}
