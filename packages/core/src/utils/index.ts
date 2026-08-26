import { FetchLike } from '../types'

export * from './bot-detection'
export * from './browser-utils'
export * from './bucketed-rate-limiter'
// Named rather than `export *`: the budgets, markers and `sanitizeString` are
// shared with the OTLP encoder but are not public API.
export { toJsonSafeValue } from './json-utils'
export * from './number-utils'
export * from './string-utils'
export * from './type-utils'
export * from './promise-queue'
export * from './logger'
export * from './user-agent-utils'

export const STRING_FORMAT = 'utf8'

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidUUID(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value)
}

export function getEventUuid(uuid: unknown, generateUuid: () => string): string {
  return isValidUUID(uuid) ? uuid : generateUuid()
}

// Some anti-fingerprinting browser extensions make `Error.prototype.name` non-writable.
// A plain `error.name = ...` then throws a `TypeError`, and even when caught the write is a
// no-op that walks the prototype chain, so the name silently stays `Error` and timeout
// detection by error name still breaks. Define an own property on the instance instead: it
// shadows the non-writable prototype property, so the name survives on hardened pages. The
// descriptor matches a plain assignment (writable + enumerable + configurable), so there is
// no behavior change in normal browsers. The try/catch guards the exotic case of a
// non-extensible instance.
export function createNamedError(name: string, message?: string): Error {
  const error = new Error(message)
  try {
    Object.defineProperty(error, 'name', { value: name, writable: true, enumerable: true, configurable: true })
  } catch {}
  return error
}

export function assert(truthyValue: any, message: string): void {
  if (!truthyValue || typeof truthyValue !== 'string' || isEmpty(truthyValue)) {
    throw new Error(message)
  }
}

function isEmpty(truthyValue: string): boolean {
  if (truthyValue.trim().length === 0) {
    return true
  }
  return false
}

export function removeTrailingSlash(url: string): string {
  return url?.replace(/\/+$/, '')
}

export function stripUrlHash<T extends string | undefined>(url: T): T extends string ? string : undefined {
  if (!url) {
    return url as any
  }

  return url.split('#')[0] as any
}

export interface RetriableOptions {
  retryCount: number
  retryDelay: number
  retryCheck: (err: unknown) => boolean
}

export async function retriable<T>(fn: () => Promise<T>, props: RetriableOptions): Promise<T> {
  let lastError = null

  for (let i = 0; i < props.retryCount + 1; i++) {
    if (i > 0) {
      // don't wait when it's the last try
      await new Promise<void>((r) => setTimeout(r, props.retryDelay))
    }

    try {
      const res = await fn()
      return res
    } catch (e) {
      lastError = e
      if (!props.retryCheck(e)) {
        throw e
      }
    }
  }

  throw lastError
}

export function currentTimestamp(): number {
  return new Date().getTime()
}

export function currentISOTime(): string {
  return new Date().toISOString()
}

export function safeSetTimeout(fn: () => void, timeout: number): any {
  // NOTE: we use this so rarely that it is totally fine to do `safeSetTimeout(fn, 0)``
  // rather than setImmediate.
  const t = setTimeout(fn, timeout) as any
  // We unref if available to prevent Node.js hanging on exit
  t?.unref && t?.unref()
  return t
}

export async function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void
): Promise<T | void> {
  let timeoutHandle: ReturnType<typeof safeSetTimeout> | undefined

  try {
    return await Promise.race([
      promise,
      new Promise<void>((resolve, reject) => {
        timeoutHandle = safeSetTimeout(() => {
          try {
            onTimeout?.()
            resolve()
          } catch (error) {
            reject(error)
          }
        }, timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timeoutHandle)
  }
}

// NOTE: We opt for this slightly imperfect check as the global "Promise" object can get mutated in certain environments
export const isPromise = (obj: any): obj is Promise<any> => {
  return obj && typeof obj.then === 'function'
}

export function getFetch(): FetchLike | undefined {
  return typeof fetch !== 'undefined' ? fetch : typeof globalThis.fetch !== 'undefined' ? globalThis.fetch : undefined
}

export function allSettled<T>(
  promises: (Promise<T> | null | undefined)[]
): Promise<({ status: 'fulfilled'; value: T } | { status: 'rejected'; reason: any })[]> {
  return Promise.all(
    promises.map((p) =>
      (p ?? Promise.resolve()).then(
        (value: any) => ({ status: 'fulfilled' as const, value }),
        (reason: any) => ({ status: 'rejected' as const, reason })
      )
    )
  )
}
