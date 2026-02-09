import { assignableWindow, window } from '../utils/globals'
import { ErrorEventArgs } from '../types'
import { createLogger } from '../utils/logger'
import type { ErrorTracking } from '@posthog/core'
import { buildErrorPropertiesBuilder } from '../posthog-exceptions'

const logger = createLogger('[ExceptionAutocapture]')
const errorPropertiesBuilder = buildErrorPropertiesBuilder()

const wrapOnError = (captureFn: (props: ErrorTracking.ErrorProperties) => void) => {
    const win = window as any
    if (!win) {
        logger.info('window not available, cannot wrap onerror')
    }
    const originalOnError = win.onerror

    win.onerror = function (...args: ErrorEventArgs): boolean {
        const error = args[4]
        const event = args[0]
        const errorProperties = errorPropertiesBuilder.buildFromUnknown(error || event, {
            mechanism: { handled: false },
        })
        captureFn(errorProperties)
        return originalOnError?.(...args) ?? false
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
        return originalOnUnhandledRejection?.apply(win, [ev]) ?? false
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
        return originalConsoleError?.(...args)
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
