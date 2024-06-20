import { errorToProperties, unhandledRejectionToProperties } from './extensions/exception-autocapture/error-conversion'
import { assignableWindow } from './utils/globals'
import { ErrorConversions } from './types'

const errorConversion: ErrorConversions = {
    errorToProperties,
    unhandledRejectionToProperties,
}

assignableWindow.posthogErrorConversion = errorConversion

export default errorConversion
