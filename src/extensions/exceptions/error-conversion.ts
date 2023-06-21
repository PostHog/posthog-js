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

/**
 * based on the very wonderful MIT licensed Sentry SDK
 */

const ERROR_TYPES_PATTERN =
    /^(?:[Uu]ncaught (?:exception: )?)?(?:((?:Eval|Internal|Range|Reference|Syntax|Type|URI|)Error): )?(.*)$/i

export type ErrorEventArgs = [
    event: string | Event,
    source?: string | undefined,
    lineno?: number | undefined,
    colno?: number | undefined,
    error?: Error | undefined
]

export interface ErrorProperties {
    $exception_type: string
    $exception_message: string
    $exception_source?: string
    $exception_lineno?: number
    $exception_colno?: number
    $exception_DOMException_code?: string
    $exception_is_synthetic?: boolean
    $exception_stack_trace_raw?: string
    $exception_handled?: boolean
    $exception_personURL?: string
}

const reactMinifiedRegexp = /Minified React error #\d+;/i

function getPopSize(ex: Error & { framesToPop?: number }): number {
    if (ex) {
        if (typeof ex.framesToPop === 'number') {
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
    } catch (e) {
        // no-empty
    }

    return []
}

function errorPropertiesFromError(error: Error): ErrorProperties {
    const frames = parseStackFrames(error)

    return {
        $exception_type: error.name,
        $exception_message: error.message,
        $exception_stack_trace_raw: JSON.stringify(frames),
    }
}

function errorPropertiesFromString(candidate: string): ErrorProperties {
    return {
        $exception_type: 'Error',
        $exception_message: candidate,
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

function errorPropertiesFromObject(candidate: Record<string, unknown>): ErrorProperties {
    return {
        $exception_type: isEvent(candidate) ? candidate.constructor.name : 'Error',
        $exception_message: `Non-Error ${'exception'} captured with keys: ${extractExceptionKeysForMessage(candidate)}`,
    }
}

export function errorToProperties([event, source, lineno, colno, error]: ErrorEventArgs): ErrorProperties {
    // exception type and message are not optional but, it's useful to start off without them enforced
    let errorProperties: Omit<ErrorProperties, '$exception_type' | '$exception_message'> & {
        $exception_type?: string
        $exception_message?: string
    } = {}

    if (error === undefined && typeof event === 'string') {
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
    } catch (_oO) {
        // no-empty
    }

    // exception type and message are not optional but, it's useful to start off without them enforced
    let errorProperties: Omit<ErrorProperties, '$exception_type' | '$exception_message'> & {
        $exception_type?: string
        $exception_message?: string
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
        $exception_message: (errorProperties.$exception_message =
            errorProperties.$exception_message || (ev as any).reason || String(error)),
    }
}
