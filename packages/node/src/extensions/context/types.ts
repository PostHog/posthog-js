import type { JsonType } from '@posthog/core'

export interface ContextData {
  distinctId?: string
  sessionId?: string
  /** Properties that fill the keys an event left unset. The event's own values win. */
  properties?: Record<string, any>
  /**
   * Options that fill the options an event left unset (missing or `null`). The event's own options
   * win; these beat options from `registerOptions()`.
   */
  options?: Record<string, JsonType>
}

export interface ContextOptions {
  /**
   * If true, replaces the current context entirely.
   * If false, merges with the existing context (new values override existing ones).
   * @default false
   */
  fresh?: boolean
}

export interface IPostHogContext {
  get(): ContextData | undefined
  run<T>(context: ContextData, fn: () => T, options?: ContextOptions): T
  enter(context: ContextData, options?: ContextOptions): void
}
