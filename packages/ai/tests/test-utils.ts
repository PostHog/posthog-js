/**
 * Test utilities for async operations
 */

let apiPromiseShimInstalled = false

/**
 * Polyfills `_thenUnwrap` on `Promise.prototype` so wrappers calling it on
 * mocked SDK responses (plain Promises returned by `jest.fn().mockResolvedValue(...)`)
 * lift transparently into a real `openai.APIPromise`. Production code already
 * receives APIPromise from the SDK, so this only matters for test mocks.
 */
export function installAPIPromiseShim(): void {
  if (apiPromiseShimInstalled) {
    return
  }
  apiPromiseShimInstalled = true
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { APIPromise } = jest.requireActual('openai') as typeof import('openai')
  const proto = Promise.prototype as unknown as Record<string, unknown>
  proto['_thenUnwrap'] = function _thenUnwrap<T, U>(
    this: Promise<T>,
    transform: (data: T, props: { response: Response }) => U
  ): InstanceType<typeof APIPromise> {
    const responsePromise = this.then((data) => ({
      response: new Response(),
      options: {} as never,
      controller: new AbortController(),
      requestLogID: '',
      retryOfRequestLogID: undefined,
      startTime: 0,
      __testData: data,
    }))
    return new APIPromise<U>(
      {} as never,
      responsePromise as never,
      // eslint-disable-next-line @typescript-eslint/require-await
      async (_client, props) => transform((props as { __testData: T }).__testData, props) as never
    )
  }
}

/**
 * Waits for async operations to complete
 * Uses process.nextTick to ensure all microtasks are processed
 */
export async function waitForAsyncOperations(): Promise<void> {
  // Use process.nextTick to wait for all microtasks
  await new Promise(process.nextTick)
  // If fake timers are enabled, run them and flush again
  if (jest.isMockFunction(setTimeout)) {
    jest.runAllTimers()
    await new Promise(process.nextTick)
  }
}

/**
 * Alternative helper for tests that don't use fake timers
 * but still need to wait for async operations
 */
export async function flushPromises(): Promise<void> {
  await new Promise(process.nextTick)
}
