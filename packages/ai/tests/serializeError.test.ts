import { serializeError, stringifyError } from '../src/serializeError'

interface SerializedShape {
  name: string
  message: string
  stack?: string
  cause?: unknown
  [key: string]: unknown
}

describe('serializeError', () => {
  it('preserves name, message, and stack on a plain Error', () => {
    const result = serializeError(new Error('boom')) as SerializedShape
    expect(result.name).toBe('Error')
    expect(result.message).toBe('boom')
    expect(result.stack).toContain('boom')
  })

  it('preserves custom own-enumerable properties (statusCode, response, …)', () => {
    const error = Object.assign(new Error('rate limited'), { statusCode: 429, response: { id: 'req_123' } })
    const result = serializeError(error) as SerializedShape
    expect(result.statusCode).toBe(429)
    expect(result.response).toEqual({ id: 'req_123' })
  })

  it('walks the cause chain', () => {
    const root = new Error('root')
    const middle = new Error('middle', { cause: root })
    const top = new Error('top', { cause: middle })

    const result = serializeError(top) as SerializedShape
    expect((result.cause as SerializedShape).message).toBe('middle')
    expect(((result.cause as SerializedShape).cause as SerializedShape).message).toBe('root')
  })

  it('returns plain-object containers as-is (does not expand Errors nested inside non-Error containers)', () => {
    const nested = new Error('inner')
    const result = serializeError({ retries: 3, err: nested }) as { retries: number; err: Error }
    expect(result).toEqual({ retries: 3, err: nested })
    expect(result.err).toBe(nested)
  })

  it('truncates stacks longer than 20 lines', () => {
    const error = new Error('long stack')
    error.stack = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n')

    const result = serializeError(error) as { stack: string }
    const lines = result.stack.split('\n')

    expect(lines).toHaveLength(21)
    expect(lines.slice(0, 20)).toEqual(Array.from({ length: 20 }, (_, i) => `line ${i}`))
    expect(lines[20]).toBe('... (truncated)')
  })

  it('leaves stacks of 20 or fewer lines untouched', () => {
    const error = new Error('short stack')
    error.stack = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')

    const result = serializeError(error) as { stack: string }
    expect(result.stack).toBe(error.stack)
  })

  it('expands a custom error class wrapping a chain of nested error causes', () => {
    class ZodError extends Error {
      constructor() {
        super('expected object, received undefined')
        this.name = 'ZodError'
      }
    }
    class TypeValidationError extends Error {
      constructor(cause: unknown) {
        super('type validation failed', { cause })
        this.name = 'AI_TypeValidationError'
      }
    }
    const gateway = Object.assign(new Error('gateway responded', { cause: new TypeValidationError(new ZodError()) }), {
      name: 'GatewayResponseError',
      statusCode: 500,
    })

    const result = serializeError(gateway) as SerializedShape
    const validation = result.cause as SerializedShape
    const zod = validation.cause as SerializedShape

    expect(result.name).toBe('GatewayResponseError')
    expect(result.message).toBe('gateway responded')
    expect(result.statusCode).toBe(500)
    expect(validation.message).toBe('type validation failed')
    expect(zod.name).toBe('ZodError')
    expect(zod.message).toBe('expected object, received undefined')
  })
})

describe('stringifyError', () => {
  it('round-trips a normal error', () => {
    const result = JSON.parse(stringifyError(new Error('boom')))
    expect(result.name).toBe('Error')
    expect(result.message).toBe('boom')
  })

  it('sanitises lone UTF-16 surrogates in messages', () => {
    const result = JSON.parse(stringifyError(new Error('bad \uD800 surrogate')))
    expect(result.message).not.toContain('\uD800')
  })

  it('falls back to name and message when the value contains a circular reference', () => {
    const error: Error & { ref?: unknown } = new Error('cycle')
    const container: Record<string, unknown> = { error }
    container.self = container
    error.ref = container

    const result = JSON.parse(stringifyError(error))
    expect(result).toEqual({ name: 'Error', message: 'cycle' })
  })

  it('falls back to name and message when the value contains a BigInt', () => {
    const error = Object.assign(new Error('big'), { code: 1n })
    const result = JSON.parse(stringifyError(error))
    expect(result).toEqual({ name: 'Error', message: 'big' })
  })

  it('falls back to a string message when the original is not an Error', () => {
    const value: Record<string, unknown> = { description: 'cyclic value' }
    value.self = value
    const result = JSON.parse(stringifyError(value))
    expect(result).toEqual({ message: String(value) })
  })
})
