import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { instrument, PostHog } from '../index'
import { version } from '../version'

/**
 * Every event @posthog/mcp sends should self-identify with the standard PostHog
 * `$lib` / `$lib_version` keys (value `posthog-node-mcp`), not the inherited
 * `posthog-node` transport id. posthog-node stamps those from the client's
 * `getLibraryId()` / `getLibraryVersion()`, so we assert on the getters.
 */
describe('lib identity', () => {
  it('instrument() relabels the host client to $lib=posthog-node-mcp', async () => {
    const posthog = new PostHog('phc_test', { host: 'http://localhost', flushAt: 1, fetchRetryCount: 0 })
    try {
      expect(posthog.getLibraryId()).toBe('posthog-node')

      const server = new McpServer({ name: 'my-mcp', version: '1.0.0' }, { capabilities: { tools: {} } })
      instrument(server, posthog)

      expect(posthog.getLibraryId()).toBe('posthog-node-mcp')
      expect(posthog.getLibraryVersion()).toBe(version)
    } finally {
      await posthog.shutdown()
    }
  })
})
