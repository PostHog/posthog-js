import { CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { instrument } from '../index'
import { DEFAULT_CONTEXT_PARAMETER_DESCRIPTION } from '../extensions/constants'
import { addContextParameterToTool, addContextParameterToTools } from '../extensions/context-parameters'
import { MCPAnalyticsEventType } from '../extensions/event-types'
import { log } from '../extensions/logger'
import { EventCapture } from './test-utils'
import { resetTodos, setupTestServerAndClient } from './test-utils/client-server-factory'

jest.mock('../extensions/logger', () => ({
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
 * --- Unit tests: `addContextParameterToTool` / `addContextParameterToTools` ---
 *
 * These exercise the pure function that mutates a JSON-Schema tool descriptor.
 * Integration with a real MCP server is covered in the second describe block.
 */
describe('addContextParameterToTool', () => {
  describe('schema augmentation', () => {
    it.each([
      ['no inputSchema', { name: 'tool' }],
      ['empty inputSchema {}', { name: 'tool', inputSchema: {} }],
      ['inputSchema with only type', { name: 'tool', inputSchema: { type: 'object' } }],
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
      [
        'inputSchema with empty required array',
        { name: 'tool', inputSchema: { type: 'object', properties: {}, required: [] } },
      ],
    ])('injects a string context param + marks it required (%s)', (_, tool) => {
      const result = addContextParameterToTool(tool as Parameters<typeof addContextParameterToTool>[0])

      expect(result.inputSchema?.properties?.context).toEqual({
        type: 'string',
        description: DEFAULT_CONTEXT_PARAMETER_DESCRIPTION,
      })
      expect(result.inputSchema?.required).toContain('context')
    })

    it('preserves existing required fields when adding context', () => {
      const result = addContextParameterToTool({
        name: 'tool',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      })

      expect(result.inputSchema?.required).toEqual(expect.arrayContaining(['text', 'context']))
    })

    it('removes additionalProperties:false (would otherwise reject the injected param)', () => {
      const result = addContextParameterToTool({
        name: 'strict-tool',
        inputSchema: {
          type: 'object',
          properties: { name: { type: 'string' } },
          additionalProperties: false,
        },
      })

      expect(result.inputSchema?.properties?.context).toBeDefined()
      expect(result.inputSchema?.additionalProperties).toBeUndefined()
    })

    it('leaves additionalProperties:true alone', () => {
      const result = addContextParameterToTool({
        name: 'flexible-tool',
        inputSchema: { type: 'object', properties: {}, additionalProperties: true },
      })

      expect(result.inputSchema?.additionalProperties).toBe(true)
    })
  })

  describe('skip cases (warns + leaves tool unchanged)', () => {
    it.each([
      [
        'tool already has a context property',
        {
          name: 'has-context',
          inputSchema: { type: 'object', properties: { context: { type: 'number', description: 'existing' } } },
        },
        "already has 'context' parameter",
      ],
      [
        'schema uses oneOf',
        { name: 'union-tool', inputSchema: { oneOf: [{ type: 'object', properties: {} }] } },
        'complex schema',
      ],
      [
        'schema uses allOf',
        { name: 'intersection-tool', inputSchema: { allOf: [{ type: 'object', properties: {} }] } },
        'complex schema',
      ],
      [
        'schema uses anyOf',
        { name: 'anyof-tool', inputSchema: { anyOf: [{ type: 'string' }, { type: 'number' }] } },
        'complex schema',
      ],
    ])('%s', (_, tool, expectedWarningSubstring) => {
      const before = JSON.parse(JSON.stringify(tool))
      const result = addContextParameterToTool(tool as Parameters<typeof addContextParameterToTool>[0])

      expect(result.inputSchema).toEqual(before.inputSchema)
      expect(mockedLog).toHaveBeenCalledWith(expect.stringContaining(expectedWarningSubstring))
    })
  })

  describe('uses custom description when provided', () => {
    it('overrides the default description', () => {
      const customDescription = 'Explain your reasoning for this action'
      const result = addContextParameterToTool({ name: 'tool' }, customDescription)

      expect(result.inputSchema?.properties?.context?.description).toBe(customDescription)
    })
  })
})

describe('addContextParameterToTools (batch)', () => {
  it('skips the get_more_tools virtual tool', () => {
    const result = addContextParameterToTools([
      { name: 'get_more_tools', inputSchema: {} },
      { name: 'other-tool', inputSchema: {} },
    ])

    expect(result[0].inputSchema?.properties).toBeUndefined()
    expect(result[1].inputSchema?.properties?.context).toBeDefined()
  })

  it('applies the right outcome per tool in a mixed batch', () => {
    const result = addContextParameterToTools([
      { name: 'plain', inputSchema: { type: 'object', properties: {} } },
      { name: 'complex', inputSchema: { oneOf: [{ type: 'string' }] } },
      { name: 'collision', inputSchema: { type: 'object', properties: { context: { type: 'number' } } } },
    ])

    expect(result[0].inputSchema?.properties?.context).toBeDefined()
    expect(result[1].inputSchema?.properties).toBeUndefined()
    expect(result[2].inputSchema?.properties?.context?.type).toBe('number')
    // One warning for the complex schema, one for the collision.
    expect(mockedLog).toHaveBeenCalledTimes(2)
  })
})

/**
 * --- Integration tests: context arg + intentFallback against a real MCP server ---
 */
describe('Context Parameters — integration with an instrumented server', () => {
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

  it.each([
    ['default', undefined, DEFAULT_CONTEXT_PARAMETER_DESCRIPTION],
    ['custom', 'Explain your reasoning for this action', 'Explain your reasoning for this action'],
  ])(
    'injects the context parameter on every tool in tools/list (%s description)',
    async (_, customDescription, expectedDescription) => {
      const contextOption = customDescription ? { description: customDescription } : true
      instrument(server, { projectToken: 'phc_test', context: contextOption })

      const toolsResponse = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      const userTools = toolsResponse.tools.filter((t: any) =>
        ['add_todo', 'list_todos', 'complete_todo'].includes(t.name)
      )

      expect(userTools).toHaveLength(3)
      for (const tool of userTools) {
        expect(tool.inputSchema.properties.context).toBeDefined()
        expect(tool.inputSchema.properties.context.type).toBe('string')
        expect(tool.inputSchema.properties.context.description).toBe(expectedDescription)
      }
    }
  )

  it('captures the supplied `context` argument as `userIntent` with source=context_parameter', async () => {
    const capture = new EventCapture()
    await capture.start()
    instrument(server, { projectToken: 'phc_test', context: true })

    const contextString = 'Testing context parameter injection for analytics'
    await client.request(
      {
        method: 'tools/call',
        params: { name: 'add_todo', arguments: { text: 'Test todo item', context: contextString } },
      },
      CallToolResultSchema
    )

    await new Promise((r) => setTimeout(r, 50))

    const event = capture
      .getEvents()
      .find((e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall && e.resourceName === 'add_todo')

    expect(event?.userIntent).toBe(contextString)
    expect(event?.userIntentSource).toBe('context_parameter')

    await capture.stop()
  })

  it('leaves `userIntent` unset when no context arg and no fallback configured', async () => {
    const capture = new EventCapture()
    await capture.start()
    instrument(server, { projectToken: 'phc_test', context: true })

    await client.request({ method: 'tools/call', params: { name: 'list_todos', arguments: {} } }, CallToolResultSchema)

    await new Promise((r) => setTimeout(r, 50))

    const event = capture
      .getEvents()
      .find((e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall && e.resourceName === 'list_todos')

    expect(event).toBeDefined()
    expect(event?.userIntent).toBeUndefined()
    expect(event?.userIntentSource).toBeUndefined()

    await capture.stop()
  })

  it('falls back to `intentFallback` when no context arg is supplied', async () => {
    const capture = new EventCapture()
    await capture.start()
    instrument(server, {
      projectToken: 'phc_test',
      context: true,
      intentFallback: (request) => (request.params?.name === 'list_todos' ? 'Inspecting the todo list' : undefined),
    })

    await client.request({ method: 'tools/call', params: { name: 'list_todos', arguments: {} } }, CallToolResultSchema)

    await new Promise((r) => setTimeout(r, 50))

    const event = capture
      .getEvents()
      .find((e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall && e.resourceName === 'list_todos')

    expect(event?.userIntent).toBe('Inspecting the todo list')
    expect(event?.userIntentSource).toBe('inferred')

    await capture.stop()
  })

  it('prefers an explicit `context` argument over the fallback', async () => {
    const capture = new EventCapture()
    await capture.start()
    const intentFallback = jest.fn(() => 'Fallback intent')
    instrument(server, { projectToken: 'phc_test', context: true, intentFallback })

    await client.request(
      {
        method: 'tools/call',
        params: { name: 'list_todos', arguments: { context: 'Listing todos to inspect current work' } },
      },
      CallToolResultSchema
    )

    await new Promise((r) => setTimeout(r, 50))

    const event = capture
      .getEvents()
      .find((e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall && e.resourceName === 'list_todos')

    expect(event?.userIntent).toBe('Listing todos to inspect current work')
    expect(event?.userIntentSource).toBe('context_parameter')
    expect(intentFallback).not.toHaveBeenCalled()

    await capture.stop()
  })

  it('strips `context` from tool args before invoking the user callback', async () => {
    let receivedArgs: any = null

    const { z } = await import('zod')
    server.tool('echo_args', 'Captures the args the callback sees', { testParam: z.string() }, async (args: any) => {
      receivedArgs = { ...args }
      return { content: [{ type: 'text', text: 'ok' }] }
    })

    instrument(server, { projectToken: 'phc_test', enableTracing: true })

    await client.request(
      {
        method: 'tools/call',
        params: {
          name: 'echo_args',
          arguments: { testParam: 'test-value', context: 'should not reach the callback' },
        },
      },
      CallToolResultSchema
    )

    await new Promise((r) => setTimeout(r, 50))

    expect(receivedArgs).toEqual({ testParam: 'test-value' })
    expect(receivedArgs).not.toHaveProperty('context')
  })
})
