import { Logger } from '@/types'
import { setTimeout as waitWithRealTimers } from 'node:timers/promises'

export const wait = async (t: number): Promise<void> => {
  await new Promise((r) => setTimeout(r, t))
}

export const waitForPromises = async (): Promise<void> => {
  await waitWithRealTimers(10)
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
    debug: vi.fn((...args) => console.debug(...args)),
    info: vi.fn((...args) => console.log(...args)),
    warn: vi.fn((...args) => console.warn(...args)),
    error: vi.fn((...args) => console.error(...args)),
    critical: vi.fn((...args) => console.error(...args)),
    createLogger: createMockLogger,
  }
}
