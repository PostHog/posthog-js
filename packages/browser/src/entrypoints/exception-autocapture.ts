import { assignableWindow } from '../utils/globals'
import { createLogger } from '@posthog/browser-common/utils/logger'
import { isArray, isFunction, isNull, type ErrorTracking } from '@posthog/core'
import posthogErrorWrappingFunctions from '../extensions/exception-autocapture/error-wrapping-functions'

const logger = createLogger('[ExceptionAutocapture]')
const { wrapOnError, wrapUnhandledRejection } = posthogErrorWrappingFunctions

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
