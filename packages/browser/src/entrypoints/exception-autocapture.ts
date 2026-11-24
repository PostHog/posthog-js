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

type CaptureFn = (props: ErrorTracking.ErrorProperties) => void

// The same mutable layer that `patch` in browser-common and rrweb-utils attaches to its wrappers,
// so each of them can splice its own wrapper out from under the others.
interface WrapperLayer {
    next: unknown
    // Set on the layers of this file, which check `next` before every call. `patch` calls it as is.
    checksNext?: boolean
}

const layerOf = (method: unknown): WrapperLayer | undefined =>
    isFunction(method) ? ((method as any).__posthog_layer__ ?? (method as any).__rrweb_layer__) : undefined

const safelyBuildAndCapture = (captureFn: CaptureFn, buildProperties: () => ErrorTracking.ErrorProperties): void =>
    safely(() => captureFn(buildProperties()), undefined)

// Firefox throws on every read, write and call that touches an object from another compartment or
// from a destroyed document, such as a handler left behind by a removed or cross-origin iframe.
// The handler is probed inside the guard and called outside it, so an unreachable handler is
// skipped while errors from a reachable one still reach the page.
const isReachableFunction = (handler: unknown): handler is (...args: any[]) => any =>
    safely(() => isFunction(handler) && isFunction(handler.call), false)

const markInstrumented = (wrapper: any, layer: WrapperLayer): void =>
    safely(() => {
        wrapper.__POSTHOG_INSTRUMENTED__ = true
        Object.defineProperty(wrapper, '__posthog_layer__', { enumerable: false, value: layer })
    }, undefined)

// Other code (another error tool, the app, logs capture) can install its own handler on top of
// PostHog's. Writing the original back would then remove that handler for the rest of the page.
// So the original is restored only while PostHog's wrapper is still the installed handler, and the
// wrapper is spliced out from under other PostHog and rrweb layers. Under any other handler the
// wrapper stays in the chain: the caller has stopped it capturing, so it only forwards to the
// original, and the handler installed on top keeps working.
const restore = (owner: any, key: string, wrapper: unknown, layer: WrapperLayer): void => {
    // Deleting the marker can throw on a frozen or unreachable wrapper. It is guarded on its own
    // so that failure cannot skip the restore, which is the functional half.
    safely(() => {
        delete (wrapper as any).__POSTHOG_INSTRUMENTED__
    }, undefined)
    safely(() => {
        const installed = owner[key]
        if (installed === wrapper) {
            owner[key] = layer.next
            return
        }
        const visited: WrapperLayer[] = []
        let current = layerOf(installed)
        while (current && visited.indexOf(current) === -1) {
            if (current.next === wrapper) {
                // Without a handler to hand over, the stopped wrapper stays as a no-op under `patch`.
                if (current.checksNext || isReachableFunction(layer.next)) {
                    current.next = layer.next
                }
                return
            }
            visited.push(current)
            current = layerOf(current.next)
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

const wrapOnError = (captureFn: CaptureFn) => {
    const win = window as any
    if (!win) {
        logger.info('window not available, cannot wrap onerror')
    }
    const layer: WrapperLayer = { next: safely(() => win.onerror, undefined), checksNext: true }
    let activeCaptureFn: CaptureFn | undefined = captureFn

    const wrapper = function (...args: ErrorEventArgs): boolean {
        if (activeCaptureFn) {
            safelyBuildAndCapture(activeCaptureFn, () =>
                errorPropertiesBuilder.buildFromUnknown(resolveOnErrorInput(args), {
                    mechanism: { handled: false },
                })
            )
        }
        const { next } = layer
        if (!isReachableFunction(next)) {
            return false
        }
        return next(...args) ?? false
    }
    win.onerror = wrapper
    markInstrumented(wrapper, layer)

    return () => {
        activeCaptureFn = undefined
        restore(win, 'onerror', wrapper, layer)
    }
}

const wrapUnhandledRejection = (captureFn: CaptureFn, defaultReturnValue = false) => {
    const win = window as any
    if (!win) {
        logger.info('window not available, cannot wrap onUnhandledRejection')
    }

    const layer: WrapperLayer = { next: safely(() => win.onunhandledrejection, undefined), checksNext: true }
    let activeCaptureFn: CaptureFn | undefined = captureFn

    const wrapper = function (ev: PromiseRejectionEvent): boolean {
        if (activeCaptureFn) {
            safelyBuildAndCapture(activeCaptureFn, () =>
                errorPropertiesBuilder.buildFromUnknown(ev, {
                    mechanism: { handled: false },
                })
            )
        }
        const { next } = layer
        if (!isReachableFunction(next)) {
            return defaultReturnValue
        }
        return next(ev) ?? false
    }
    win.onunhandledrejection = wrapper
    markInstrumented(wrapper, layer)

    return () => {
        activeCaptureFn = undefined
        restore(win, 'onunhandledrejection', wrapper, layer)
    }
}

const wrapConsoleError = (captureFn: CaptureFn) => {
    const con = console as any
    if (!con) {
        logger.info('console not available, cannot wrap console.error')
    }

    const layer: WrapperLayer = { next: safely(() => con.error, undefined), checksNext: true }
    let activeCaptureFn: CaptureFn | undefined = captureFn

    const wrapper = function (...args: any[]): void {
        // Check before selecting an Error argument, which loses the diagnostic prefix.
        // SDK loggers pass the prefix and diagnostic separately, including in older bundles.
        const isInternalDiagnostic = () =>
            safely(
                () =>
                    args.length > 1 &&
                    isString(args[0]) &&
                    (/^\[PostHog\.js\](?: |$)/.test(args[0]) || args[0] === 'rrweb logger error:'),
                false
            )
        if (activeCaptureFn && !isInternalDiagnostic()) {
            safelyBuildAndCapture(activeCaptureFn, () => {
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
        const { next } = layer
        if (isReachableFunction(next)) {
            next(...args)
        }
    }
    con.error = wrapper
    markInstrumented(wrapper, layer)

    return () => {
        activeCaptureFn = undefined
        restore(con, 'error', wrapper, layer)
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
