import { errorToProperties, unhandledRejectionToProperties } from '../extensions/exception-autocapture/error-conversion'
import { assignableWindow, window } from '../utils/globals'
import { ErrorEventArgs, Properties } from '../types'
import { createLogger } from '../utils/logger'

const logger = createLogger('[ExceptionAutocapture]')

const wrapOnError = (captureFn: (props: Properties) => void) => {
    const win = window as any
    if (!win) {
        logger.info('window not available, cannot wrap onerror')
    }
    const originalOnError = win.onerror

    win.onerror = function (...args: ErrorEventArgs): boolean {
        const errorProperties = errorToProperties({ event: args[0], error: args[4] })
        captureFn(errorProperties)
        return originalOnError?.(...args) ?? false
    }
    win.onerror.__POSTHOG_INSTRUMENTED__ = true

    return () => {
        delete win.onerror?.__POSTHOG_INSTRUMENTED__
        win.onerror = originalOnError
    }
}

const wrapUnhandledRejection = (captureFn: (props: Properties) => void) => {
    const win = window as any
    if (!win) {
        logger.info('window not available, cannot wrap onUnhandledRejection')
    }

    const originalOnUnhandledRejection = win.onunhandledrejection

    win.onunhandledrejection = function (...args: [ev: PromiseRejectionEvent]): boolean {
        const errorProperties = unhandledRejectionToProperties(args)
        captureFn(errorProperties)
        return originalOnUnhandledRejection?.apply(win, args) ?? false
    }
    win.onunhandledrejection.__POSTHOG_INSTRUMENTED__ = true

    return () => {
        delete win.onunhandledrejection?.__POSTHOG_INSTRUMENTED__
        win.onunhandledrejection = originalOnUnhandledRejection
    }
}

const posthogErrorWrappingFunctions = {
    wrapOnError,
    wrapUnhandledRejection,
}

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.errorWrappingFunctions = posthogErrorWrappingFunctions
assignableWindow.__PosthogExtensions__.parseErrorAsProperties = errorToProperties

// we used to put these on window, and now we put them on __PosthogExtensions__
// but that means that old clients which lazily load this extension are looking in the wrong place
// yuck,
// so we also put them directly on the window
// when 1.161.1 is the oldest version seen in production we can remove this
assignableWindow.posthogErrorWrappingFunctions = posthogErrorWrappingFunctions
assignableWindow.parseErrorAsProperties = errorToProperties

export default posthogErrorWrappingFunctions
