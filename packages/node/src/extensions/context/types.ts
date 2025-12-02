export interface ContextData {
  distinctId?: string
  sessionId?: string
  properties?: Record<string, any>
}

export interface ContextOptions {
  /**
   * If true (default), merges with the existing context (new values override existing ones).
   * If false, replaces the current context entirely.
   * @default true
   */
  inherit?: boolean
}

export interface IPostHogContext {
  get(): ContextData | undefined
  run<T>(context: ContextData, fn: () => T, options?: ContextOptions): T
}
