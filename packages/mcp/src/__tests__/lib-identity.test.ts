import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { instrument, PostHog, PostHogMCP } from '../index'
import { version } from '../version'

/**
 * Every event @posthog/mcp sends should self-identify with the standard PostHog
 * `$lib` / `$lib_version` keys (value `posthog-node-mcp`), not the inherited
 * `posthog-node` transport id. posthog-node stamps those from the client's
 * `getLibraryId()` / `getLibraryVersion()`, so we assert on the getters.
 */
describe('lib identity', () => {
  const options = { host: 'http://localhost', flushAt: 1, fetchRetryCount: 0 } as const

  function instrumented(): PostHog {
    const posthog = new PostHog('phc_test', options)
    const server = new McpServer({ name: 'my-mcp', version: '1.0.0' }, { capabilities: { tools: {} } })
    instrument(server, posthog)
    return posthog
  }

  // Both emit paths must report the identical `$lib` / `$lib_version` contract.
  it.each([
    { path: 'PostHogMCP', makeClient: () => new PostHogMCP('phc_test', options) },
    { path: 'instrument()', makeClient: instrumented },
  ])('$path reports $lib=posthog-node-mcp / $lib_version=<package version>', async ({ makeClient }) => {
    const client = makeClient()
    try {
      expect(client.getLibraryId()).toBe('posthog-node-mcp')
      expect(client.getLibraryVersion()).toBe(version)
    } finally {
      await client.shutdown()
    }
  })

  it('instrument() flips the host client from posthog-node to posthog-node-mcp', async () => {
    const posthog = new PostHog('phc_test', options)
    try {
      expect(posthog.getLibraryId()).toBe('posthog-node')
      const server = new McpServer({ name: 'my-mcp', version: '1.0.0' }, { capabilities: { tools: {} } })
      instrument(server, posthog)
      expect(posthog.getLibraryId()).toBe('posthog-node-mcp')
    } finally {
      await posthog.shutdown()
    }
  })
})
