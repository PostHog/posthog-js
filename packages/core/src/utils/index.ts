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

/**
 * Creates an `Error` with the given `name`, in a way that also holds on pages where a browser
 * extension has made `Error.prototype.name` non-writable. A plain `error.name = ...` throws
 * there in strict mode, and swallowing that throw leaves the name as `Error`. Defining an own
 * property on the instance shadows the prototype property instead. The descriptor matches what
 * a plain assignment produces, so the resulting error is unchanged everywhere else.
 *
 * @param name the value for `error.name`, e.g. `'AbortError'`
 * @param message the error message
 * @internal Exposed for cross-package use within this SDK; not part of the stable public API.
 */
export function createNamedError(name: string, message?: string): Error {
  const error = new Error(message)
  try {
    Object.defineProperty(error, 'name', { value: name, writable: true, enumerable: true, configurable: true })
  } catch {
    // a page hostile enough to harden `Error.prototype` can also patch `Object.defineProperty`
  }
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
