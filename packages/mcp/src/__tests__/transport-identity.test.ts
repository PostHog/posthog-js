import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { instrument, PostHogMCP } from '../index'
import { PostHogMCPAnalyticsEvent, PostHogMCPAnalyticsProperty } from '../extensions/constants'
import {
  CLIENT_USER_AGENT_HEADER,
  VENDOR_CLIENT_HEADER,
  readTransportIdentity,
  stampTransportIdentity,
  type TransportIdentity,
} from '../extensions/transport-identity'
import type { CompatibleRequestHandlerExtra, McpEvent, MCPRequestLike, MCPServerLike } from '../types'
import { EventCapture, fakePostHog } from './test-utils'

// The surface disambiguation this feature exists for: `clientInfo.name` is
// `claude-code` for every Anthropic surface, and only the parenthetical differs.
const CLI_USER_AGENT = 'claude-code/2.1.0 (cli)'
const VSCODE_USER_AGENT = 'claude-code/2.1.0 (claude-vscode)'

type HeaderBag = Record<string, string | string[] | undefined>

function extraWith(headers: HeaderBag): CompatibleRequestHandlerExtra {
  return { requestInfo: { headers } }
}

function flushCaptures(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50))
}

describe('transport-identity (HTTP request headers)', () => {
  describe('readTransportIdentity', () => {
    it.each<[string, HeaderBag, TransportIdentity | undefined]>([
      [
        'both headers',
        { [CLIENT_USER_AGENT_HEADER]: CLI_USER_AGENT, [VENDOR_CLIENT_HEADER]: 'claude-code' },
        { clientUserAgent: CLI_USER_AGENT, vendorClient: 'claude-code' },
      ],
      ['the user-agent alone', { [CLIENT_USER_AGENT_HEADER]: CLI_USER_AGENT }, { clientUserAgent: CLI_USER_AGENT }],
      ['the vendor header alone', { [VENDOR_CLIENT_HEADER]: 'claude-code' }, { vendorClient: 'claude-code' }],
      [
        'a repeated (array-valued) header, taking the first entry',
        { [CLIENT_USER_AGENT_HEADER]: [CLI_USER_AGENT, VSCODE_USER_AGENT] },
        { clientUserAgent: CLI_USER_AGENT },
      ],
      [
        'a mixed-case key from a hand-rolled transport',
        { 'User-Agent': CLI_USER_AGENT },
        { clientUserAgent: CLI_USER_AGENT },
      ],
      ['an empty-string header', { [CLIENT_USER_AGENT_HEADER]: '' }, undefined],
      ['a whitespace-only header', { [CLIENT_USER_AGENT_HEADER]: '   ' }, undefined],
      ['an empty array', { [CLIENT_USER_AGENT_HEADER]: [] }, undefined],
      ['an explicitly undefined value', { [CLIENT_USER_AGENT_HEADER]: undefined }, undefined],
      ['a non-string value', { [CLIENT_USER_AGENT_HEADER]: 42 as unknown as string }, undefined],
      ['unrelated headers only', { 'content-type': 'application/json' }, undefined],
      ['an empty header bag', {}, undefined],
    ])('reads %s', (_label, headers, expected) => {
      expect(readTransportIdentity(extraWith(headers))).toEqual(expected)
    })

    it.each<[string, CompatibleRequestHandlerExtra | undefined]>([
      ['no extra at all', undefined],
      ['an extra without requestInfo (stdio / in-memory)', {}],
      ['a requestInfo without headers', { requestInfo: {} }],
      ['an explicitly undefined header bag', { requestInfo: { headers: undefined } }],
      ['a non-object header bag', { requestInfo: { headers: 'nope' as unknown as HeaderBag } }],
      ['a null header bag', { requestInfo: { headers: null as unknown as HeaderBag } }],
    ])('returns undefined for %s without throwing', (_label, extra) => {
      expect(() => readTransportIdentity(extra)).not.toThrow()
      expect(readTransportIdentity(extra)).toBeUndefined()
    })
  })

  describe('stampTransportIdentity', () => {
    it('stamps both headers onto the event', () => {
      const event: McpEvent = {}
      stampTransportIdentity(
        event,
        extraWith({ [CLIENT_USER_AGENT_HEADER]: CLI_USER_AGENT, [VENDOR_CLIENT_HEADER]: 'claude-code' })
      )
      expect(event.clientUserAgent).toBe(CLI_USER_AGENT)
      expect(event.vendorClient).toBe('claude-code')
    })

    it('leaves the event untouched on a transport with no headers', () => {
      const event: McpEvent = { clientName: 'claude-code' }
      stampTransportIdentity(event, {})
      expect(event.clientUserAgent).toBeUndefined()
      expect(event.vendorClient).toBeUndefined()
      expect(event.clientName).toBe('claude-code')
    })

    it('only overwrites the fields the request actually carries', () => {
      const event: McpEvent = { clientUserAgent: 'existing', vendorClient: 'existing-vendor' }
      stampTransportIdentity(event, extraWith({ [CLIENT_USER_AGENT_HEADER]: CLI_USER_AGENT }))
      expect(event.clientUserAgent).toBe(CLI_USER_AGENT)
      expect(event.vendorClient).toBe('existing-vendor')
    })

    it('does not cross-attribute across two concurrent requests sharing a server', () => {
      // Headers are per-request, so each request stamps its OWN event — nothing is
      // remembered server-wide that a sibling request could read back.
      const eventA: McpEvent = {}
      const eventB: McpEvent = {}
      stampTransportIdentity(eventA, extraWith({ [CLIENT_USER_AGENT_HEADER]: CLI_USER_AGENT }))
      stampTransportIdentity(eventB, extraWith({ [CLIENT_USER_AGENT_HEADER]: VSCODE_USER_AGENT }))
      expect(eventA.clientUserAgent).toBe(CLI_USER_AGENT)
      expect(eventB.clientUserAgent).toBe(VSCODE_USER_AGENT)
    })
  })

  describe('auto-capture via instrument()', () => {
    let capture: EventCapture

    beforeEach(async () => {
      capture = new EventCapture()
      await capture.start()
    })

    afterEach(async () => {
      await capture.stop()
    })

    function createServer(): MCPServerLike {
      const server = new Server({ name: 'transport-identity-test', version: '1.0.0' }, { capabilities: { tools: {} } })
      server.setRequestHandler(CallToolRequestSchema, async (request) => {
        if (request.params.arguments?.fail) {
          throw new Error('tool failed')
        }
        return { content: [{ type: 'text', text: 'ok' }] }
      })
      server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [{ name: 'echo', description: 'Echoes', inputSchema: { type: 'object' } }],
      }))
      instrument(server, fakePostHog())
      return server as unknown as MCPServerLike
    }

    function invoke(
      server: MCPServerLike,
      method: string,
      request: MCPRequestLike,
      extra?: CompatibleRequestHandlerExtra
    ): Promise<unknown> {
      const handler = server._requestHandlers.get(method)
      if (!handler) {
        throw new Error(`${method} handler was not registered`)
      }
      return handler(request, extra)
    }

    const AUTO_CAPTURED_EVENTS: Array<[string, string, MCPRequestLike]> = [
      [
        PostHogMCPAnalyticsEvent.ToolCall,
        'tools/call',
        { method: 'tools/call', params: { name: 'echo', arguments: {} } },
      ],
      [PostHogMCPAnalyticsEvent.ToolsList, 'tools/list', { method: 'tools/list', params: {} }],
      [
        PostHogMCPAnalyticsEvent.Initialize,
        'initialize',
        {
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'claude-code', version: '2.1.0' },
          },
        },
      ],
    ]

    it.each(AUTO_CAPTURED_EVENTS)('stamps both properties on %s', async (eventName, method, request) => {
      const server = createServer()
      await invoke(server, method, request, {
        requestInfo: { headers: { [CLIENT_USER_AGENT_HEADER]: CLI_USER_AGENT, [VENDOR_CLIENT_HEADER]: 'claude-code' } },
      })
      await flushCaptures()

      const payload = capture.findCapturesByEvent(eventName)[0]
      expect(payload?.properties).toMatchObject({
        [PostHogMCPAnalyticsProperty.ClientUserAgent]: CLI_USER_AGENT,
        [PostHogMCPAnalyticsProperty.VendorClient]: 'claude-code',
      })
    })

    it.each(AUTO_CAPTURED_EVENTS)(
      'omits both properties on %s for a transport without headers (stdio / in-memory)',
      async (eventName, method, request) => {
        const server = createServer()
        await invoke(server, method, request)
        await flushCaptures()

        const payload = capture.findCapturesByEvent(eventName)[0]
        expect(payload).toBeDefined()
        expect(payload.properties).not.toHaveProperty(PostHogMCPAnalyticsProperty.ClientUserAgent)
        expect(payload.properties).not.toHaveProperty(PostHogMCPAnalyticsProperty.VendorClient)
      }
    )

    it('caps an absurdly long user-agent so a hostile header cannot inflate the event', async () => {
      const server = createServer()
      await invoke(
        server,
        'tools/call',
        { method: 'tools/call', params: { name: 'echo', arguments: {} } },
        extraWith({ [CLIENT_USER_AGENT_HEADER]: 'x'.repeat(10_000) })
      )
      await flushCaptures()

      const userAgent = capture.findCapturesByEvent(PostHogMCPAnalyticsEvent.ToolCall)[0]?.properties[
        PostHogMCPAnalyticsProperty.ClientUserAgent
      ]
      expect(userAgent).toBe('x'.repeat(256) + '...')
    })

    it('carries the transport identity onto the $exception sibling of a failed call', async () => {
      const server = createServer()
      await expect(
        invoke(
          server,
          'tools/call',
          { method: 'tools/call', params: { name: 'echo', arguments: { fail: true } } },
          extraWith({ [CLIENT_USER_AGENT_HEADER]: CLI_USER_AGENT, [VENDOR_CLIENT_HEADER]: 'claude-code' })
        )
      ).rejects.toThrow('tool failed')
      await flushCaptures()

      expect(capture.findCapturesByEvent(PostHogMCPAnalyticsEvent.Exception)[0]?.properties).toMatchObject({
        [PostHogMCPAnalyticsProperty.ClientUserAgent]: CLI_USER_AGENT,
        [PostHogMCPAnalyticsProperty.VendorClient]: 'claude-code',
      })
    })

    it('keeps two overlapping requests from different surfaces attributed to their own headers', async () => {
      const server = createServer()
      await Promise.all([
        invoke(
          server,
          'tools/call',
          { method: 'tools/call', params: { name: 'from_cli', arguments: {} } },
          extraWith({ [CLIENT_USER_AGENT_HEADER]: CLI_USER_AGENT })
        ),
        invoke(
          server,
          'tools/call',
          { method: 'tools/call', params: { name: 'from_vscode', arguments: {} } },
          extraWith({ [CLIENT_USER_AGENT_HEADER]: VSCODE_USER_AGENT })
        ),
      ])
      await flushCaptures()

      const toolCalls = capture.findCapturesByEvent(PostHogMCPAnalyticsEvent.ToolCall)
      const userAgentOf = (toolName: string) =>
        toolCalls.find((event) => event.properties[PostHogMCPAnalyticsProperty.ToolName] === toolName)?.properties[
          PostHogMCPAnalyticsProperty.ClientUserAgent
        ]
      expect(userAgentOf('from_cli')).toBe(CLI_USER_AGENT)
      expect(userAgentOf('from_vscode')).toBe(VSCODE_USER_AGENT)
    })
  })

  describe('custom dispatcher via PostHogMCP', () => {
    let capture: EventCapture
    let posthog: PostHogMCP

    beforeEach(async () => {
      capture = new EventCapture()
      await capture.start()
      posthog = new PostHogMCP('phc_test', { host: 'http://localhost', flushAt: 1, fetchRetryCount: 0 })
    })

    afterEach(async () => {
      await capture.stop()
      await posthog.shutdown()
    })

    // The dispatcher path has no `extra`, so the host reads the headers off its own
    // request object and passes them in — these assert the pass-through works.
    it.each<[string, () => void]>([
      [
        PostHogMCPAnalyticsEvent.ToolCall,
        () =>
          posthog.captureToolCall({
            toolName: 'execute-sql',
            clientUserAgent: CLI_USER_AGENT,
            vendorClient: 'claude-code',
          }),
      ],
      [
        PostHogMCPAnalyticsEvent.Initialize,
        () => posthog.captureInitialize({ clientUserAgent: CLI_USER_AGENT, vendorClient: 'claude-code' }),
      ],
      [
        PostHogMCPAnalyticsEvent.ToolsList,
        () =>
          posthog.captureToolsList({
            toolNames: ['echo'],
            clientUserAgent: CLI_USER_AGENT,
            vendorClient: 'claude-code',
          }),
      ],
      [
        PostHogMCPAnalyticsEvent.MissingCapability,
        () =>
          posthog.captureMissingCapability({
            context: 'wanted a chart tool',
            clientUserAgent: CLI_USER_AGENT,
            vendorClient: 'claude-code',
          }),
      ],
    ])('stamps what the host passes on %s', async (eventName, emit) => {
      emit()
      await flushCaptures()

      expect(capture.findCapturesByEvent(eventName)[0]?.properties).toMatchObject({
        [PostHogMCPAnalyticsProperty.ClientUserAgent]: CLI_USER_AGENT,
        [PostHogMCPAnalyticsProperty.VendorClient]: 'claude-code',
      })
    })

    it('omits both properties when the host passes neither', async () => {
      posthog.captureToolCall({ toolName: 'execute-sql' })
      await flushCaptures()

      const properties = capture.findCapturesByEvent(PostHogMCPAnalyticsEvent.ToolCall)[0]?.properties
      expect(properties).not.toHaveProperty(PostHogMCPAnalyticsProperty.ClientUserAgent)
      expect(properties).not.toHaveProperty(PostHogMCPAnalyticsProperty.VendorClient)
    })
  })
})
