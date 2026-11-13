import { DEFAULT_CONTEXT_PARAMETER_DESCRIPTION } from '../extensions/constants'
import { addContextParameterToTool, type ContextInjectableTool } from '../extensions/context-parameters'
import type { RegisteredTool } from '../types'

type InjectableRegisteredTool = RegisteredTool & ContextInjectableTool

/** A tool that is known to carry a `context` parameter after injection. */
interface ToolWithContext {
  inputSchema: { properties: { context: { description: string } } }
}

describe('Context Parameter Preservation', () => {
  it('should preserve existing context parameter with custom description', () => {
    const toolWithCustomContext: InjectableRegisteredTool = {
      description: 'Test tool',
      inputSchema: {
        type: 'object',
        properties: {
          context: {
            type: 'string',
            description: 'A custom context description that should be preserved',
          },
        },
        required: ['context'],
      },
      callback: async () => ({ content: [] }),
    }

    const result = addContextParameterToTool(toolWithCustomContext) as ToolWithContext

    // The custom context description should be preserved
    expect(result.inputSchema.properties.context.description).toBe(
      'A custom context description that should be preserved'
    )

    // It should NOT be replaced with the default description
    expect(result.inputSchema.properties.context.description).not.toBe(DEFAULT_CONTEXT_PARAMETER_DESCRIPTION)
  })

  it("should add context parameter when it doesn't exist", () => {
    const toolWithoutContext: InjectableRegisteredTool = {
      description: 'Test tool',
      inputSchema: {
        type: 'object',
        properties: {
          foo: { type: 'string' },
        },
        required: ['foo'],
      },
      callback: async () => ({ content: [] }),
    }

    const result = addContextParameterToTool(toolWithoutContext) as ToolWithContext

    // Context should be added with default description
    expect(result.inputSchema.properties.context).toBeDefined()
    expect(result.inputSchema.properties.context.description).toBe(DEFAULT_CONTEXT_PARAMETER_DESCRIPTION)
  })
})
