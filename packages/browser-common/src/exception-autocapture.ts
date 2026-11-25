import type { ErrorTracking } from '@posthog/core'
import { isFunction, isString } from '@posthog/core/utils'
import { originalConsoleMethod } from './utils/console-original'

export type ErrorEventArgs = [
    event: string | Event,
    source?: string | undefined,
    lineno?: number | undefined,
    colno?: number | undefined,
    error?: Error | undefined,
]

type CaptureExceptionFn = (props: ErrorTracking.ErrorProperties) => void

/** Each function installs one global handler and returns a function that restores the previous handler. */
export interface ErrorWrappingFunctions {
    wrapOnError(captureFn: CaptureExceptionFn): () => void
    wrapUnhandledRejection(captureFn: CaptureExceptionFn, defaultReturnValue?: boolean): () => void
    wrapConsoleError(captureFn: CaptureExceptionFn): () => void
}

export interface ErrorWrappingOptions {
    /** Converts captured values into exception properties. */
    builder: ErrorTracking.ErrorPropertiesBuilder
    /** The global whose `onerror` and `onunhandledrejection` handlers are wrapped. */
    window: any
    /** Matches the first console argument of the SDK's own diagnostics, which are never captured. */
    diagnosticPrefix: RegExp
    logger?: { info: (...args: any[]) => void }
}

// Exception autocapture must never throw into customer code. Do not log in the catch because
// console.error may be instrumented and would re-enter exception autocapture.
const safely = <T>(fn: () => T, fallback: T): T => {
    try {
        return fn()
    } catch {
        return fallback
    }
}

const safelyBuildAndCapture = (
    captureFn: CaptureExceptionFn,
    buildProperties: () => ErrorTracking.ErrorProperties
): void => safely(() => captureFn(buildProperties()), undefined)

// Firefox throws on every read, write and call that touches an object from another compartment or
// from a destroyed document, such as a handler left behind by a removed or cross-origin iframe.
// The handler is probed inside the guard and called outside it, so an unreachable handler is
// skipped while errors from a reachable one still reach the page.
const isReachableFunction = (handler: unknown): handler is (...args: any[]) => any =>
    safely(() => isFunction(handler) && isFunction(handler.call), false)

const markInstrumented = (owner: any, key: string): void =>
    safely(() => {
        owner[key].__POSTHOG_INSTRUMENTED__ = true
    }, undefined)

// The marker lives on the wrapper, so deleting it can throw on a frozen or unreachable handler.
// It is guarded on its own so that failure cannot skip the restore, which is the functional half.
const restore = (owner: any, key: string, original: unknown): void => {
    safely(() => {
        delete owner[key]?.__POSTHOG_INSTRUMENTED__
    }, undefined)
    safely(() => {
        owner[key] = original
    }, undefined)
}

// `window.onerror` exposes the location positionally, so preserve it when there is no Error object.
const resolveOnErrorInput = ([event, source, lineno, colno, error]: ErrorEventArgs): unknown => {
    if (error != null) {
        return error
    }
    if (isString(event) && isString(source) && source.length > 0 && typeof ErrorEvent !== 'undefined') {
        try {
            return new ErrorEvent('error', {
                message: event,
                filename: source,
                // ErrorEvent reads a missing position as 0.
                lineno: lineno ?? 0,
                colno: colno ?? 0,
            })
        } catch {
            return event
        }
    }
    return event
}

/** Creates the global error, unhandled rejection and console error wrappers used by exception autocapture. */
export function createErrorWrappingFunctions({
    builder,
    window: win,
    diagnosticPrefix,
    logger,
}: ErrorWrappingOptions): ErrorWrappingFunctions {
    const wrapOnError = (captureFn: CaptureExceptionFn) => {
        if (!win) {
            logger?.info('window not available, cannot wrap onerror')
        }
        const originalOnError = safely(() => win.onerror, undefined)

        win.onerror = function (...args: ErrorEventArgs): boolean {
            safelyBuildAndCapture(captureFn, () =>
                builder.buildFromUnknown(resolveOnErrorInput(args), {
                    mechanism: { handled: false },
                })
            )
            if (!isReachableFunction(originalOnError)) {
                return false
            }
            return originalOnError(...args) ?? false
        }
        markInstrumented(win, 'onerror')

        return () => restore(win, 'onerror', originalOnError)
    }

    const wrapUnhandledRejection = (captureFn: CaptureExceptionFn, defaultReturnValue = false) => {
        if (!win) {
            logger?.info('window not available, cannot wrap onUnhandledRejection')
        }

        const originalOnUnhandledRejection = safely(() => win.onunhandledrejection, undefined)

        win.onunhandledrejection = function (ev: PromiseRejectionEvent): boolean {
            safelyBuildAndCapture(captureFn, () =>
                builder.buildFromUnknown(ev, {
                    mechanism: { handled: false },
                })
            )
            if (!isReachableFunction(originalOnUnhandledRejection)) {
                return defaultReturnValue
            }
            return originalOnUnhandledRejection(ev) ?? false
        }
        markInstrumented(win, 'onunhandledrejection')

        return () => restore(win, 'onunhandledrejection', originalOnUnhandledRejection)
    }

    const wrapConsoleError = (captureFn: CaptureExceptionFn) => {
        const con = console as any
        if (!con) {
            logger?.info('console not available, cannot wrap console.error')
        }

        const originalConsoleError = safely(() => con.error, undefined)

        con.error = function (...args: any[]): void {
            // Check before selecting an Error argument, which loses the diagnostic prefix.
            // SDK loggers pass the prefix and diagnostic separately, including in older bundles.
            const isInternalDiagnostic = safely(
                () =>
                    args.length > 1 &&
                    isString(args[0]) &&
                    (diagnosticPrefix.test(args[0]) || args[0] === 'rrweb logger error:'),
                false
            )
            if (!isInternalDiagnostic) {
                safelyBuildAndCapture(captureFn, () => {
                    let event
                    if (args.length == 1) {
                        event = args[0]
                    } else {
                        event = args.join(' ')
                    }
                    const error = args.find((arg) => arg instanceof Error)
                    return builder.buildFromUnknown(error || event, {
                        mechanism: { handled: true, type: 'onconsole' },
                        syntheticException: new Error('PostHog syntheticException'),
                        skipFirstLines: 2,
                    })
                })
            }
            if (isReachableFunction(originalConsoleError)) {
                originalConsoleError(...args)
            }
        }
        markInstrumented(con, 'error')
        // SDK loggers follow this marker to the native method, so their diagnostics skip this capture.
        safely(() => {
            con.error.__rrweb_original__ = originalConsoleMethod(originalConsoleError)
        }, undefined)

        return () => restore(con, 'error', originalConsoleError)
    }

    return { wrapOnError, wrapUnhandledRejection, wrapConsoleError }
}
