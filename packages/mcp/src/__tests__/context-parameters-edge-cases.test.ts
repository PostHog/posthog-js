import { addContextParameterToTool, addContextParameterToTools } from '../modules/context-parameters'
import { log } from '../modules/logger'

jest.mock('../modules/logger', () => ({
  log: jest.fn(),
}))

describe('Context Parameters Edge Cases', () => {
  beforeEach(() => {
    jest.mocked(log).mockClear()
    jest.mocked(log).mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('existing context parameter collision', () => {
    it('should skip injection for tools with existing context parameter', () => {
      const tool = {
        name: 'test-tool',
        inputSchema: {
          type: 'object',
          properties: { context: { type: 'number', description: 'existing' } },
        },
      }

      const result = addContextParameterToTool(tool)

      // Should preserve the original context parameter type
      expect(result.inputSchema.properties.context.type).toBe('number')
      expect(result.inputSchema.properties.context.description).toBe('existing')
      expect(log).toHaveBeenCalledWith(expect.stringContaining("already has 'context' parameter"))
    })

    it('should warn with tool name when context exists', () => {
      const tool = {
        name: 'my-special-tool',
        inputSchema: {
          type: 'object',
          properties: { context: { type: 'boolean' } },
        },
      }

      addContextParameterToTool(tool)

      expect(log).toHaveBeenCalledWith(expect.stringContaining('my-special-tool'))
    })
  })

  describe('complex schema handling', () => {
    it('should skip injection for oneOf schemas', () => {
      const tool = {
        name: 'union-tool',
        inputSchema: {
          oneOf: [
            { type: 'object', properties: { email: { type: 'string' } } },
            { type: 'object', properties: { phone: { type: 'string' } } },
          ],
        },
      }

      const result = addContextParameterToTool(tool)

      // Should not add properties to oneOf schema
      expect(result.inputSchema.properties).toBeUndefined()
      expect(log).toHaveBeenCalledWith(expect.stringContaining('complex schema'))
    })

    it('should skip injection for allOf schemas', () => {
      const tool = {
        name: 'intersection-tool',
        inputSchema: {
          allOf: [
            { type: 'object', properties: { a: { type: 'string' } } },
            { type: 'object', properties: { b: { type: 'string' } } },
          ],
        },
      }

      const result = addContextParameterToTool(tool)

      expect(result.inputSchema.properties).toBeUndefined()
      expect(log).toHaveBeenCalledWith(expect.stringContaining('complex schema'))
    })

    it('should skip injection for anyOf schemas', () => {
      const tool = {
        name: 'anyof-tool',
        inputSchema: { anyOf: [{ type: 'string' }, { type: 'number' }] },
      }

      const result = addContextParameterToTool(tool)

      expect(result.inputSchema.properties).toBeUndefined()
      expect(log).toHaveBeenCalledWith(expect.stringContaining('complex schema'))
    })
  })

  describe('additionalProperties constraint', () => {
    it('should inject context and remove additionalProperties:false constraint', () => {
      const tool = {
        name: 'strict-tool',
        inputSchema: {
          type: 'object',
          properties: { name: { type: 'string' } },
          additionalProperties: false,
        },
      }

      const result = addContextParameterToTool(tool)

      // Should add context property and remove additionalProperties constraint
      expect(result.inputSchema.properties.context).toBeDefined()
      expect(result.inputSchema.properties.context.type).toBe('string')
      expect(result.inputSchema.additionalProperties).toBeUndefined()
    })

    it('should preserve additionalProperties:true when injecting', () => {
      const tool = {
        name: 'flexible-tool',
        inputSchema: {
          type: 'object',
          properties: { name: { type: 'string' } },
          additionalProperties: true,
        },
      }

      const result = addContextParameterToTool(tool)

      // Should add context property and keep additionalProperties: true
      expect(result.inputSchema.properties.context).toBeDefined()
      expect(result.inputSchema.properties.context.type).toBe('string')
      expect(result.inputSchema.additionalProperties).toBe(true)
    })
  })

  describe('edge case schemas', () => {
    it('should handle empty object schema {}', () => {
      const tool = { name: 'empty-tool', inputSchema: {} }

      const result = addContextParameterToTool(tool)

      expect(result.inputSchema?.properties?.context).toBeDefined()
      expect(result.inputSchema?.properties?.context?.type).toBe('string')
    })

    it('should handle schema with no inputSchema', () => {
      const tool = { name: 'no-schema-tool' }

      const result = addContextParameterToTool(tool)

      expect(result.inputSchema?.properties?.context).toBeDefined()
      expect(result.inputSchema?.type).toBe('object')
    })

    it('should handle schema with only type specified', () => {
      const tool = {
        name: 'type-only-tool',
        inputSchema: { type: 'object' },
      }

      const result = addContextParameterToTool(tool)

      expect(result.inputSchema?.properties?.context).toBeDefined()
    })
  })

  describe('addContextParameterToTools batch handling', () => {
    it('should skip get_more_tools entirely', () => {
      const tools = [
        { name: 'get_more_tools', inputSchema: {} },
        { name: 'other-tool', inputSchema: {} },
      ]

      const result = addContextParameterToTools(tools)

      // get_more_tools should not have context added
      expect(result[0].inputSchema.properties).toBeUndefined()
      // other-tool should have context added
      expect(result[1].inputSchema.properties?.context).toBeDefined()
    })

    it('should handle mixed valid and complex schemas', () => {
      const tools = [
        { name: 'valid-tool', inputSchema: { type: 'object', properties: {} } },
        { name: 'complex-tool', inputSchema: { oneOf: [{ type: 'string' }] } },
        {
          name: 'collision-tool',
          inputSchema: {
            type: 'object',
            properties: { context: { type: 'number' } },
          },
        },
        {
          name: 'strict-tool',
          inputSchema: {
            type: 'object',
            properties: { name: { type: 'string' } },
            additionalProperties: false,
          },
        },
      ]

      const result = addContextParameterToTools(tools)

      // valid-tool gets context
      expect(result[0].inputSchema.properties.context).toBeDefined()
      // complex-tool skipped
      expect(result[1].inputSchema.properties).toBeUndefined()
      // collision-tool keeps original context type
      expect(result[2].inputSchema.properties.context.type).toBe('number')
      // strict-tool gets context and additionalProperties removed
      expect(result[3].inputSchema.properties.context).toBeDefined()
      expect(result[3].inputSchema.additionalProperties).toBeUndefined()

      // Should have logged warnings for complex and collision tools only
      expect(log).toHaveBeenCalledTimes(2)
    })
  })
})
