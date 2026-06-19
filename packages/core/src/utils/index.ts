import { FetchLike } from '../types'

export * from './bot-detection'
export * from './bucketed-rate-limiter'
export * from './number-utils'
export * from './string-utils'
export * from './type-utils'
export * from './promise-queue'
export * from './logger'
export * from './user-agent-utils'

export const STRING_FORMAT = 'utf8'

const UUID_HEX_32_REGEX = /^[0-9a-f]{32}$/i
const UUID_HYPHENATED_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const UUID_BRACED_REGEX = /^\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}$/i
const UUID_URN_REGEX = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidUUID(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (UUID_HEX_32_REGEX.test(value) ||
      UUID_HYPHENATED_REGEX.test(value) ||
      UUID_BRACED_REGEX.test(value) ||
      UUID_URN_REGEX.test(value))
  )
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

// NOTE: We opt for this slightly imperfect check as the global "Promise" object can get mutated in certain environments
export const isPromise = (obj: any): obj is Promise<any> => {
  return obj && typeof obj.then === 'function'
}

export const isError = (x: unknown): x is Error => {
  return x instanceof Error
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
