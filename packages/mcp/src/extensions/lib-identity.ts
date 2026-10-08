import type { PostHog } from 'posthog-node'

import { version } from '../version'
import { POSTHOG_MCP_LIB_NAME } from './constants'

/**
 * Make `client` report `@posthog/mcp`'s identity as the standard PostHog `$lib`
 * / `$lib_version` on every event it sends.
 *
 * posthog-node stamps `$lib` / `$lib_version` from `getLibraryId()` /
 * `getLibraryVersion()` and spreads them *last* when building the payload, so
 * they can't be overridden per-event via the captured properties (nor via
 * `before_send`, which runs earlier). Overriding the two methods is the only
 * lever. Shared by {@link PostHogMCP} (which calls this in its constructor) and
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
