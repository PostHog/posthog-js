import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { instrument } from '../index'
import { fakePostHog } from './test-utils'

// Helper to get the tool function property name for the current MCP SDK version
function getToolFunctionPropertyName(tool: any): 'callback' | 'handler' {
  if ('handler' in tool && typeof tool.handler === 'function') {
    return 'handler'
  }
  if ('callback' in tool && typeof tool.callback === 'function') {
    return 'callback'
  }
  throw new Error('Tool has neither callback nor handler')
}

describe('MCP SDK callback/handler compatibility', () => {
  it('should have either callback or handler property (SDK version dependent)', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' })

    server.tool('test_tool', { a: z.number() }, async ({ a }) => ({
      content: [{ type: 'text', text: String(a) }],
    }))

    const tools = (server as any)._registeredTools
    const tool = tools.test_tool
    const propName = getToolFunctionPropertyName(tool)

    console.log('\n=== MCP SDK Tool Structure ===')
    console.log('Tool properties:', Object.keys(tool))
    console.log("Has 'callback':", 'callback' in tool)
    console.log("Has 'handler':", 'handler' in tool)
    console.log('Tool function property:', propName)

    // Tool should have either 'handler' (1.24+) or 'callback' (1.23-)
    const hasToolFunction =
      ('handler' in tool && typeof tool.handler === 'function') ||
      ('callback' in tool && typeof tool.callback === 'function')
    expect(hasToolFunction).toBe(true)
  })

  it('should preserve the original property name after instrument() is called', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' })

    server.tool('test_tool', { a: z.number() }, async ({ a }) => ({
      content: [{ type: 'text', text: String(a) }],
    }))

    // Get the property name BEFORE instrument()
    const toolsBefore = (server as any)._registeredTools
    const toolBefore = toolsBefore.test_tool
    const originalPropName = getToolFunctionPropertyName(toolBefore)

    // Call instrument() to apply PostHog MCP analytics's tracing
    instrument(server, { posthog: fakePostHog() })

    const toolsAfter = (server as any)._registeredTools
    const toolAfter = toolsAfter.test_tool
    const afterPropName = getToolFunctionPropertyName(toolAfter)

    console.log('\n=== After instrument() ===')
    console.log('Original property name:', originalPropName)
    console.log('Property name after instrument():', afterPropName)
    console.log("Has 'callback':", 'callback' in toolAfter)
    console.log("Has 'handler':", 'handler' in toolAfter)

    // PostHog MCP analytics should preserve the original property name
    expect(afterPropName).toBe(originalPropName)
    expect(typeof toolAfter[afterPropName]).toBe('function')
  })

  it('should preserve property name for tools registered after instrument()', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' })

    // Register a tool first to determine SDK's property name
    server.tool('initial_tool', { a: z.number() }, async ({ a }) => ({
      content: [{ type: 'text', text: String(a) }],
    }))
    const expectedPropName = getToolFunctionPropertyName((server as any)._registeredTools.initial_tool)

    // Call instrument() first
    instrument(server, { posthog: fakePostHog() })

    // Then register a tool after instrument()
    server.tool('late_tool', { b: z.string() }, async ({ b }) => ({
      content: [{ type: 'text', text: b }],
    }))

    const tools = (server as any)._registeredTools
    const tool = tools.late_tool
    const propName = getToolFunctionPropertyName(tool)

    console.log('\n=== Tool registered after instrument() ===')
    console.log('Expected property name:', expectedPropName)
    console.log('Actual property name:', propName)
    console.log("Has 'callback':", 'callback' in tool)
    console.log("Has 'handler':", 'handler' in tool)

    // Tools registered after instrument() should also preserve the SDK's property name
    expect(propName).toBe(expectedPropName)
    expect(typeof tool[propName]).toBe('function')
  })
})
