import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { instrument, PostHog, PostHogMCP } from '../index'
import { version as mcpVersion } from '../version'
import { setupTestServerAndClient } from './test-utils/client-server-factory'

const CAPTURE_PATH = '/i/v1/analytics/events'

/** A fetch that accepts every request and records the capture requests' headers. */
function recordingFetch(): { fetch: any; captureHeaders: Record<string, string>[] } {
  const captureHeaders: Record<string, string>[] = []
  const fetch = vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
    if (url.includes(CAPTURE_PATH)) {
      captureHeaders.push(init.headers)
    }
    return {
      status: 200,
      text: async () => '{"results":{}}',
      json: async () => ({ results: {} }),
      headers: { get: () => null },
    }
  })
  return { fetch, captureHeaders }
}

/**
 * posthog-node identifies itself to PostHog (`$lib`, `$lib_version`, the `PostHog-Sdk-Info` and
 * `User-Agent` headers) from `getLibraryId()` / `getLibraryVersion()`. @posthog/mcp must leave
 * them as posthog-node's own, on its own client and on a client passed to `instrument()`;
 * `@posthog/ai` reads the version to pick posthog-node 6's AI capture lane.
 */
describe('lib identity', () => {
  const options = { host: 'http://localhost', flushAt: 1, fetchRetryCount: 0 } as const
  const nodeVersion = new PostHog('phc_test', { ...options, disabled: true }).getLibraryVersion()

  function instrumented(extra: Record<string, unknown> = {}): PostHog {
    const posthog = new PostHog('phc_test', { ...options, ...extra })
    const server = new McpServer({ name: 'my-mcp', version: '1.0.0' }, { capabilities: { tools: {} } })
    instrument(server, posthog)
    return posthog
  }

  const paths = [
    { path: 'PostHogMCP', makeClient: (extra = {}) => new PostHogMCP('phc_test', { ...options, ...extra }) },
    { path: 'instrument()', makeClient: instrumented },
  ]

  it('compares against a posthog-node version, not the @posthog/mcp one', () => {
    expect(nodeVersion).not.toBe(mcpVersion)
  })

  it.each(paths)('$path keeps posthog-node as the library id and version', async ({ makeClient }) => {
    const client = makeClient()
    try {
      expect(client.getLibraryId()).toBe('posthog-node')
      expect(client.getLibraryVersion()).toBe(nodeVersion)
    } finally {
      await client.shutdown()
    }
  })

  it.each(paths)('$path sends events as posthog-node', async ({ makeClient }) => {
    const { fetch, captureHeaders } = recordingFetch()
    const client = makeClient({ fetch })
    try {
      client.capture({ distinctId: 'user-1', event: 'example_event' })
      await client.flush()

      expect(captureHeaders).toHaveLength(1)
      expect(captureHeaders[0]['PostHog-Sdk-Info']).toBe(`posthog-node/${nodeVersion}`)
      expect(captureHeaders[0]['User-Agent']).toBe(`posthog-node/${nodeVersion}`)
    } finally {
      await client.shutdown()
    }
  })

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
