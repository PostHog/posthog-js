import { createChunkLoader } from '../src/chunk-loader'

const deferred = <T>() => {
    let resolve!: (value: T) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
    })
    return { promise, resolve, reject }
}

describe('chunk loader', () => {
    it('defers invocation, shares in-flight work, and caches the successful result', async () => {
        const module = { feature: 'loaded' }
        const imported = deferred<typeof module>()
        const load = vi.fn(() => imported.promise)
        const loader = createChunkLoader(load)
        expect(loader.loading).toBeUndefined()
        expect(loader.failed).toBe(false)
        expect(load).not.toHaveBeenCalled()

        const first = loader.load()
        expect(loader.loading).toBe(first)
        expect(loader.load()).toBe(first)
        expect(load).not.toHaveBeenCalled()
        await Promise.resolve()
        expect(load).toHaveBeenCalledOnce()

        imported.resolve(module)
        await expect(first).resolves.toBe(module)
        expect(loader.loading).toBeUndefined()
        expect(loader.failed).toBe(false)
        expect(loader.load()).toBe(first)
        await expect(loader.load()).resolves.toBe(module)
        expect(load).toHaveBeenCalledOnce()
    })

    it.each([undefined, null, false, 0])('caches successful falsy values: %s', async (value) => {
        const load = vi.fn(() => value)
        const loader = createChunkLoader(load)
        await expect(loader.load()).resolves.toBe(value)
        await expect(loader.load()).resolves.toBe(value)
        expect(load).toHaveBeenCalledOnce()
    })

    it.each(['throw', 'reject'] as const)('allows another attempt after a load %s', async (failure) => {
        const cause = new Error('chunk unavailable')
        const load = vi
            .fn()
            .mockImplementationOnce(() => {
                if (failure === 'throw') {
                    throw cause
                }
                return Promise.reject(cause)
            })
            .mockResolvedValue('available')
        const loader = createChunkLoader(load)
        await expect(loader.load()).rejects.toBe(cause)
        expect(loader.loading).toBeUndefined()
        expect(loader.failed).toBe(true)
        expect(load).toHaveBeenCalledOnce()

        await expect(loader.load()).resolves.toBe('available')
        expect(load).toHaveBeenCalledTimes(2)
        expect(loader.failed).toBe(false)
    })

    it('keeps concurrent callers joined through a shared retry', async () => {
        const first = deferred<string>()
        const next = deferred<string>()
        const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise)
        const loader = createChunkLoader<string>(load)
        const ordinary = loader.load()
        const rejected = expect(ordinary).rejects.toThrow('first attempt failed')
        const a = loader.load(() => true)
        const b = loader.load(() => true)
        first.reject(new Error('first attempt failed'))
        await rejected
        await Promise.resolve()
        expect(load).toHaveBeenCalledTimes(2)
        next.resolve('ready')
        await expect(Promise.all([a, b])).resolves.toEqual(['ready', 'ready'])
        expect(load).toHaveBeenCalledTimes(2)
    })

    it('checks retry eligibility after failure, not when the caller starts waiting', async () => {
        const imported = deferred<void>()
        const load = vi.fn(() => imported.promise)
        const loader = createChunkLoader(load)
        let needed = true
        const pending = loader.load(() => needed)
        const rejected = expect(pending).rejects.toBeUndefined()
        needed = false
        imported.reject(undefined)
        await rejected
        expect(load).toHaveBeenCalledOnce()
        expect(loader.failed).toBe(true)
    })

    it('bounds an opted-in retry to one additional attempt and keeps its failure', async () => {
        const first = new Error('first')
        const second = new Error('second')
        const load = vi.fn().mockRejectedValueOnce(first).mockRejectedValue(second)
        const loader = createChunkLoader(load)
        await expect(loader.load(() => true)).rejects.toBe(second)
        expect(load).toHaveBeenCalledTimes(2)
        expect(loader.loading).toBeUndefined()
        expect(loader.failed).toBe(true)
    })

    it('publishes the shared promise before a loader can reenter', async () => {
        let reentered: Promise<string> | undefined
        const loader = createChunkLoader(() => {
            reentered = loader.load()
            return 'ready'
        })
        const pending = loader.load()
        await expect(pending).resolves.toBe('ready')
        expect(reentered).toBe(pending)
    })

    it('keeps independent loads isolated', async () => {
        const failed = createChunkLoader(() => Promise.reject(new Error('unavailable')))
        const successful = createChunkLoader(() => 'ready')
        await expect(failed.load()).rejects.toThrow('unavailable')
        await expect(successful.load()).resolves.toBe('ready')
        expect(failed.failed).toBe(true)
        expect(successful.failed).toBe(false)
    })
})
