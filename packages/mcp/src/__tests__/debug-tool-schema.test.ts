import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { track } from '../index'

describe('Debug Tool Schema Structure', () => {
  let server: McpServer

  beforeEach(() => {
    server = new McpServer({
      name: 'debug server',
      version: '1.0.0',
    })
  })

  it('should show the structure of tools registered with shorthand Zod syntax', async () => {
    // Register tools with shorthand Zod syntax BEFORE track()
    server.tool('add', { a: z.number(), b: z.number() }, async ({ a, b }) => ({
      content: [{ type: 'text', text: String(a + b) }],
    }))

    // Log the registered tool structure BEFORE track()
    console.log('\n=== BEFORE track() ===')
    const toolsBefore = server._registeredTools
    console.log('Tools registered:', Object.keys(toolsBefore))

    if (toolsBefore.add) {
      console.log("Tool 'add' structure:")
      console.log('  - Has inputSchema?', !!toolsBefore.add.inputSchema)
      console.log('  - inputSchema type:', typeof toolsBefore.add.inputSchema)
      console.log('  - inputSchema value:', JSON.stringify(toolsBefore.add.inputSchema, null, 2))

      if (toolsBefore.add.inputSchema) {
        console.log('  - Has properties?', !!toolsBefore.add.inputSchema.properties)
        console.log('  - Properties type:', typeof toolsBefore.add.inputSchema.properties)
      }
    }

    // Now call track()
    await track(server, {
      apiKey: 'test-project',
      context: true,
      enableTracing: true,
    })

    // Log the registered tool structure AFTER track()
    console.log('\n=== AFTER track() ===')
    const toolsAfter = server._registeredTools
    console.log('Tools registered:', Object.keys(toolsAfter))

    if (toolsAfter.add) {
      console.log("Tool 'add' structure:")
      console.log('  - Has inputSchema?', !!toolsAfter.add.inputSchema)
      console.log('  - inputSchema type:', typeof toolsAfter.add.inputSchema)
      console.log('  - inputSchema value:', JSON.stringify(toolsAfter.add.inputSchema, null, 2))

      if (toolsAfter.add.inputSchema) {
        console.log('  - Has properties?', !!toolsAfter.add.inputSchema.properties)
        console.log(
          '  - Has context in properties?',
          toolsAfter.add.inputSchema.properties && !!toolsAfter.add.inputSchema.properties.context
        )
      }
    }

    // Basic assertion to make the test pass
    expect(server).toBeDefined()
  })

  it('should show the structure of tools registered with description and schema', async () => {
    // Register tools with full syntax (description + schema)
    server.tool('add_with_desc', 'Adds two numbers', { a: z.number(), b: z.number() }, async ({ a, b }) => ({
      content: [{ type: 'text', text: String(a + b) }],
    }))

    // Log the registered tool structure
    console.log('\n=== Tool with description ===')
    const tools = server._registeredTools

    if (tools.add_with_desc) {
      console.log("Tool 'add_with_desc' structure:")
      console.log('  - Has description?', !!tools.add_with_desc.description)
      console.log('  - Description:', tools.add_with_desc.description)
      console.log('  - Has inputSchema?', !!tools.add_with_desc.inputSchema)
      console.log('  - inputSchema type:', typeof tools.add_with_desc.inputSchema)
      console.log('  - inputSchema value:', JSON.stringify(tools.add_with_desc.inputSchema, null, 2))
    }

    expect(server).toBeDefined()
  })
})
