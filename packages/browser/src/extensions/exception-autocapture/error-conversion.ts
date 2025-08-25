// Portions of this file are derived from getsentry/sentry-javascript by Software, Inc. dba Sentry
// Licensed under the MIT License

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
import { defaultStackParser, StackFrame, StackParser } from './stack-trace'

import { isEmptyString, isString, isUndefined } from '@posthog/core'
import { SeverityLevel, severityLevels } from '../../types'
import { getFilenameToChunkIdMap } from './chunk-ids'

type ErrorConversionArgs = {
    event: string | Event
    error?: Error
}

type ErrorMetadata = {
    handled?: boolean
    synthetic?: boolean
    syntheticException?: Error
    overrideExceptionType?: string
    defaultExceptionType?: string
    defaultExceptionMessage?: string
}
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
        type: 'raw'
    }
}

/**
 * based on the very wonderful MIT licensed Sentry SDK
 */

const ERROR_TYPES_PATTERN =
    /^(?:[Uu]ncaught (?:exception: )?)?(?:((?:Eval|Internal|Range|Reference|Syntax|Type|URI|)Error): )?(.*)$/i

export function parseStackFrames(ex: Error & { stacktrace?: string }, framesToPop: number = 0): StackFrame[] {
    // Access and store the stacktrace property before doing ANYTHING
    // else to it because Opera is not very good at providing it
    // reliably in other circumstances.
    const stacktrace = ex.stacktrace || ex.stack || ''

    const skipLines = getSkipFirstStackStringLines(ex)

    try {
        const parser = defaultStackParser
        const frames = applyChunkIds(parser(stacktrace, skipLines), parser)
        // frames are reversed so we remove the from the back of the array
        return frames.slice(0, frames.length - framesToPop)
    } catch {
        // no-empty
    }

    return []
}

export function applyChunkIds(frames: StackFrame[], parser: StackParser): StackFrame[] {
    const filenameDebugIdMap = getFilenameToChunkIdMap(parser)

    frames.forEach((frame) => {
        if (frame.filename) {
            frame.chunk_id = filenameDebugIdMap[frame.filename]
        }
    })

    return frames
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

function exceptionFromError(error: Error, metadata?: ErrorMetadata): Exception {
    const frames = parseStackFrames(error)

    const handled = metadata?.handled ?? true
    const synthetic = metadata?.synthetic ?? false

    const exceptionType = metadata?.overrideExceptionType ? metadata.overrideExceptionType : error.name
    const exceptionMessage = extractMessage(error)
    return {
        type: exceptionType,
        value: exceptionMessage,
        stacktrace: {
            frames,
            type: 'raw',
        },
        mechanism: {
            handled,
            synthetic,
        },
    }
}

function exceptionListFromError(error: Error, metadata?: ErrorMetadata): ErrorProperties['$exception_list'] {
    const exception = exceptionFromError(error, metadata)
    if (error.cause && isError(error.cause) && error.cause !== error) {
        // Cause could be an object or a string
        // For now we only support error causes
        // See: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause
        return [
            exception,
            ...exceptionListFromError(error.cause, {
                handled: metadata?.handled,
                synthetic: metadata?.synthetic,
            }),
        ]
    }
    return [exception]
}

function errorPropertiesFromError(error: Error, metadata?: ErrorMetadata): ErrorProperties {
    return {
        $exception_list: exceptionListFromError(error, metadata),
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
        return String(message.error.message)
    }

    return String(message)
}

function errorPropertiesFromString(candidate: string, metadata?: ErrorMetadata): ErrorProperties {
    // Defaults for metadata are based on what the error candidate is.
    const handled = metadata?.handled ?? true
    const synthetic = metadata?.synthetic ?? true

    const exceptionType = metadata?.overrideExceptionType
        ? metadata.overrideExceptionType
        : (metadata?.defaultExceptionType ?? 'Error')
    const exceptionMessage = candidate ? candidate : metadata?.defaultExceptionMessage

    const exception: Exception = {
        type: exceptionType,
        value: exceptionMessage,
        mechanism: {
            handled,
            synthetic,
        },
    }

    if (metadata?.syntheticException) {
        // Kludge: strip the last frame from a synthetically created error
        // so that it does not appear in a users stack trace
        const frames = parseStackFrames(metadata.syntheticException, 1)
        if (frames.length) {
            exception.stacktrace = { frames, type: 'raw' }
        }
    }

    return {
        $exception_list: [exception],
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
    const exceptionMessage = `Non-Error 'exception' captured with keys: ${extractExceptionKeysForMessage(candidate)}`

    const exception: Exception = {
        type: exceptionType,
        value: exceptionMessage,
        mechanism: {
            handled,
            synthetic,
        },
    }

    if (metadata?.syntheticException) {
        // Kludge: strip the last frame from a synthetically created error
        // so that it does not appear in a users stack trace
        const frames = parseStackFrames(metadata?.syntheticException, 1)
        if (frames.length) {
            exception.stacktrace = { frames, type: 'raw' }
        }
    }

    return {
        $exception_list: [exception],
        $exception_level: isSeverityLevel(candidate.level) ? candidate.level : 'error',
    }
}

export function errorToProperties({ error, event }: ErrorConversionArgs, metadata?: ErrorMetadata): ErrorProperties {
    let errorProperties: ErrorProperties = { $exception_list: [] }

    const candidate = error || event

    if (isDOMError(candidate) || isDOMException(candidate)) {
        // https://developer.mozilla.org/en-US/docs/Web/API/DOMError
        // https://developer.mozilla.org/en-US/docs/Web/API/DOMException

        const domException = candidate as unknown as DOMException

        if (isErrorWithStack(candidate)) {
            errorProperties = errorPropertiesFromError(candidate, metadata)
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
        return errorPropertiesFromObject(objectException, metadata)
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
    const error = getUnhandledRejectionError(ev)

    if (isPrimitive(error)) {
        return errorPropertiesFromString(`Non-Error promise rejection captured with value: ${String(error)}`, {
            handled: false,
            synthetic: false,
            overrideExceptionType: 'UnhandledRejection',
        })
    }

    return errorToProperties(
        { event: error as string | Event },
        {
            handled: false,
            overrideExceptionType: 'UnhandledRejection',
            defaultExceptionMessage: String(error),
        }
    )
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
