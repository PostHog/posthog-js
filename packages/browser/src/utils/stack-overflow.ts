import { isError } from '@posthog/core'

export const isStackOverflowError = (error: unknown): boolean =>
    isError(error) &&
    ((error.name === 'RangeError' && error.message.indexOf('Maximum call stack size exceeded') === 0) ||
        (error.name === 'InternalError' && error.message === 'too much recursion'))
