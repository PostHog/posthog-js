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

import { isEmptyString, isString, isUndefined } from '../../utils/type-utils'
import { ErrorEventArgs, ErrorProperties, SeverityLevel, severityLevels } from '../../types'

/**
 * based on the very wonderful MIT licensed Sentry SDK
 */

const ERROR_TYPES_PATTERN =
    /^(?:[Uu]ncaught (?:exception: )?)?(?:((?:Eval|Internal|Range|Reference|Syntax|Type|URI|)Error): )?(.*)$/i

export function parseStackFrames(ex: Error & { framesToPop?: number; stacktrace?: string }): StackFrame[] {
    // Access and store the stacktrace property before doing ANYTHING
    // else to it because Opera is not very good at providing it
    // reliably in other circumstances.
    const stacktrace = ex.stacktrace || ex.stack || ''

    const skipLines = getSkipFirstStackStringLines(ex)

    try {
        return defaultStackParser(stacktrace, skipLines)
    } catch {
        // no-empty
    }

    return []
}

const reactMinifiedRegexp = /Minified React error #\d+;/i

/**
 * Certain known React errors contain links that would be falsely
 * parsed as frames. This function check for these errors and
 * returns number of the stack string lines to skip.
 */
function getSkipFirstStackStringLines(ex: Error): number {
    if (ex && reactMinifiedRegexp.test(ex.message)) {
        return 1
    }

    return 0
}

function errorPropertiesFromError(error: Error): ErrorProperties {
    const frames = parseStackFrames(error)

    return {
        $exception_type: error.name,
        $exception_message: extractMessage(error),
        $exception_stack_trace_raw: JSON.stringify(frames),
        $exception_level: 'error',
    }
}

/**
 * There are cases where stacktrace.message is an Event object
 * https://github.com/getsentry/sentry-javascript/issues/1949
 * In this specific case we try to extract stacktrace.message.error.message
 */
export function extractMessage(err: Error & { message: { error?: Error } }): string {
    const message = err.message

    if (message.error && typeof message.error.message === 'string') {
        return message.error.message
    }

    return message
}

