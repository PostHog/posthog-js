import {
    isDOMError,
    isDOMException,
    isError,
    isErrorEvent,
    isErrorWithStack,
    isEvent,
    isPlainObject,
    isPrimitive,
} from './type-checking'
import { defaultStackParser, StackFrame } from './stack-trace'

import { isEmptyString, isNumber, isString, isUndefined } from '../../utils/type-utils'
import { ErrorEventArgs, ErrorMetadata, SeverityLevel, severityLevels } from '../../types'

export interface ErrorProperties {
    $exception_list: Exception[]
    $exception_level?: SeverityLevel
    $exception_DOMException_code?: string
    $exception_personURL?: string
}

export interface Exception {
    type?: string
    value?: string
    mechanism?: {
        /**
         * In theory, whether or not the exception has been handled by the user. In practice, whether or not we see it before
         * it hits the global error/rejection handlers, whether through explicit handling by the user or auto instrumentation.
         */
        handled?: boolean
        type?: string
        source?: string
        /**
         * True when `captureException` is called with anything other than an instance of `Error` (or, in the case of browser,
         * an instance of `ErrorEvent`, `DOMError`, or `DOMException`). causing us to create a synthetic error in an attempt
         * to recreate the stacktrace.
         */
        synthetic?: boolean
    }
    module?: string
    thread_id?: number
    stacktrace?: {
        frames?: StackFrame[]
    }
}

export interface ErrorConversions {
    errorToProperties: (args: ErrorEventArgs, metadata?: ErrorMetadata) => ErrorProperties
    unhandledRejectionToProperties: (args: [ev: PromiseRejectionEvent]) => ErrorProperties
}

/**
 * based on the very wonderful MIT licensed Sentry SDK
 */

const ERROR_TYPES_PATTERN =
    /^(?:[Uu]ncaught (?:exception: )?)?(?:((?:Eval|Internal|Range|Reference|Syntax|Type|URI|)Error): )?(.*)$/i

const reactMinifiedRegexp = /Minified React error #\d+;/i

function getPopSize(ex: Error & { framesToPop?: number }): number {
    if (ex) {
        if (isNumber(ex.framesToPop)) {
            return ex.framesToPop
        }

        if (reactMinifiedRegexp.test(ex.message)) {
            return 1
        }
    }

    return 0
}

export function parseStackFrames(ex: Error & { framesToPop?: number; stacktrace?: string }): StackFrame[] {
    // Access and store the stacktrace property before doing ANYTHING
    // else to it because Opera is not very good at providing it
    // reliably in other circumstances.
    const stacktrace = ex.stacktrace || ex.stack || ''

    const popSize = getPopSize(ex)

    try {
        return defaultStackParser(stacktrace, popSize)
    } catch {
        // no-empty
    }

    return []
}

function errorPropertiesFromError(error: Error, metadata?: ErrorMetadata): ErrorProperties {
    const frames = parseStackFrames(error)

    const handled = metadata?.handled ?? true
    const synthetic = metadata?.synthetic ?? false

    const exceptionType = metadata?.overrideExceptionType ? metadata.overrideExceptionType : error.name
    const exceptionMessage = metadata?.overrideExceptionMessage ? metadata.overrideExceptionMessage : error.message

    return {
        $exception_list: [
            {
                type: exceptionType,
                value: exceptionMessage,
                stacktrace: {
                    frames,
                },
                mechanism: {
                    handled,
                    synthetic,
                },
            },
        ],
        $exception_level: 'error',
    }
}

function errorPropertiesFromString(candidate: string, metadata?: ErrorMetadata): ErrorProperties {
    // Defaults for metadata are based on what the error candidate is.
    const handled = metadata?.handled ?? true
    const synthetic = metadata?.synthetic ?? true

    const exceptionType = metadata?.overrideExceptionType
        ? metadata.overrideExceptionType
        : metadata?.defaultExceptionType ?? 'Error'
    const exceptionMessage = metadata?.overrideExceptionMessage
        ? metadata.overrideExceptionMessage
        : candidate
        ? candidate
        : metadata?.defaultExceptionMessage

    return {
        $exception_list: [
            {
                type: exceptionType,
                value: exceptionMessage,
                mechanism: {
                    handled,
                    synthetic,
                },
            },
        ],
        $exception_level: 'error',
    }
}

/**
 * Given any captured exception, extract its keys and create a sorted
 * and truncated list that will be used inside the event message.
 * eg. `Non-error exception captured with keys: foo, bar, baz`
 */
function extractExceptionKeysForMessage(exception: Record<string, unknown>, maxLength = 40): string {
    const keys = Object.keys(exception)
    keys.sort()

    if (!keys.length) {
        return '[object has no keys]'
    }

    for (let i = keys.length; i > 0; i--) {
        const serialized = keys.slice(0, i).join(', ')
        if (serialized.length > maxLength) {
            continue
        }
        if (i === keys.length) {
            return serialized
        }
        return serialized.length <= maxLength ? serialized : `${serialized.slice(0, maxLength)}...`
    }

    return ''
}

