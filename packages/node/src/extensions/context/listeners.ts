import type { PostHogBackendClient } from '../../client'

type ContextListener = (requestEntry: boolean) => void

type ContextListenerRegistry = WeakMap<PostHogBackendClient, Set<ContextListener>>

// The CommonJS and ESM builds are separate module copies, so they share one registry through a global.
const REGISTRY_KEY = Symbol.for('posthog-node.context-listeners')
const registryHolder = globalThis as typeof globalThis & { [REGISTRY_KEY]?: ContextListenerRegistry }
const listeners = (registryHolder[REGISTRY_KEY] ??= new WeakMap())

export function addContextListener(client: PostHogBackendClient, listener: ContextListener): () => void {
  const callbacks = listeners.get(client) ?? new Set<ContextListener>()
  listeners.set(client, callbacks)
  callbacks.add(listener)
  return () => {
    callbacks.delete(listener)
    if (!callbacks.size) listeners.delete(client)
  }
}

export function notifyContextListeners(client: PostHogBackendClient, requestEntry = false): void {
  for (const listener of listeners.get(client) ?? []) {
    try {
      listener(requestEntry)
    } catch {}
  }
}

/**
 * Notify installed span processors after request IDs become available.
 * This entry point does not load OpenTelemetry; without a processor it does nothing.
 */
export function enrichCurrentSpan(client: PostHogBackendClient): void {
  notifyContextListeners(client, true)
}