function errorPropertiesFromString(candidate: string): ErrorProperties {
    return {
        $exception_type: 'Error',
        $exception_message: candidate,
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

function errorPropertiesFromObject(candidate: Record<string, unknown>): ErrorProperties {
    return {
        $exception_type: isEvent(candidate) ? candidate.constructor.name : 'Error',
        $exception_message: `Non-Error ${'exception'} captured with keys: ${extractExceptionKeysForMessage(candidate)}`,
        $exception_level: isSeverityLevel(candidate.level) ? candidate.level : 'error',
    }
}

export function errorToProperties([event, source, lineno, colno, error]: ErrorEventArgs): ErrorProperties {
    // some properties are not optional but, it's useful to start off without them enforced
    let errorProperties: Omit<ErrorProperties, '$exception_type' | '$exception_message' | '$exception_level'> & {
        $exception_type?: string
        $exception_message?: string
        $exception_level?: string
    } = {}

    if (isUndefined(error) && isString(event)) {
        let name = 'Error'
        let message = event
        const groups = event.match(ERROR_TYPES_PATTERN)
        if (groups) {
            name = groups[1]
            message = groups[2]
        }
        errorProperties = {
            $exception_type: name,
            $exception_message: message,
        }
    }

    const candidate = error || event

    if (isDOMError(candidate) || isDOMException(candidate)) {
        // https://developer.mozilla.org/en-US/docs/Web/API/DOMError
        // https://developer.mozilla.org/en-US/docs/Web/API/DOMException

        const domException = candidate as unknown as DOMException

        if (isErrorWithStack(candidate)) {
            errorProperties = errorPropertiesFromError(candidate as Error)
        } else {
            const name = domException.name || (isDOMError(domException) ? 'DOMError' : 'DOMException')
            const message = domException.message ? `${name}: ${domException.message}` : name
            errorProperties = errorPropertiesFromString(message)
            errorProperties.$exception_type = isDOMError(domException) ? 'DOMError' : 'DOMException'
            errorProperties.$exception_message = errorProperties.$exception_message || message
        }
        if ('code' in domException) {
            errorProperties['$exception_DOMException_code'] = `${domException.code}`
        }
    } else if (isErrorEvent(candidate as ErrorEvent) && (candidate as ErrorEvent).error) {
        errorProperties = errorPropertiesFromError((candidate as ErrorEvent).error as Error)
    } else if (isError(candidate)) {
        errorProperties = errorPropertiesFromError(candidate)
    } else if (isPlainObject(candidate) || isEvent(candidate)) {
        // group these by using the keys available on the object
        const objectException = candidate as Record<string, unknown>
        errorProperties = errorPropertiesFromObject(objectException)
        errorProperties.$exception_is_synthetic = true
    } else {
        // If none of previous checks were valid, then it must be a string
        errorProperties.$exception_type = errorProperties.$exception_type || 'Error'
        errorProperties.$exception_message = errorProperties.$exception_message || candidate
        errorProperties.$exception_is_synthetic = true
    }

    return {
        ...errorProperties,
        // now we make sure the mandatory fields that were made optional are present
        $exception_type: errorProperties.$exception_type || 'UnknownErrorType',
        $exception_message: errorProperties.$exception_message || '',
        $exception_level: isSeverityLevel(errorProperties.$exception_level)
            ? errorProperties.$exception_level
            : 'error',
        ...(source
            ? {
                  $exception_source: source, // TODO get this from URL if not present
              }
            : {}),
        ...(lineno ? { $exception_lineno: lineno } : {}),
        ...(colno ? { $exception_colno: colno } : {}),
    }
}

export function unhandledRejectionToProperties([ev]: [ev: PromiseRejectionEvent]): ErrorProperties {
    const error = getUnhandledRejectionError(ev)

    // some properties are not optional but, it's useful to start off without them enforced
    let errorProperties: Omit<ErrorProperties, '$exception_type' | '$exception_message' | '$exception_level'> & {
        $exception_type?: string
        $exception_message?: string
        $exception_level?: string
    } = {}

    if (isPrimitive(error)) {
        errorProperties = {
            $exception_message: `Non-Error promise rejection captured with value: ${String(error)}`,
        }
    } else {
        errorProperties = errorToProperties([error as string | Event])
    }

    errorProperties.$exception_handled = false

    return {
        ...errorProperties,
        // now we make sure the mandatory fields that were made optional are present
        $exception_type: (errorProperties.$exception_type = 'UnhandledRejection'),
        $exception_message: errorProperties.$exception_message || String(error),
        $exception_level: isSeverityLevel(errorProperties.$exception_level)
            ? errorProperties.$exception_level
            : 'error',
    }
}

function getUnhandledRejectionError(error: unknown): unknown {
    if (isPrimitive(error)) {
        return error
    }

    // dig the object of the rejection out of known event types
    try {
        type ErrorWithReason = { reason: unknown }
        // PromiseRejectionEvents store the object of the rejection under 'reason'
        // see https://developer.mozilla.org/en-US/docs/Web/API/PromiseRejectionEvent
        if ('reason' in (error as ErrorWithReason)) {
            return (error as ErrorWithReason).reason
        }

        type CustomEventWithDetail = { detail: { reason: unknown } }
        // something, somewhere, (likely a browser extension) effectively casts PromiseRejectionEvents
        // to CustomEvents, moving the `promise` and `reason` attributes of the PRE into
        // the CustomEvent's `detail` attribute, since they're not part of CustomEvent's spec
        // see https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent and
        // https://github.com/getsentry/sentry-javascript/issues/2380
        if ('detail' in (error as CustomEventWithDetail) && 'reason' in (error as CustomEventWithDetail).detail) {
            return (error as CustomEventWithDetail).detail.reason
        }
    } catch {
        // no-empty
    }

    return error
}
