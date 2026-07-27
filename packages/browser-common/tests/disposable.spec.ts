/* eslint-disable compat/compat */
import { createDisposable } from '../src/disposable'

describe('createDisposable', () => {
    it('invokes synchronous teardown at most once', () => {
        const teardown = jest.fn()
        const disposable = createDisposable(teardown)

        disposable.dispose()
        disposable.dispose()

        expect(teardown).toHaveBeenCalledTimes(1)
    })

    it('returns the asynchronous teardown result', async () => {
        const result = Promise.resolve()
        const disposable = createDisposable(() => result)

        const firstDisposal = disposable.dispose()
        const secondDisposal = disposable.dispose()

        expect(firstDisposal).toBe(result)
        expect(secondDisposal).toBe(firstDisposal)
        await secondDisposal
    })

    it('does not retry teardown after it throws', () => {
        const teardown = jest.fn(() => {
            throw new Error('failed')
        })
        const disposable = createDisposable(teardown)

        expect(() => disposable.dispose()).toThrow('failed')
        expect(disposable.dispose()).toBeUndefined()
        expect(teardown).toHaveBeenCalledTimes(1)
    })
})
