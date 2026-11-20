import { window } from '@posthog/browser-common/utils/globals'
import { assignableWindow } from '../utils/globals'
import { ErrorEventArgs } from '../types'
import { createLogger } from '@posthog/browser-common/utils/logger'
import { isArray, isFunction, isNull, isString, type ErrorTracking } from '@posthog/core'
import { buildErrorPropertiesBuilder } from '../posthog-exceptions'

const logger = createLogger('[ExceptionAutocapture]')
const errorPropertiesBuilder = buildErrorPropertiesBuilder()

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

const markInstrumented = (wrapper: any): void =>
    safely(() => {
        wrapper.__POSTHOG_INSTRUMENTED__ = true
    }, undefined)

// Other code (another error tool, the app, logs capture) can install its own handler on top of
// PostHog's. Writing the original back would then remove that handler for the rest of the page.
// So the original is restored only while PostHog's wrapper is still the installed handler.
// Otherwise the wrapper stays in the chain: the caller has stopped it capturing, so it only
// forwards to the original, and the handler installed on top keeps working.
const restore = (owner: any, key: string, wrapper: unknown, original: unknown): void => {
    // Deleting the marker can throw on a frozen or unreachable wrapper. It is guarded on its own
    // so that failure cannot skip the restore, which is the functional half.
    safely(() => {
        delete (wrapper as any).__POSTHOG_INSTRUMENTED__
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
    let capturing = true

    const wrapper = function (...args: ErrorEventArgs): boolean {
        if (capturing) {
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
    }
    win.onerror = wrapper
    markInstrumented(wrapper)

    return () => {
        capturing = false
        restore(win, 'onerror', wrapper, originalOnError)
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
    let capturing = true

    const wrapper = function (ev: PromiseRejectionEvent): boolean {
        if (capturing) {
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
    }
    win.onunhandledrejection = wrapper
    markInstrumented(wrapper)

    return () => {
        capturing = false
        restore(win, 'onunhandledrejection', wrapper, originalOnUnhandledRejection)
    }
}

const wrapConsoleError = (captureFn: (props: ErrorTracking.ErrorProperties) => void) => {
    const con = console as any
    if (!con) {
        logger.info('console not available, cannot wrap console.error')
    }

    const originalConsoleError = safely(() => con.error, undefined)
    let capturing = true

    const wrapper = function (...args: any[]): void {
        // Check before selecting an Error argument, which loses the diagnostic prefix.
        // SDK loggers pass the prefix and diagnostic separately, including in older bundles.
        const isInternalDiagnostic = safely(
            () =>
                args.length > 1 &&
                isString(args[0]) &&
                (/^\[PostHog\.js\](?: |$)/.test(args[0]) || args[0] === 'rrweb logger error:'),
            false
        )
        if (capturing && !isInternalDiagnostic) {
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
    }
    con.error = wrapper
    markInstrumented(wrapper)

    return () => {
        capturing = false
        restore(con, 'error', wrapper, originalConsoleError)
    }
}

const posthogErrorWrappingFunctions = {
    wrapOnError,
    wrapUnhandledRejection,
    wrapConsoleError,
}

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.errorWrappingFunctions = posthogErrorWrappingFunctions

// we used to put these on window, and now we put them on __PosthogExtensions__
// but that means that old clients which lazily load this extension are looking in the wrong place
// yuck,
// so we also put them directly on the window
// when 1.161.1 is the oldest version seen in production we can remove this
assignableWindow.posthogErrorWrappingFunctions = posthogErrorWrappingFunctions

// posthog-js <= 1.141.0 checked the first spelling after loading this bundle,
// but called the second spelling. Keep both aliases because the unversioned
// extension bundle can be loaded by those pinned clients.
type LegacyPostHogInstance = {
    capture?: (event: string, properties: Record<string, any>, options?: Record<string, any>) => unknown
}
type LegacyDecideResponse = {
    autocaptureExceptions?: boolean | { errors_to_ignore?: string[] }
}
const extendPostHogWithExceptionAutocapture = (instance?: LegacyPostHogInstance, response?: LegacyDecideResponse) => {
    if (!isFunction(instance?.capture)) {
        return
    }

    const autocaptureExceptions = response?.autocaptureExceptions
    const errorsToIgnore =
        !isNull(autocaptureExceptions) &&
        typeof autocaptureExceptions === 'object' &&
        isArray(autocaptureExceptions.errors_to_ignore)
            ? autocaptureExceptions.errors_to_ignore.reduce<RegExp[]>((rules, rule) => {
                  try {
                      rules.push(new RegExp(rule))
                  } catch (error) {
                      logger.error('Ignoring invalid legacy exception exclusion rule', rule, error)
                  }
                  return rules
              }, [])
            : []

    const sendExceptionEvent = (properties: ErrorTracking.ErrorProperties) => {
        try {
            instance.capture?.('$exception', properties as Record<string, any>, {
                _noTruncate: true,
                _batchKey: 'exceptionEvent',
                _noHeatmaps: true,
            })
        } catch (error) {
            logger.error('Failed to capture exception for a legacy client', error)
        }
    }

    const captureException = (properties: ErrorTracking.ErrorProperties) => {
        if (
            errorsToIgnore.some((regex) =>
                properties.$exception_list.some((exception) => regex.test(exception.value || ''))
            )
        ) {
            return
        }

        sendExceptionEvent(properties)
    }

    wrapOnError(captureException)
    wrapUnhandledRejection(sendExceptionEvent, true)
}

assignableWindow.extendPostHogWithExceptionAutoCapture = extendPostHogWithExceptionAutocapture
assignableWindow.extendPostHogWithExceptionAutocapture = extendPostHogWithExceptionAutocapture

export default posthogErrorWrappingFunctions
