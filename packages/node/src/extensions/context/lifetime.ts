import type { ContextData } from './types'

export interface ContextLifetime {
  signal: AbortSignal
  parent?: ContextLifetime
}

// The CommonJS and ESM builds are separate module copies. An app can create its client with one
// and load an integration with the other, so both share one registry through a global.
const REGISTRY_KEY = Symbol.for('posthog-node.context-lifetimes')
const registryHolder = globalThis as typeof globalThis & { [REGISTRY_KEY]?: WeakMap<ContextData, ContextLifetime> }
const lifetimes = (registryHolder[REGISTRY_KEY] ??= new WeakMap())

export function inheritContextLifetime(
  parent: ContextData | undefined,
  child: ContextData,
  signal?: AbortSignal
): ContextData {
  const lifetime = parent && lifetimes.get(parent)
  if (signal) lifetimes.set(child, { signal, parent: lifetime })
  else if (lifetime) lifetimes.set(child, lifetime)
  return child
}

export function isContextActive(context: ContextData): boolean {
  let lifetime = lifetimes.get(context)
  while (lifetime) {
    if (lifetime.signal.aborted) return false
    lifetime = lifetime.parent
  }
  return true
}

/**
 * Returns a signal that aborts when the given context ends, or `undefined` if nothing can end it.
 *
 * A context ends when the AbortSignal given to its `withContext` call aborts. A nested context
 * also ends when any context it is nested in ends, so it can depend on several signals. This
 * combines them into one signal, so a fresh context can take it and end at the same time.
 */
export function getContextLifetimeSignal(context: ContextData): AbortSignal | undefined {
  const signals: AbortSignal[] = []
  for (let lifetime = lifetimes.get(context); lifetime; lifetime = lifetime.parent) {
    signals.push(lifetime.signal)
  }

  if (signals.length === 0) {
    return undefined
  }

  return signals.length === 1 ? signals[0] : AbortSignal.any(signals)
}
