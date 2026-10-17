import type { ContextData } from './types'

export interface ContextLifetime {
  active: boolean
}

const lifetimes = new WeakMap<ContextData, ContextLifetime>()

export function bindContextLifetime(context: ContextData | undefined, lifetime: ContextLifetime): void {
  if (context) lifetimes.set(context, lifetime)
}

export function inheritContextLifetime(parent: ContextData | undefined, child: ContextData): ContextData {
  const lifetime = parent && lifetimes.get(parent)
  if (lifetime) lifetimes.set(child, lifetime)
  return child
}

export function isContextActive(context: ContextData): boolean {
  return lifetimes.get(context)?.active !== false
}
