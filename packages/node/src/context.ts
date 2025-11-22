import { AsyncLocalStorage } from 'async_hooks'

export interface ContextData {
  distinctId?: string
  sessionId?: string
  tags?: Record<string, any>
  enableExceptionAutocapture?: boolean
}

export interface ContextOptions {
  /**
   * If true, replaces the current context entirely.
   * If false, merges with the existing context (new values override existing ones).
   * @default true
   */
  fresh?: boolean
}

export class PostHogContext {
  private storage: AsyncLocalStorage<ContextData>

  constructor() {
    this.storage = new AsyncLocalStorage<ContextData>()
  }

  get(): ContextData | undefined {
    return this.storage.getStore()
  }

  run<T>(context: ContextData, fn: () => T, options: ContextOptions = { fresh: true }): T {
    const fresh = options.fresh !== false

    if (fresh) {
      return this.storage.run(context, fn)
    } else {
      const currentContext = this.storage.getStore() || {}
      const mergedContext: ContextData = {
        distinctId: context.distinctId ?? currentContext.distinctId,
        sessionId: context.sessionId ?? currentContext.sessionId,
        tags: {
          ...(currentContext.tags || {}),
          ...(context.tags || {}),
        },
        enableExceptionAutocapture: context.enableExceptionAutocapture ?? currentContext.enableExceptionAutocapture,
      }
      return this.storage.run(mergedContext, fn)
    }
  }
}