function isSeverityLevel(x: unknown): x is SeverityLevel {
    return isString(x) && !isEmptyString(x) && severityLevels.indexOf(x as SeverityLevel) >= 0
}

function errorPropertiesFromObject(candidate: Record<string, unknown>, metadata?: ErrorMetadata): ErrorProperties {
    // Defaults for metadata are based on what the error candidate is.
    const handled = metadata?.handled ?? true
    const synthetic = metadata?.synthetic ?? true

    const exceptionType = metadata?.overrideExceptionType
        ? metadata.overrideExceptionType
        : isEvent(candidate)
        ? candidate.constructor.name
        : 'Error'
    const exceptionMessage = metadata?.overrideExceptionMessage
        ? metadata.overrideExceptionMessage
        : `Non-Error ${'exception'} captured with keys: ${extractExceptionKeysForMessage(candidate)}`

    return {
        $exception_list: [
            {
                type: exceptionType,
                value: exceptionMessage,
                mechanism: {
                    handled,
                    synthetic,
                },
            },
        ],
        $exception_level: isSeverityLevel(candidate.level) ? candidate.level : 'error',
    }
}

export function errorToProperties(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    [event, _, __, ___, error]: ErrorEventArgs,
    metadata?: ErrorMetadata
): ErrorProperties {
    let errorProperties: ErrorProperties = { $exception_list: [] }

    const candidate = error || event

    if (isDOMError(candidate) || isDOMException(candidate)) {
        // https://developer.mozilla.org/en-US/docs/Web/API/DOMError
        // https://developer.mozilla.org/en-US/docs/Web/API/DOMException

        const domException = candidate as unknown as DOMException

        if (isErrorWithStack(candidate)) {
            errorProperties = errorPropertiesFromError(candidate as Error, metadata)
        } else {
            const name = domException.name || (isDOMError(domException) ? 'DOMError' : 'DOMException')
            const message = domException.message ? `${name}: ${domException.message}` : name
            const exceptionType = isDOMError(domException) ? 'DOMError' : 'DOMException'
            errorProperties = errorPropertiesFromString(message, {
                ...metadata,
                overrideExceptionType: exceptionType,
                defaultExceptionMessage: message,
            })
        }
        if ('code' in domException) {
            errorProperties['$exception_DOMException_code'] = `${domException.code}`
        }
        return errorProperties
    } else if (isErrorEvent(candidate as ErrorEvent) && (candidate as ErrorEvent).error) {
        return errorPropertiesFromError((candidate as ErrorEvent).error as Error, metadata)
    } else if (isError(candidate)) {
        return errorPropertiesFromError(candidate, metadata)
    } else if (isPlainObject(candidate) || isEvent(candidate)) {
        // group these by using the keys available on the object
        const objectException = candidate as Record<string, unknown>
        return errorPropertiesFromObject(objectException)
    } else if (isUndefined(error) && isString(event)) {
        let name = 'Error'
        let message = event
        const groups = event.match(ERROR_TYPES_PATTERN)
        if (groups) {
            name = groups[1]
            message = groups[2]
        }

        return errorPropertiesFromString(message, {
            ...metadata,
            overrideExceptionType: name,
            defaultExceptionMessage: message,
        })
    } else {
        return errorPropertiesFromString(candidate as string, metadata)
    }
}

export function unhandledRejectionToProperties([ev]: [ev: PromiseRejectionEvent]): ErrorProperties {
    // dig the object of the rejection out of known event types
    let error: unknown = ev
    try {
        // PromiseRejectionEvents store the object of the rejection under 'reason'
        // see https://developer.mozilla.org/en-US/docs/Web/API/PromiseRejectionEvent
        if ('reason' in ev) {
            error = ev.reason
        }
        // something, somewhere, (likely a browser extension) effectively casts PromiseRejectionEvents
        // to CustomEvents, moving the `promise` and `reason` attributes of the PRE into
        // the CustomEvent's `detail` attribute, since they're not part of CustomEvent's spec
        // see https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent and
        // https://github.com/getsentry/sentry-javascript/issues/2380
        else if ('detail' in ev && 'reason' in (ev as any).detail) {
            error = (ev as any).detail.reason
        }
    } catch {
        // no-empty
    }

    if (isPrimitive(error)) {
        return errorPropertiesFromString(`Non-Error promise rejection captured with value: ${String(error)}`, {
            handled: false,
            synthetic: false,
            overrideExceptionType: 'UnhandledRejection',
        })
    } else {
        return errorToProperties([error as string | Event], {
            handled: false,
            overrideExceptionType: 'UnhandledRejection',
            defaultExceptionMessage: (ev as any).reason || String(error),
        })
    }
}
