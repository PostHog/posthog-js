import { AsyncLocalStorage } from 'node:async_hooks'
import { ContextData, ContextOptions, IPostHogContext } from './types'
import { inheritContextLifetime, isContextActive } from './lifetime'

export class PostHogContext implements IPostHogContext {
  private storage: AsyncLocalStorage<ContextData>

  constructor() {
    this.storage = new AsyncLocalStorage<ContextData>()
  }

  get(): ContextData | undefined {
    const context = this.storage.getStore()
    return context && isContextActive(context) ? context : undefined
  }

  run<T>(context: ContextData, fn: () => T, options?: ContextOptions): T {
    return this.storage.run(this.resolve(context, options), fn)
  }

  enter(context: ContextData, options?: ContextOptions): void {
    this.storage.enterWith(this.resolve(context, options))
  }

  private resolve(context: ContextData, options?: ContextOptions): ContextData {
    const current = this.get()
    if (options?.fresh === true) {
      return inheritContextLifetime(undefined, { ...context }, options.signal)
    }

    return inheritContextLifetime(
      current,
      {
        distinctId: context.distinctId ?? current?.distinctId,
        sessionId: context.sessionId ?? current?.sessionId,
        properties: {
          ...(current?.properties || {}),
          ...(context.properties || {}),
        },
      },
      options?.signal
    )
  }
}
