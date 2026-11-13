import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { instrument, PostHog, PostHogMCP } from '../index'
import { version } from '../version'
import { setupTestServerAndClient } from './test-utils/client-server-factory'

/**
 * Every event @posthog/mcp sends should self-identify with the standard PostHog
 * `$lib` / `$lib_version` keys (value `posthog-node-mcp`), not the inherited
 * `posthog-node` transport id. posthog-node fills those from the client's
 * `getLibraryId()` / `getLibraryVersion()` when the event doesn't set `$lib`.
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

  it('labels each event on the wire with the identity at capture time, and an event $lib beats the label', async () => {
    const fetch = vi.fn(async (_url: string, _init: any) => ({
      status: 200,
      text: async () => JSON.stringify({ results: {} }),
      json: async () => ({ results: {} }),
      headers: { get: () => null },
    }))
    const posthog = new PostHog('phc_test', { ...options, captureCompression: 'none', fetch: fetch as any })
    try {
      posthog.capture({ distinctId: 'u', event: 'before_instrument' })
      await posthog.flush()
      const server = new McpServer({ name: 'my-mcp', version: '1.0.0' }, { capabilities: { tools: {} } })
      instrument(server, posthog)
      posthog.capture({ distinctId: 'u', event: 'after_instrument' })
      posthog.capture({ distinctId: 'u', event: 'own_lib', properties: { $lib: 'my-app' } })
      posthog.capture({ distinctId: 'u', event: 'own_pair', properties: { $lib: 'my-app', $lib_version: '2.0.0' } })
      posthog.capture({ distinctId: 'u', event: 'node_lib', properties: { $lib: 'posthog-node' } })
      await posthog.flush()

      const events = fetch.mock.calls
        .filter(([url]) => String(url).endsWith('/i/v1/analytics/events'))
        .flatMap(([, init]) => JSON.parse(init.body).batch)
      expect(events.map((e: any) => [e.event, e.properties.$lib, e.properties.$lib_version])).toEqual([
        ['before_instrument', 'posthog-node', expect.any(String)],
        ['after_instrument', 'posthog-node-mcp', version],
        ['own_lib', 'my-app', undefined],
        ['own_pair', 'my-app', '2.0.0'],
        ['node_lib', 'posthog-node', undefined],
      ])
      expect(events[0].properties.$lib_version).not.toBe(version)
    } finally {
      await posthog.shutdown()
    }
  })

  it.each(['PostHogMCP', 'instrument()'])(
    '%s sends the label in the PostHog-Sdk-Info header when it labels the client before its first capture',
    async (path) => {
      const fetch = vi.fn(async (_url: string, _init: any) => ({
        status: 200,
        text: async () => JSON.stringify({ results: {} }),
        json: async () => ({ results: {} }),
        headers: { get: () => null },
      }))
      const clientOptions = { ...options, captureCompression: 'none', fetch: fetch as any } as const
      const posthog =
        path === 'PostHogMCP' ? new PostHogMCP('phc_test', clientOptions) : new PostHog('phc_test', clientOptions)
      try {
        if (path === 'instrument()') {
          instrument(new McpServer({ name: 'my-mcp', version: '1.0.0' }, { capabilities: { tools: {} } }), posthog)
        }
        posthog.capture({ distinctId: 'u', event: 'e' })
        await posthog.flush()

        const captureCalls = fetch.mock.calls.filter(([url]) => String(url).endsWith('/i/v1/analytics/events'))
        expect(captureCalls).toHaveLength(1)
        expect(captureCalls[0][1].headers['PostHog-Sdk-Info']).toBe(`posthog-node-mcp/${version}`)
      } finally {
        await posthog.shutdown()
      }
    }
  )

  it.each(['PostHogMCP', 'instrument()'])('%s keeps shared properties on tool calls and exceptions', async (path) => {
    const beforeSend = vi.fn(() => null)
    const posthog = new PostHogMCP('phc_test', { ...options, before_send: beforeSend })
    const { server, client, cleanup } = await setupTestServerAndClient()
    try {
      await posthog.register({ $mcp_server_build: 'example-build', environment: 'test' })
      if (path === 'PostHogMCP') {
        posthog.captureToolCall({ toolName: 'example-tool', isError: true, error: new Error('example failure') })
      } else {
        instrument(server, posthog, { enableConversationId: false })
        await client
          .request(
            { method: 'tools/call', params: { name: 'complete_todo', arguments: { id: 'missing' } } },
            CallToolResultSchema
          )
          .catch(() => undefined)
      }

      await vi.waitFor(() => {
        for (const name of ['$mcp_tool_call', '$exception']) {
          expect(beforeSend).toHaveBeenCalledWith(
            expect.objectContaining({
              event: name,
              properties: expect.objectContaining({ $mcp_server_build: 'example-build', environment: 'test' }),
            })
          )
        }
      })
    } finally {
      await cleanup()
      await posthog.shutdown()
    }
  })

  it('keeps the instrumented server build when the client has a different default', async () => {
    const beforeSend = vi.fn(() => null)
    const posthog = new PostHogMCP('phc_test', {
      ...options,
      before_send: beforeSend,
      serverBuild: 'client-build',
    })
    const { server, client, cleanup } = await setupTestServerAndClient()
    try {
      instrument(server, posthog, { enableConversationId: false, serverBuild: 'instrumented-build' })
      await client
        .request(
          { method: 'tools/call', params: { name: 'complete_todo', arguments: { id: 'missing' } } },
          CallToolResultSchema
        )
        .catch(() => undefined)

      await vi.waitFor(() => {
        expect(beforeSend).toHaveBeenCalledWith(
          expect.objectContaining({
            event: '$mcp_tool_call',
            properties: expect.objectContaining({ $mcp_server_build: 'instrumented-build' }),
          })
        )
      })
    } finally {
      await cleanup()
      await posthog.shutdown()
    }
  })
})
