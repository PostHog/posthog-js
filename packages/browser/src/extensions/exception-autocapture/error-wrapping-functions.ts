import { window } from '@posthog/browser-common/utils/globals'
import { ErrorEventArgs } from '../../types'
import { createLogger } from '@posthog/browser-common/utils/logger'
import { isFunction, isString, type ErrorTracking } from '@posthog/core'
import { buildErrorPropertiesBuilder } from '../../posthog-exceptions'

const logger = /* @__PURE__ */ createLogger('[ExceptionAutocapture]')
const errorPropertiesBuilder = /* @__PURE__ */ buildErrorPropertiesBuilder()

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
    captureFn: (props: ErrorTracking.ErrorProperties) => void,
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

// Another SDK or PostHog instance may have wrapped our handler in the meantime.
// Only restore the property if we still own it; otherwise leave that handler's chain intact.
const restore = (owner: any, key: string, original: unknown, wrapper: any): void => {
    safely(() => {
        delete wrapper.__POSTHOG_INSTRUMENTED__
    }, undefined)
    safely(() => {
        if (owner[key] === wrapper) {
            owner[key] = original
        }
    }, undefined)
}

// `window.onerror` exposes the location positionally, so preserve it when there is no Error object.
const resolveOnErrorInput = ([event, source, lineno, colno, error]: ErrorEventArgs): unknown => {
    if (error != null) {
        return error
    }
    if (isString(event) && isString(source) && source.length > 0 && typeof ErrorEvent !== 'undefined') {
        try {
            return new ErrorEvent('error', { message: event, filename: source, lineno, colno })
        } catch {
            return event
        }
    }
    return event
}

const wrapOnError = (captureFn: (props: ErrorTracking.ErrorProperties) => void) => {
    const win = window as any
    if (!win) {
        logger.info('window not available, cannot wrap onerror')
    }
    const originalOnError = safely(() => win.onerror, undefined)

    let active = true
    const wrapper = (win.onerror = function (...args: ErrorEventArgs): boolean {
        if (active) {
            safelyBuildAndCapture(captureFn, () =>
                errorPropertiesBuilder.buildFromUnknown(resolveOnErrorInput(args), {
                    mechanism: { handled: false },
                })
            )
        }
        if (!isReachableFunction(originalOnError)) {
            return false
        }
        return originalOnError(...args) ?? false
    })
    markInstrumented(win, 'onerror')

    return () => {
        active = false
        restore(win, 'onerror', originalOnError, wrapper)
    }
}

const wrapUnhandledRejection = (
    captureFn: (props: ErrorTracking.ErrorProperties) => void,
    defaultReturnValue = false
) => {
    const win = window as any
    if (!win) {
        logger.info('window not available, cannot wrap onUnhandledRejection')
    }

    const originalOnUnhandledRejection = safely(() => win.onunhandledrejection, undefined)

    let active = true
    const wrapper = (win.onunhandledrejection = function (ev: PromiseRejectionEvent): boolean {
        if (active) {
            safelyBuildAndCapture(captureFn, () =>
                errorPropertiesBuilder.buildFromUnknown(ev, {
                    mechanism: { handled: false },
                })
            )
        }
        if (!isReachableFunction(originalOnUnhandledRejection)) {
            return defaultReturnValue
        }
        return originalOnUnhandledRejection(ev) ?? false
    })
    markInstrumented(win, 'onunhandledrejection')

    return () => {
        active = false
        restore(win, 'onunhandledrejection', originalOnUnhandledRejection, wrapper)
    }
}

const wrapConsoleError = (captureFn: (props: ErrorTracking.ErrorProperties) => void) => {
    const con = console as any
    if (!con) {
        logger.info('console not available, cannot wrap console.error')
    }

    const originalConsoleError = safely(() => con.error, undefined)

    let active = true
    const wrapper = (con.error = function (...args: any[]): void {
        // Check before selecting an Error argument, which loses the diagnostic prefix.
        // SDK loggers pass the prefix and diagnostic separately, including in older bundles.
        const isInternalDiagnostic = safely(
            () =>
                args.length > 1 &&
                isString(args[0]) &&
                (/^\[PostHog\.js\](?: |$)/.test(args[0]) || args[0] === 'rrweb logger error:'),
            false
        )
        if (active && !isInternalDiagnostic) {
            safelyBuildAndCapture(captureFn, () => {
                let event
                if (args.length == 1) {
                    event = args[0]
                } else {
                    event = args.join(' ')
                }
                const error = args.find((arg) => arg instanceof Error)
                return errorPropertiesBuilder.buildFromUnknown(error || event, {
                    mechanism: { handled: true, type: 'onconsole' },
                    syntheticException: new Error('PostHog syntheticException'),
                    skipFirstLines: 2,
                })
            })
        }
        if (isReachableFunction(originalConsoleError)) {
            originalConsoleError(...args)
        }
    })
    markInstrumented(con, 'error')

    return () => {
        active = false
        restore(con, 'error', originalConsoleError, wrapper)
    }
}

const posthogErrorWrappingFunctions = {
    wrapOnError,
    wrapUnhandledRejection,
    wrapConsoleError,
}

export default posthogErrorWrappingFunctions
