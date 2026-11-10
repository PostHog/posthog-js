import type { ContextData } from './types'

export interface ContextLifetime {
  signal: AbortSignal
  parent?: ContextLifetime
}

const lifetimes = new WeakMap<ContextData, ContextLifetime>()

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
 * The signal that ends this context's lifetime, combining every signal it inherited, or
 * `undefined` when nothing bounds it. Lets a fresh context end when the context it copies ends.
 */
export function getContextLifetimeSignal(context: ContextData): AbortSignal | undefined {
  const signals: AbortSignal[] = []
  for (let lifetime = lifetimes.get(context); lifetime; lifetime = lifetime.parent) {
    signals.push(lifetime.signal)
  }
  if (signals.length === 0) return undefined
  return signals.length === 1 ? signals[0] : AbortSignal.any(signals)
}
