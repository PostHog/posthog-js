import type { PostHogBackendClient } from '../../client'

type ContextListener = (requestEntry: boolean) => void

const listeners = new WeakMap<PostHogBackendClient, Set<ContextListener>>()

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
