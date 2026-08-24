import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { instrument } from '../index'
import { DEFAULT_MODEL_PARAMETER_DESCRIPTION } from '../extensions/constants'
import { addModelParameterToTool, addModelParameterToTools } from '../extensions/model-parameters'
import { log } from '../extensions/logger'
import { EventCapture, fakePostHog } from './test-utils'
import { resetTodos, setupTestServerAndClient } from './test-utils/client-server-factory'

jest.mock('../extensions/logger', () => ({
  createLogger: (logger?: (message: string) => void) => logger ?? (() => undefined),
  log: jest.fn(),
  setLogger: jest.fn(),
}))

const mockedLog = jest.mocked(log)

beforeEach(() => {
  mockedLog.mockClear()
})

afterEach(() => {
  jest.restoreAllMocks()
})

/**
 * --- Unit tests: `addModelParameterToTool` / `addModelParameterToTools` ---
 *
 * Same pure-function contract as the `context` injection: mutate a JSON-Schema
 * tool descriptor to add a required `llm_model` string parameter.
 */
describe('addModelParameterToTool', () => {
  it.each([
    ['no inputSchema', { name: 'tool' }],
    ['empty inputSchema {}', { name: 'tool', inputSchema: {} }],
    [
      'inputSchema with existing properties + required',
      {
        name: 'tool',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
      },
    ],
  ])('injects a string llm_model param + marks it required (%s)', (_, tool) => {
    const result = addModelParameterToTool(tool as Parameters<typeof addModelParameterToTool>[0])

    expect(result.inputSchema?.properties?.llm_model).toEqual({
      type: 'string',
      description: DEFAULT_MODEL_PARAMETER_DESCRIPTION,
    })
    expect(result.inputSchema?.required).toContain('llm_model')
  })

  it('preserves existing required fields when adding llm_model', () => {
    const result = addModelParameterToTool({
      name: 'tool',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    })

    expect(result.inputSchema?.required).toEqual(expect.arrayContaining(['text', 'llm_model']))
  })

  it('removes additionalProperties:false (would otherwise reject the injected param)', () => {
    const result = addModelParameterToTool({
      name: 'strict-tool',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        additionalProperties: false,
      },
    })

    expect(result.inputSchema?.properties?.llm_model).toBeDefined()
    expect(result.inputSchema?.additionalProperties).toBeUndefined()
  })

  it.each([
    [
      'tool already has an llm_model property',
      {
        name: 'has-model',
        inputSchema: { type: 'object', properties: { llm_model: { type: 'number', description: 'existing' } } },
      },
      "already has 'llm_model' parameter",
    ],
    ['schema uses a root $ref', { name: 'referenced-tool', inputSchema: { $ref: '#/$defs/Input' } }, 'complex schema'],
    [
      'schema uses oneOf',
      { name: 'union-tool', inputSchema: { oneOf: [{ type: 'object', properties: {} }] } },
      'complex schema',
    ],
  ])('skips + warns when %s', (_, tool, expectedWarningSubstring) => {
    const before = JSON.parse(JSON.stringify(tool))
    const result = addModelParameterToTool(tool as Parameters<typeof addModelParameterToTool>[0])

    expect(result.inputSchema).toEqual(before.inputSchema)
    expect(mockedLog).toHaveBeenCalledWith(expect.stringContaining(expectedWarningSubstring))
  })

  it('uses a custom description when provided', () => {
    const customDescription = 'State your model identifier'
    const result = addModelParameterToTool({ name: 'tool' }, customDescription)

    expect(result.inputSchema?.properties?.llm_model?.description).toBe(customDescription)
  })
})

describe('addModelParameterToTools (batch)', () => {
  it('applies the right outcome per tool in a mixed batch', () => {
    const result = addModelParameterToTools([
      { name: 'plain', inputSchema: { type: 'object', properties: {} } },
      { name: 'complex', inputSchema: { oneOf: [{ type: 'string' }] } },
      { name: 'collision', inputSchema: { type: 'object', properties: { llm_model: { type: 'number' } } } },
    ])

    expect(result[0].inputSchema?.properties?.llm_model).toBeDefined()
    expect(result[1].inputSchema?.properties).toBeUndefined()
    expect(result[2].inputSchema?.properties?.llm_model?.type).toBe('number')
    expect(mockedLog).toHaveBeenCalledTimes(2)
  })
})

/**
 * --- Integration tests: captureModel against a real MCP server ---
 */
