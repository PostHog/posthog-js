/**
 * Test utilities for async operations
 */

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

/**
 * Runs `consume`, settles pending micro/macrotasks, and returns every
 * `unhandledRejection` emitted while it ran. Used to assert that the detached
 * analytics stream monitors never crash the host process when a provider
 * stream errors mid-flight.
 */
export async function collectUnhandledRejections(consume: () => Promise<void>): Promise<unknown[]> {
  const rejections: unknown[] = []
  const listener = (reason: unknown): void => {
    rejections.push(reason)
  }
  process.on('unhandledRejection', listener)
  try {
    await consume()
    await flushPromises()
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))
  } finally {
    process.off('unhandledRejection', listener)
  }
  return rejections
}
