import { Agent } from 'undici'

import { isPositiveNumber } from '@posthog/core'
import type { PostHogFetchOptions, PostHogFetchResponse } from '@posthog/core'

/**
 * Default for {@link PostHogOptions.connectTimeout}. Node cancels a connect attempt after 250 ms,
 * which is shorter than a handshake between distant regions.
 */
export const DEFAULT_CONNECT_TIMEOUT = 2000

// Node holds the connect budget in a signed 32-bit integer.
const MAX_CONNECT_TIMEOUT = 2147483647

// Both the npm `undici` package and the copy inside Node read the global dispatcher from this key.
const UNDICI_GLOBAL_DISPATCHER = Symbol.for('undici.globalDispatcher.1')

const agentsByConnectTimeout = new Map<number, Agent>()

function readGlobalDispatcher(): { constructor?: { name?: string } } | undefined {
  return (globalThis as Record<symbol, unknown>)[UNDICI_GLOBAL_DISPATCHER] as
    | { constructor?: { name?: string } }
    | undefined
}

// Importing undici installs a plain agent under this key when nothing holds it yet, so in a fresh
// process this is that agent rather than anything the application chose.
const dispatcherAtLoad = readGlobalDispatcher()

/**
 * A dispatcher the application installed (`setGlobalDispatcher`, or Node's `NODE_USE_ENV_PROXY`)
 * must keep routing PostHog requests: it can carry a proxy, a connector, TLS settings or
 * interceptors that the agent here would drop. A default agent is either the one this module saw
 * when it loaded, or one Node installed later from the copy of undici inside it, which is never an
 * instance of the class imported here. The class name is the last check because both of those
 * report `Agent`, and it is all that separates a configured agent installed before this module
 * loaded from undici's own import-time default.
 */
function globalDispatcherIsDefault(): boolean {
  const current = readGlobalDispatcher()
  if (current == null) {
    return true
  }
  const isDefaultInstance = current === dispatcherAtLoad || !(current instanceof Agent)
  return isDefaultInstance && current.constructor?.name === 'Agent'
}

/**
 * Node rejects a budget it cannot hold in a signed 32-bit integer when the connection is made, not
 * when the agent is built, so a fraction, `Infinity`, a boxed number or too large a value would
 * fail every request instead of the one option. Those fall back to the default, as zero and
 * negative values already do.
 */
function isUsableConnectTimeout(connectTimeout: number | undefined): connectTimeout is number {
  return isPositiveNumber(connectTimeout) && Number.isInteger(connectTimeout) && connectTimeout <= MAX_CONNECT_TIMEOUT
}

/**
 * The dispatcher PostHog requests use, or `undefined` when the request must stay on the global
 * dispatcher. Agents are cached per connect timeout so every client shares one connection pool.
 */
export function resolveDispatcher(connectTimeout?: number): Agent | undefined {
  if (!globalDispatcherIsDefault()) {
    return undefined
  }

  const timeout = isUsableConnectTimeout(connectTimeout) ? connectTimeout : DEFAULT_CONNECT_TIMEOUT
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
