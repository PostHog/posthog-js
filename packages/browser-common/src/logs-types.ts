import type { LogSdkContext } from '@posthog/core'

// Internal contract between the main bundle and the lazily-loaded logs entrypoint.

/**
 * The console methods both bundles agree on: the main bundle records these, the
 * entrypoint maps and serializes them. Deriving both sides from this tuple makes
 * a missing level a compile error rather than a silently unbuffered one.
 */
export const BUFFERED_CONSOLE_LEVELS = ['debug', 'log', 'warn', 'error', 'info'] as const

export type BufferedConsoleLevel = (typeof BUFFERED_CONSOLE_LEVELS)[number]

/**
 * A `console.*` call the main bundle recorded before the logs entrypoint was available.
 *
 * `args` stay raw so the entrypoint's `stringifyArgsSafely` is the single serializer.
 * They are also held by reference: an object mutated between the console call and the
 * replay is serialized in its later state, unlike the live path which serializes inline.
 *
 * `context` and `occurredAtMs` are snapshotted at the console call, because identity,
 * session and feature flags can all change before the replay.
 */
export interface BufferedConsoleEntry {
    level: BufferedConsoleLevel
    args: any[]
    occurredAtMs: number
    context: LogSdkContext
}
