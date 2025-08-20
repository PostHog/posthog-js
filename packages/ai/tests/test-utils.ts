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