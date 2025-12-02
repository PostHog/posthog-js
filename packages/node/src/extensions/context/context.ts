import { AsyncLocalStorage } from 'node:async_hooks'
import { ContextData, ContextOptions, IPostHogContext } from './types'

export class PostHogContext implements IPostHogContext {
  private storage: AsyncLocalStorage<ContextData>

  constructor() {
    this.storage = new AsyncLocalStorage<ContextData>()
  }

  get(): ContextData | undefined {
    return this.storage.getStore()
  }

  run<T>(context: ContextData, fn: () => T, options?: ContextOptions): T {
    const fresh = options?.fresh === true

    if (fresh) {
      return this.storage.run(context, fn)
    } else {
      const currentContext = this.get() || {}
      const mergedContext: ContextData = {
        distinctId: context.distinctId ?? currentContext.distinctId,
        sessionId: context.sessionId ?? currentContext.sessionId,
        properties: {
          ...(currentContext.properties || {}),
          ...(context.properties || {}),
        },
      }
      return this.storage.run(mergedContext, fn)
    }
  }
}
