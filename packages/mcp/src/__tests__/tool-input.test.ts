import { z } from 'zod'
import { z as z4 } from 'zod4'
import { getToolInputProperties } from '../index'

describe('getToolInputProperties', () => {
  it.each([
    {
      type: 'object',
      properties: { id: { type: 'string' }, context: { type: 'string' }, properties: { type: 'string' } },
    },
    { id: z.string(), context: z.string(), properties: z.string() },
    z.object({ id: z.string(), context: z.string(), properties: z.string() }),
    z4.object({ id: z4.string(), context: z4.string(), properties: z4.string() }),
    z
      .object({ id: z.string(), context: z.string(), properties: z.string() })
      .refine(() => true)
      .transform((value) => value),
    z.preprocess((value) => value, z.object({ id: z.string(), context: z.string(), properties: z.string() })),
    z.object({ id: z.string(), context: z.string(), properties: z.string() }).pipe(z.any()),
    z.object({ id: z.string(), context: z.string(), properties: z.string() }).optional(),
    z4.object({ id: z4.string(), context: z4.string(), properties: z4.string() }).transform((value) => value),
    z4
      .object({ id: z4.string(), context: z4.string(), properties: z4.string() })
      .pipe(z4.any())
      .default({ id: '', context: '', properties: '' }),
  ])('keeps declared names and masks unknown names with schema %j', (schema) => {
    const input = {
      id: 'private-value',
      context: 'application-value',
      properties: 'application-properties',
      llm_model: 'example-model',
      conversation_id: 'example-conversation',
      private_identifier_123: true,
      'person@example.com': true,
    }
    expect(getToolInputProperties(input, schema)).toEqual({
      $mcp_input_keys: ['context', 'id', 'properties', '[redacted]'],
    })
    expect(input.id).toBe('private-value')
  })

  it.each([undefined, null, 'invalid', ['id'], new Date()])('omits names for non-object arguments %j', (input) => {
    expect(getToolInputProperties(input, { properties: { id: {} } })).toEqual({})
  })

  it('masks names when no schema is available and does not read values', () => {
    const input = Object.defineProperty({}, 'id', {
      enumerable: true,
      get() {
        throw new Error('must not read values')
      },
    })
    expect(getToolInputProperties(input)).toEqual({ $mcp_input_keys: ['[redacted]'] })
    expect(getToolInputProperties(input, { properties: { id: {} } })).toEqual({ $mcp_input_keys: ['id'] })
  })

  it('bounds the names and drops malformed analytics without throwing', () => {
    const properties = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`key${index}`, {}]))
    expect(getToolInputProperties(properties, { properties }).$mcp_input_keys).toHaveLength(20)
    const longName = 'x'.repeat(65)
    expect(getToolInputProperties({ [longName]: 1 }, { properties: { [longName]: {} } })).toEqual({
      $mcp_input_keys: ['[redacted]'],
    })
    const input = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error('unavailable')
        },
      }
    )
    expect(getToolInputProperties(input, { properties })).toEqual({})
  })
})
