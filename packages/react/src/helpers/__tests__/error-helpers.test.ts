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
})
