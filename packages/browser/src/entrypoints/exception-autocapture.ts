import { window } from '@posthog/browser-common/utils/globals'
import { assignableWindow } from '../utils/globals'
import { ErrorEventArgs } from '../types'
import { createLogger } from '@posthog/browser-common/utils/logger'
import { isFunction, isString, type ErrorTracking } from '@posthog/core'
import { buildErrorPropertiesBuilder } from '../posthog-exceptions'

const logger = createLogger('[ExceptionAutocapture]')
const errorPropertiesBuilder = buildErrorPropertiesBuilder()

// `window.onerror` receives the error's location positionally as
// (message, source, lineno, colno, error). When there's no real Error object to
// forward, reconstruct an ErrorEvent from those args so the coercer can keep the
// message and build a frame from the location — otherwise source/lineno/colno
// are silently dropped and the message becomes a stackless, hard-to-group error.
const resolveOnErrorInput = ([event, source, lineno, colno, error]: ErrorEventArgs): unknown => {
    if (error) {
        return error
    }
    if (isString(event) && isString(source) && source.length > 0 && typeof ErrorEvent !== 'undefined') {
        return new ErrorEvent('error', { message: event, filename: source, lineno, colno })
    }
    return event
}

const wrapOnError = (captureFn: (props: ErrorTracking.ErrorProperties) => void) => {
    const win = window as any
    if (!win) {
        logger.info('window not available, cannot wrap onerror')
    }
    const originalOnError = win.onerror

    win.onerror = function (...args: ErrorEventArgs): boolean {
        const errorProperties = errorPropertiesBuilder.buildFromUnknown(resolveOnErrorInput(args), {
            mechanism: { handled: false },
        })
        captureFn(errorProperties)
        return isFunction(originalOnError) ? (originalOnError(...args) ?? false) : false
    }
    win.onerror.__POSTHOG_INSTRUMENTED__ = true

    return () => {
        delete win.onerror?.__POSTHOG_INSTRUMENTED__
        win.onerror = originalOnError
    }
}

const wrapUnhandledRejection = (captureFn: (props: ErrorTracking.ErrorProperties) => void) => {
    const win = window as any
    if (!win) {
        logger.info('window not available, cannot wrap onUnhandledRejection')
    }

    const originalOnUnhandledRejection = win.onunhandledrejection

    win.onunhandledrejection = function (ev: PromiseRejectionEvent): boolean {
        const errorProperties = errorPropertiesBuilder.buildFromUnknown(ev, {
            mechanism: { handled: false },
        })
        captureFn(errorProperties)
        return isFunction(originalOnUnhandledRejection) ? (originalOnUnhandledRejection(ev) ?? false) : false
    }
    win.onunhandledrejection.__POSTHOG_INSTRUMENTED__ = true

    return () => {
        delete win.onunhandledrejection?.__POSTHOG_INSTRUMENTED__
        win.onunhandledrejection = originalOnUnhandledRejection
    }
}

const wrapConsoleError = (captureFn: (props: ErrorTracking.ErrorProperties) => void) => {
    const con = console as any
    if (!con) {
        logger.info('console not available, cannot wrap console.error')
    }

    const originalConsoleError = con.error

    con.error = function (...args: any[]): void {
        let event
        if (args.length == 1) {
            event = args[0]
        } else {
            event = args.join(' ')
        }
        const error = args.find((arg) => arg instanceof Error)
        const errorProperties = errorPropertiesBuilder.buildFromUnknown(error || event, {
            mechanism: { handled: false },
            syntheticException: new Error('PostHog syntheticException'),
            skipFirstLines: 2,
        })
        captureFn(errorProperties)
        if (isFunction(originalConsoleError)) {
            originalConsoleError(...args)
        }
    }
    con.error.__POSTHOG_INSTRUMENTED__ = true

    return () => {
        delete con.error?.__POSTHOG_INSTRUMENTED__
        con.error = originalConsoleError
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

export default posthogErrorWrappingFunctions
