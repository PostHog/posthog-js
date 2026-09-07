import { Agent } from 'undici'

import { isPositiveNumber } from '@posthog/core'
import type { PostHogFetchOptions, PostHogFetchResponse } from '@posthog/core'

/**
 * Default for {@link PostHogOptions.connectTimeout}. Node cancels a connect attempt after 250 ms,
 * which is shorter than a handshake between distant regions.
 */
export const DEFAULT_CONNECT_TIMEOUT = 2000

// Both the npm `undici` package and the copy inside Node read the global dispatcher from this key.
const UNDICI_GLOBAL_DISPATCHER = Symbol.for('undici.globalDispatcher.1')

const agentsByConnectTimeout = new Map<number, Agent>()

/**
 * A proxy dispatcher (`setGlobalDispatcher`, or Node's `NODE_USE_ENV_PROXY`) must keep routing
 * PostHog requests, so only replace the plain default agent Node installs itself. That agent comes
 * from the copy of undici inside Node, so it is not an instance of the class imported here and the
 * class name is the only marker available.
 */
function globalDispatcherIsDefault(): boolean {
  const current = (globalThis as Record<symbol, unknown>)[UNDICI_GLOBAL_DISPATCHER] as
    | { constructor?: { name?: string } }
    | undefined
  return current == null || current.constructor?.name === 'Agent'
}

/**
 * The dispatcher PostHog requests use, or `undefined` when the request must stay on the global
 * dispatcher. Agents are cached per connect timeout so every client shares one connection pool.
 */
export function resolveDispatcher(connectTimeout?: number): Agent | undefined {
  if (!globalDispatcherIsDefault()) {
    return undefined
  }

  const timeout = isPositiveNumber(connectTimeout) ? connectTimeout : DEFAULT_CONNECT_TIMEOUT
  let agent = agentsByConnectTimeout.get(timeout)
  if (!agent) {
    agent = new Agent({ connect: { autoSelectFamilyAttemptTimeout: timeout } })
    agentsByConnectTimeout.set(timeout, agent)
  }
  return agent
}

export function fetchWithConnectTimeout(
  url: string,
  options: PostHogFetchOptions,
  connectTimeout?: number
): Promise<PostHogFetchResponse> {
  const dispatcher = resolveDispatcher(connectTimeout)
  if (!dispatcher) {
    return fetch(url, options)
  }
  const init: RequestInit & { dispatcher: Agent } = { ...options, dispatcher }
  return fetch(url, init)
}
