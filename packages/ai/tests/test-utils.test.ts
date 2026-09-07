import { waitForAsyncOperations } from './test-utils'

describe('waitForAsyncOperations', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs pending fake timers', async () => {
    vi.useFakeTimers()
    const callback = vi.fn()
    setTimeout(callback, 10)

    await waitForAsyncOperations()

    expect(callback).toHaveBeenCalledOnce()
  })
})
