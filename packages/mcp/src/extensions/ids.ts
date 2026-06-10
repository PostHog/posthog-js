import { uuidv7 } from '@posthog/core'

export type MCPAnalyticsIDPrefix = 'evt' | 'ses'

export function newPrefixedId(prefix: MCPAnalyticsIDPrefix): string {
  return `${prefix}_${uuidv7()}`
}

/**
 * Deterministic id derived from an arbitrary string. Used to map MCP protocol
 * session ids to SDK session ids so the same MCP session reuses the same
 * `$session_id` across server restarts.
 *
 * Uses the FNV-1a 64-bit hash (mixed twice to fill 32 hex chars), which works
 * everywhere — no `node:crypto`, no Web Crypto async API. Not cryptographic; we
 * only need stable, low-collision input → output mapping.
 */
export function deterministicPrefixedId(prefix: MCPAnalyticsIDPrefix, input: string): string {
  return `${prefix}_${fnv1aHex(input)}${fnv1aHex(`${input}::salt`)}`
}

function fnv1aHex(input: string): string {
  // 64-bit FNV-1a implemented with two 32-bit halves to stay within safe-integer range.
  let h1 = 0x84222325
  let h2 = 0xcbf29ce4
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x000001b3)
    h2 = Math.imul(h2 ^ c, 0x00000193)
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')
}
