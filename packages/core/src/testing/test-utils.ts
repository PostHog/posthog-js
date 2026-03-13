import { Logger } from '@/types'

export const wait = async (t: number): Promise<void> => {
  await new Promise((r) => setTimeout(r, t))
}

export const waitForPromises = async (): Promise<void> => {
  // Flush all pending microtasks and promises
  // vi.advanceTimersByTimeAsync advances fake timers while also processing microtasks
  await vi.advanceTimersByTimeAsync(0)
  // Run an additional microtask tick to ensure all chained promises resolve
  await new Promise<void>((resolve) => queueMicrotask(resolve))
}

export const parseBody = (mockCall: any): any => {
  const options = mockCall[1]
  expect(options.method).toBe('POST')
  return JSON.parse(options.body || '')
}

export const createImperativePromise = <T>(): [Promise<T>, (value: T) => void] => {
  let resolve: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return [promise, (val) => resolve?.(val)]
}

export const delay = (ms: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export const createMockLogger = (): Logger => {
  return {
    info: vi.fn((...args) => console.log(...args)),
    warn: vi.fn((...args) => console.warn(...args)),
    error: vi.fn((...args) => console.error(...args)),
    critical: vi.fn((...args) => console.error(...args)),
    createLogger: createMockLogger,
  }
}
