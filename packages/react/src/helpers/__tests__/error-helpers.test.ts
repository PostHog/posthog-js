import type { ErrorInfo } from 'react'
import { setupReactErrorHandler } from '../error-helpers'

describe('setupReactErrorHandler', () => {
    it('captures the React component stack', () => {
        const captureException = jest.fn()
        const errorInfo: ErrorInfo = { componentStack: '\n    in CrashingComponent' }
        const handler = setupReactErrorHandler({ captureException } as any)

        handler(undefined, errorInfo)

        expect(captureException).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'Primitive value captured as exception: undefined',
                name: 'React ErrorBoundary Error',
                stack: errorInfo.componentStack,
            })
        )
    })

    it('appends the React component stack after existing error causes', () => {
        const captureException = jest.fn()
        const errorInfo: ErrorInfo = { componentStack: '\n    in CrashingComponent' }
        const handler = setupReactErrorHandler({ captureException } as any)
        const error = new Error('outer error') as Error & { cause?: unknown }
        const cause = new Error('inner error') as Error & { cause?: unknown }
        const nestedCause = new Error('nested error') as Error & { cause?: unknown }
        error.cause = cause
        cause.cause = nestedCause

        handler(error, errorInfo)

        expect(captureException).toHaveBeenCalledWith(error)
        expect(error.cause).toBe(cause)
        expect(cause.cause).toBe(nestedCause)
        expect(nestedCause.cause).toEqual(
            expect.objectContaining({
                name: 'React ErrorBoundary Error',
                stack: errorInfo.componentStack,
            })
        )
    })
})
