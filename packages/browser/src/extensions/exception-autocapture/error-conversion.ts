// Portions of this file are derived from getsentry/sentry-javascript by Software, Inc. dba Sentry
// Licensed under the MIT License

import { StackFrame } from './stack-trace'

import { ErrorTracking } from '@posthog/core'
import { SeverityLevel } from '../../types'

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

const errorPropertiesBuilder = new ErrorTracking.ErrorPropertiesBuilder(
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
    [ErrorTracking.chromeStackLineParser, ErrorTracking.geckoStackLineParser]
)

export function errorToProperties(input: unknown, metadata?: ErrorMetadata): ErrorProperties {
    return errorPropertiesBuilder.buildFromUnknown(input, {
        syntheticException: metadata?.syntheticException,
        mechanism: {
            handled: metadata?.handled,
        },
    })
}

export function unhandledRejectionToProperties(ev: PromiseRejectionEvent): ErrorProperties {
    return errorToProperties(ev, {
        handled: false,
    })
}
