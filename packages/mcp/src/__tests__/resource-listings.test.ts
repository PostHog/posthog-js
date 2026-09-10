import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ListResourceTemplatesRequestSchema, ListResourcesRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { instrument } from '../index'
import { EventCapture, fakePostHog } from './test-utils'

/**
 * `resources/list` and `resources/templates/list` are one PostHog event —
 * `$mcp_resources_list` — and the captured `request.method` is what separates a
 * static listing from a templated one. Both adapters have to wire both methods,
 * so this runs against the real SDK rather than a double: the high-level
 * `McpServer`, where a `ResourceTemplate` registration is what makes the SDK
 * serve `resources/templates/list` at all, and the low-level `Server` in the v1
 * Zod-schema registration form.
 *
 * A listing's result is captured as `$mcp_response` — names, uris, and uri
 * templates are discovery metadata, not the resource bodies a read returns.
 */

const PassthroughResultSchema = z.object({}).passthrough()

const GUIDE = { name: 'guide', uri: 'file:///guide.md' }
const USER_TEMPLATE = { name: 'user', uriTemplate: 'users://{id}' }

function setupHighLevelServer(): McpServer {
  const server = new McpServer({ name: 'resource test', version: '1.0.0' })
  server.resource(GUIDE.name, GUIDE.uri, async (uri) => ({ contents: [{ uri: uri.href, text: '# Guide' }] }))
  server.resource(
    USER_TEMPLATE.name,
    new ResourceTemplate(USER_TEMPLATE.uriTemplate, { list: undefined }),
    async (uri) => ({ contents: [{ uri: uri.href, text: 'user' }] })
  )
  instrument(server, fakePostHog())
  return server
}

function setupLowLevelServer(): Server {
  const server = new Server({ name: 'resource test', version: '1.0.0' }, { capabilities: { resources: {} } })
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [GUIDE] }))
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: [USER_TEMPLATE],
  }))
  instrument(server, fakePostHog())
  return server
}

async function connect(server: McpServer | Server) {
  const client = new Client({ name: 'test client', version: '1.0' }, { capabilities: {} })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
  return {
    client,
    async cleanup() {
      await clientTransport.close?.()
      await serverTransport.close?.()
    },
  }
}

describe.each([
  ['high-level McpServer', setupHighLevelServer],
  ['low-level Server', setupLowLevelServer],
])('%s resource listings', (_label, setup) => {
  let eventCapture: EventCapture

  beforeEach(async () => {
    eventCapture = new EventCapture()
    await eventCapture.start()
  })

  afterEach(async () => {
    await eventCapture.stop()
  })

  it.each([
    ['resources/list', 'resources', GUIDE],
    ['resources/templates/list', 'resourceTemplates', USER_TEMPLATE],
  ])('captures %s as $mcp_resources_list carrying the listing', async (method, field, entry) => {
    const { client, cleanup } = await connect(setup())
    try {
      const result = await client.request({ method, params: {} }, PassthroughResultSchema)
      expect(result[field]).toEqual(expect.arrayContaining([expect.objectContaining(entry)]))

      await vi.waitFor(() => expect(eventCapture.findCapturesByEvent('$mcp_resources_list')).toHaveLength(1))
      const props = eventCapture.findCapturesByEvent('$mcp_resources_list')[0].properties
      expect(props.$mcp_parameters.request.method).toBe(method)
      expect(props.$mcp_response[field]).toEqual(expect.arrayContaining([expect.objectContaining(entry)]))
      expect(props.$mcp_is_error).toBe(false)
      expect(props.$mcp_duration_ms).toBeGreaterThanOrEqual(0)
      expect(props.$mcp_resource_name).toBeUndefined()
    } finally {
      await cleanup()
    }
  })
})
