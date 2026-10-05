import { addReactComponentStack } from '../react-component-stack'

describe('addReactComponentStack', () => {
    const withFrozenErrorName = (run: () => void): void => {
        const descriptor = Object.getOwnPropertyDescriptor(Error.prototype, 'name') ?? {
            value: 'Error',
            writable: true,
            enumerable: false,
            configurable: true,
        }
        Object.defineProperty(Error.prototype, 'name', { value: 'Error', writable: false, configurable: true })
        try {
            run()
        } finally {
            Object.defineProperty(Error.prototype, 'name', descriptor)
        }
    }

    it('names the component stack error when Error.prototype.name is non-writable', () => {
        withFrozenErrorName(() => {
            const error = new Error('boom') as Error & { cause?: unknown }

            expect(addReactComponentStack(error, '\n    in CrashingComponent')).toBe(error)
            expect((error.cause as Error).name).toBe('React ErrorBoundary Error')
        })
    })

    it('names a primitive component stack error when Error.prototype.name is non-writable', () => {
        withFrozenErrorName(() => {
            const wrapped = addReactComponentStack('boom', '\n    in CrashingComponent') as Error

            expect(wrapped.name).toBe('React ErrorBoundary Error')
            expect(wrapped.message).toBe('Primitive value captured as exception: boom')
        })
    })
})
