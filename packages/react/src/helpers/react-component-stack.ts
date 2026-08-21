import { isUndefined } from '../utils/type-utils'

type ErrorWithCause = Error & { cause?: unknown }

const isError = (value: unknown): value is ErrorWithCause => {
    const tag = Object.prototype.toString.call(value)
    return (
        value instanceof Error ||
        tag === '[object Error]' ||
        tag === '[object Exception]' ||
        tag === '[object DOMException]' ||
        tag === '[object DOMError]'
    )
}

const setCause = (error: ErrorWithCause, cause: ErrorWithCause): void => {
    const seenErrors = new WeakSet<ErrorWithCause>()
    let currentError = error

    while (!seenErrors.has(currentError)) {
        seenErrors.add(currentError)

        if (!isError(currentError.cause)) {
            if (!isUndefined(currentError.cause)) {
                cause.cause = currentError.cause
            }
            currentError.cause = cause
            return
        }

        currentError = currentError.cause
    }
}

// Model React's component stack as a linked error so existing exception parsing and rendering can handle it.
export const addReactComponentStack = (error: unknown, componentStack?: string | null): unknown => {
    if (!componentStack) {
        return error
    }

    const componentStackError = new Error(
        isError(error) ? error.message : `Primitive value captured as exception: ${String(error)}`
    )
    componentStackError.name = `React ErrorBoundary ${isError(error) ? error.name : 'Error'}`
    componentStackError.stack = componentStack

    if (isError(error)) {
        setCause(error, componentStackError)
        return error
    }

    return componentStackError
}
