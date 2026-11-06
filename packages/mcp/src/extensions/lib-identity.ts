import type { PostHog } from 'posthog-node'

import { version } from '../version'
import { POSTHOG_MCP_LIB_NAME } from './constants'

/**
 * Make `client` report `@posthog/mcp`'s identity as the standard PostHog `$lib`
 * / `$lib_version` on every event it sends.
 *
 * posthog-node reads `getLibraryId()` / `getLibraryVersion()` for each event it
 * captures, so overriding the two methods relabels every later event. posthog-node 5
 * stamps them after `before_send`, so nothing else can change them. posthog-node 6
 * fills them as its lowest-precedence values, so a `$lib` set on the event,
 * in context or with `register()` wins, and `before_send` sees and can change them.
 * posthog-node 6 also sends them in the `PostHog-Sdk-Info` header, fixed when each
 * capture lane first sends. Shared by {@link PostHogMCP} (which calls this in its constructor) and
 * `instrument()` (which applies it to the host-supplied client) so both emit
 * paths report identical lib metadata.
 *
 * Because `$lib` is a client-level property, this relabels *every* event the
 * client sends as `posthog-node-mcp`, not just `$mcp_*` events — expected for a
 * dedicated MCP-analytics client.
 */
export function applyMcpLibIdentity(client: PostHog): void {
  client.getLibraryId = () => POSTHOG_MCP_LIB_NAME
  client.getLibraryVersion = () => version
}
