/* eslint-disable compat/compat */
import { createDisposable } from '../src/disposable'

describe('createDisposable', () => {
    it('invokes teardown at most once and discards its result', () => {
        const teardown = jest.fn(() => 'ignored')
        const disposable = createDisposable(teardown)

        expect(disposable.dispose()).toBeUndefined()
        expect(disposable.dispose()).toBeUndefined()
        expect(teardown).toHaveBeenCalledTimes(1)
    })

    it('contains rejected asynchronous teardown without awaiting it', async () => {
        const teardown = jest.fn(async () => {
            throw new Error('async teardown failed')
        })
        const disposable = createDisposable(teardown)

        expect(disposable.dispose()).toBeUndefined()
        await Promise.resolve()

        expect(teardown).toHaveBeenCalledTimes(1)
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
