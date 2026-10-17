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
