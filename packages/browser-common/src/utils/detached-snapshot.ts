import { isArray } from '@posthog/core'

/**
 * Recursively copies observer payloads so one consumer cannot mutate canonical
 * host state or values delivered to another consumer.
 */
export function detachedSnapshot<T>(value: T, seen = new Map<object, unknown>()): T {
    if (!value || typeof value !== 'object') {
        return value
    }
    if (Object.prototype.toString.call(value) === '[object Date]') {
        return new Date((value as unknown as Date).getTime()) as T
    }

    const existing = seen.get(value)
    if (existing) {
        return existing as T
    }

    const snapshot: unknown = isArray(value) ? [] : {}
    seen.set(value, snapshot)
    Object.keys(value).forEach((key) => {
        ;(snapshot as Record<string, unknown>)[key] = detachedSnapshot((value as Record<string, unknown>)[key], seen)
    })
    return snapshot as T
}