describe('Model capture — integration with an instrumented server', () => {
  let server: any
  let client: any
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    resetTodos()
    const setup = await setupTestServerAndClient()
    server = setup.server
    client = setup.client
    cleanup = setup.cleanup
  })

  afterEach(async () => {
    await cleanup()
  })

  it('does not inject llm_model when captureModel is off (default)', async () => {
    instrument(server, fakePostHog(), {})

    const toolsResponse = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
    for (const tool of toolsResponse.tools) {
      expect(tool.inputSchema.properties?.llm_model).toBeUndefined()
    }
  })

  it.each([
    ['default', true, DEFAULT_MODEL_PARAMETER_DESCRIPTION],
    ['custom', { description: 'Which model are you?' }, 'Which model are you?'],
  ])('injects the llm_model parameter on every tool in tools/list (%s description)', async (_, option, expected) => {
    instrument(server, fakePostHog(), { captureModel: option as any })

    const toolsResponse = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
    const userTools = toolsResponse.tools.filter((t: any) =>
      ['add_todo', 'list_todos', 'complete_todo'].includes(t.name)
    )

    expect(userTools).toHaveLength(3)
    for (const tool of userTools) {
      expect(tool.inputSchema.properties.llm_model).toBeDefined()
      expect(tool.inputSchema.properties.llm_model.type).toBe('string')
      expect(tool.inputSchema.properties.llm_model.description).toBe(expected)
    }
  })

  it('captures llm_model as $mcp_llm_model with source=self_reported and strips it from the tool args', async () => {
    const capture = new EventCapture()
    await capture.start()
    try {
      instrument(server, fakePostHog(), { captureModel: true })

      // Prime ownership the way a real client does: list tools first.
      await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)

      const result = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'add_todo',
            arguments: { text: 'buy milk', llm_model: 'claude-opus-4-8' },
          },
        },
        CallToolResultSchema
      )

      // The tool ran normally — the injected argument never reached the handler.
      expect(result.content[0].text).toContain('buy milk')

      const toolCalls = capture.findCapturesByEvent('$mcp_tool_call')
      expect(toolCalls).toHaveLength(1)
      expect(toolCalls[0].properties.$mcp_llm_model).toBe('claude-opus-4-8')
      expect(toolCalls[0].properties.$mcp_llm_model_source).toBe('self_reported')
      // Stripped from the captured parameters too — it is analytics metadata, not an argument.
      expect((toolCalls[0].properties.$mcp_parameters as any)?.llm_model).toBeUndefined()
    } finally {
      await capture.stop()
    }
  })

  it('omits the property when the agent passes "unknown"', async () => {
    const capture = new EventCapture()
    await capture.start()
    try {
      instrument(server, fakePostHog(), { captureModel: true })
      await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)

      await client.request(
        {
          method: 'tools/call',
          params: { name: 'add_todo', arguments: { text: 'x', llm_model: 'unknown' } },
        },
        CallToolResultSchema
      )

      const toolCalls = capture.findCapturesByEvent('$mcp_tool_call')
      expect(toolCalls).toHaveLength(1)
      expect(toolCalls[0].properties.$mcp_llm_model).toBeUndefined()
      expect(toolCalls[0].properties.$mcp_llm_model_source).toBeUndefined()
    } finally {
      await capture.stop()
    }
  })

  it('does not capture or strip llm_model when captureModel is off', async () => {
    const capture = new EventCapture()
    await capture.start()
    try {
      instrument(server, fakePostHog(), {})
      await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)

      await client.request(
        {
          method: 'tools/call',
          params: { name: 'add_todo', arguments: { text: 'x' } },
        },
        CallToolResultSchema
      )

      const toolCalls = capture.findCapturesByEvent('$mcp_tool_call')
      expect(toolCalls).toHaveLength(1)
      expect(toolCalls[0].properties.$mcp_llm_model).toBeUndefined()
    } finally {
      await capture.stop()
    }
  })
})

/**
 * --- Ownership: a customer-declared llm_model parameter is never stolen ---
 */
describe('llm_model ownership', () => {
  it('passes a customer-declared llm_model argument through to the callback and does not capture it', async () => {
    const server = new McpServer({ name: 'model-ownership', version: '1.0.0' })
    let receivedArgs: Record<string, unknown> | undefined

    server.registerTool(
      'pick_model',
      {
        inputSchema: z.object({
          llm_model: z.string(),
          prompt: z.string(),
        }),
      },
      async (args) => {
        receivedArgs = { ...args }
        return { content: [{ type: 'text', text: 'ok' }] }
      }
    )

    const client = new Client({ name: 'model-ownership-client', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([client.connect(clientTransport), server.server.connect(serverTransport)])

    const capture = new EventCapture()
    await capture.start()
    try {
      instrument(server, fakePostHog(), { captureModel: true })
      await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)

      await client.request(
        {
          method: 'tools/call',
          params: { name: 'pick_model', arguments: { llm_model: 'gpt-5', prompt: 'hi' } },
        },
        CallToolResultSchema
      )

      // The application owns this parameter: it must reach the handler untouched...
      expect(receivedArgs).toEqual({ llm_model: 'gpt-5', prompt: 'hi' })
      // ...and must not be recorded as the calling agent's model.
      const toolCalls = capture.findCapturesByEvent('$mcp_tool_call')
      expect(toolCalls).toHaveLength(1)
      expect(toolCalls[0].properties.$mcp_llm_model).toBeUndefined()
    } finally {
      await capture.stop()
      await clientTransport.close?.()
      await serverTransport.close?.()
    }
  })
})
