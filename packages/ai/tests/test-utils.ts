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
  if (vi.isFakeTimers()) {
    vi.runAllTimers()
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

/** Options a caller sets: one posthog-node 5 maps, one personless overrides, one 5 drops. */
export const USER_EVENT_OPTIONS = { process_person_profile: true, cookieless_mode: true, custom_option: 'six only' }

/** Each posthog-node major, with and without a user distinct id. */
export const EVENT_OPTION_CASES = [
  { major: 5, personless: false },
  { major: 5, personless: true },
  { major: 6, personless: false },
  { major: 6, personless: true },
] as const

/** Gives a mock client the `registerOptions` that tells posthog-node 6 apart from 5. */
export function asPostHogNodeMajor<T extends object>(client: T, major: 5 | 6): T {
  if (major === 6) {
    Object.assign(client, { registerOptions: vi.fn().mockResolvedValue(undefined) })
  }
  return client
}

/** Every event a mock client was handed, whichever capture method took it. */
export function capturedEvents(client: any): any[] {
  return ['capture', 'captureImmediate', 'captureAi', 'captureAiImmediate'].flatMap(
    (method) => client[method]?.mock?.calls.map(([event]: [unknown]) => event) ?? []
  )
}

/**
 * Asserts an event carries {@link USER_EVENT_OPTIONS} the way the client's major reads them, with
 * person processing off when the event is personless.
 */
export function expectUserEventOptions(event: any, major: 5 | 6, personless: boolean): void {
  if (major === 6) {
    expect(event.options).toEqual({ ...USER_EVENT_OPTIONS, process_person_profile: !personless })
    expect(event.properties).not.toHaveProperty('$process_person_profile')
    expect(event.properties).not.toHaveProperty('$cookieless_mode')
    return
  }
  expect(event.options).toBeUndefined()
  expect(event.properties).toMatchObject({ $process_person_profile: !personless, $cookieless_mode: true })
  expect(event.properties).not.toHaveProperty('custom_option')
}
