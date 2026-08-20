// A posthog-node stand-in that records events in memory. No API key, no network —
// verify.mjs reads the recorded array back over /__events.
//
// The logger matters as much as the events. `instrument()` reports every internal
// failure through it and otherwise returns a healthy-looking handle, which is the
// exact silent-degradation this harness exists to catch.

import { instrument, getRequestHeaders } from '@posthog/mcp'

export interface RecordedEvent {
  event: string
  distinctId?: string
  properties?: Record<string, unknown>
}

export const events: RecordedEvent[] = []
export const warnings: string[] = []

/**
 * What `extra` actually looked like each time a host callback received it.
 *
 * ADR-0006 says we hand host callbacks the SDK's own `extra`, unnormalised — so
 * on v2 there must be **no** `requestInfo`, because synthesising one would be a
 * convincing partial lie. That used to be proved indirectly, by leaving
 * `identify` v1-shaped and letting it fail; this records the shape instead, so
 * the invariant is asserted positively and `identify` is free to be correct.
 */
export interface ObservedExtraShape {
  hasRequestInfo: boolean
  hasHttpReq: boolean
  headersResolved: boolean
}
export const extraShapes: ObservedExtraShape[] = []

const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

function summarise(e: RecordedEvent): string {
  const p = e.properties ?? {}
  return [
    e.event,
    p.$mcp_tool_name ? `tool=${p.$mcp_tool_name}` : null,
    p.$session_id ? `session=${String(p.$session_id).slice(0, 12)}…` : null,
    p.$mcp_client_name ? `client=${p.$mcp_client_name}` : null,
    p.$mcp_protocol_version ? `proto=${p.$mcp_protocol_version}` : null,
    p.$mcp_intent ? `intent=${JSON.stringify(p.$mcp_intent)}` : null,
    p.$mcp_is_error ? 'ERROR' : null,
  ]
    .filter(Boolean)
    .join(' ')
}

function record(event: RecordedEvent): void {
  events.push(event)
  console.log(`${DIM}[posthog]${RESET} ${summarise(event)}`)
}

const client = {
  capture: (event: RecordedEvent) => record(event),
  identify: (event: RecordedEvent) => record({ ...event, event: '$identify' }),
  captureException: (error: unknown, distinctId?: string, properties?: Record<string, unknown>) =>
    record({ event: '$exception', distinctId, properties: { ...properties, message: String(error) } }),
  flush: async () => {},
  shutdown: async () => {},
}

const logger = (...args: unknown[]): void => {
  const line = args.join(' ')
  // Match the SDK's own prefixes only, so routine notices are not counted as
  // failures. A substring match on /fail/ would flag "Tool fail_always callback
  // already wrapped".
  if (/^(Warning|Error):|compatibility error|Failed to /.test(line)) warnings.push(line)
  console.log(`${DIM}[posthog:sdk]${RESET} ${line}`)
}

export function reset(): void {
  events.length = 0
  warnings.length = 0
  extraShapes.length = 0
}

/**
 * `identify` reads a header through the **exported** `getRequestHeaders`, which
 * is the migration the SDK documents for hosts moving to v2 — one line instead
 * of a hand-written two-branch read that gets case-insensitivity, array values
 * and the cross-realm `Headers` check wrong.
 *
 * This used to be left v1-shaped (`extra.requestInfo.headers`) so that its
 * failure would stand as the ADR-0006 assertion. That cost four assertions
 * across two eras and proved the invariant only by inference. The invariant is
 * now asserted directly from `extraShapes` below, which frees this callback to
 * do the correct thing — and makes it the only end-to-end coverage that
 * `getRequestHeaders` actually resolves headers on a v2 server.
 *
 * `IDENTIFY=legacy` restores the old v1-shaped read, for reproducing what a
 * host sees before they migrate.
 */
function identifyFromHeader(_request: unknown, extra: any) {
  extraShapes.push({
    hasRequestInfo: !!extra?.requestInfo,
    hasHttpReq: !!extra?.http?.req,
    headersResolved: !!getRequestHeaders(extra),
  })
  const auth =
    process.env.IDENTIFY === 'legacy'
      ? (extra?.requestInfo?.headers?.['authorization'] ?? extra?.requestInfo?.headers?.['Authorization'])
      : getRequestHeaders(extra)?.['authorization']
  if (typeof auth !== 'string') return null
  const token = auth.replace(/^Bearer\s+/i, '')
  return { distinctId: `user_${token}`, properties: { token } }
}

/**
 * The integration under test. mcp-nest calls this with the **high-level v2
 * `McpServer`**, then binds `tools/list` / `tools/call` afterwards via
 * `server.server.setRequestHandler('tools/list', …)` — string method names, on
 * the low-level server, after instrumentation.
 */
export const instrumentationMutator = (server: any) => {
  instrument(server, client as any, {
    logger,
    context: true,
    enableConversationId: true,
    identify: identifyFromHeader as any,
  })
  return server
}

/** Same, but through the `instrument(server.server)` workaround users adopted. */
export const instrumentationMutatorLowLevel = (server: any) => {
  instrument(server.server, client as any, {
    logger,
    context: true,
    enableConversationId: true,
    identify: identifyFromHeader as any,
  })
  return server
}
