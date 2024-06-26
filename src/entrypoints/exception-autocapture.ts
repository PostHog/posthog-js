import { errorToProperties, unhandledRejectionToProperties } from '../extensions/exception-autocapture/error-conversion'
import { window } from '../utils/globals'
import { ErrorEventArgs, Properties } from '../types'
import { logger } from '../utils/logger'

const wrapOnError = (captureFn: (props: Properties) => void) => {
    const win = window as any
    if (!win) {
        logger.info('window not available, cannot wrap onerror')
    }
    const originalOnError = win.onerror

    win.onerror = function (...args: ErrorEventArgs): boolean {
        const errorProperties = errorToProperties(args)
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
;(window as any).posthogErrorWrappingFunctions = posthogErrorWrappingFunctions

export default posthogErrorWrappingFunctions
