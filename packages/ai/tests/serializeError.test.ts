import { serializeError, stringifyError, summarizeErrorForPrivacy } from '../src/serializeError'

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

  it.each([
    [
      'on the error itself',
      Object.assign(new Error('bad request'), { requestBodyValues: { prompt: 'secret' }, statusCode: 400 }),
    ],
    [
      'on a nested cause',
      new Error('wrapper', {
        cause: Object.assign(new Error('bad request'), {
          data: { requestBodyValues: { prompt: 'secret' } },
          statusCode: 400,
        }),
      }),
    ],
  ])('omits requestBodyValues %s and keeps the other fields', (_where, error) => {
    const result = stringifyError(error)

    expect(result).not.toContain('requestBodyValues')
    expect(result).not.toContain('secret')
    expect(result).toContain('"statusCode":400')
  })

  it('falls back to a string message when the original is not an Error', () => {
    const value: Record<string, unknown> = { description: 'cyclic value' }
    value.self = value
    const result = JSON.parse(stringifyError(value))
    expect(result).toEqual({ message: String(value) })
  })
})

describe('summarizeErrorForPrivacy', () => {
  class APICallError extends Error {
    constructor(fields: Record<string, unknown>, cause?: unknown) {
      super('request echoed the prompt', { cause })
      this.name = 'AI_APICallError'
      Object.assign(this, fields)
    }
  }

  it.each([
    [
      'the documented example',
      new APICallError(
        {
          statusCode: 400,
          responseBody: JSON.stringify({ error: { type: 'invalid_request_error', param: 'messages[3].content' } }),
        },
        Object.assign(new Error('nested'), { name: 'AI_TypeValidationError' })
      ),
      'AI_APICallError: 400 invalid_request_error param=messages[3].content (caused by AI_TypeValidationError)',
    ],
    [
      'distinct codes, a request id and the constructor name of an SDK subclass',
      Object.assign(new (class BadRequestError extends Error {})('x'), {
        status: 429,
        code: 'rate_limit_exceeded',
        type: 'requests',
        error: { code: 'rate_limit_exceeded' },
        requestID: 'req_123',
      }),
      'BadRequestError: 429 rate_limit_exceeded requests request_id=req_123',
    ],
    [
      'a provider status nested in a body envelope',
      Object.assign(new Error('x'), { status: 400, error: { type: 'error', error: { status: 'INVALID_ARGUMENT' } } }),
      'Error: 400 INVALID_ARGUMENT',
    ],
    [
      'at most three causes',
      new Error('a', {
        cause: new TypeError('b', { cause: new RangeError('c', { cause: new Error('d', { cause: 'e' }) }) }),
      }),
      'Error (caused by TypeError, RangeError, Error)',
    ],
    ['a thrown non-Error value', { message: 'secret', status: 500 }, 'NonErrorThrown: 500'],
    ['a thrown string', 'secret', 'NonErrorThrown'],
  ])('formats %s', (_case, error, expected) => {
    expect(summarizeErrorForPrivacy(error)).toBe(expected)
  })

  it.each([
    ['a name with spaces', { name: 'Leaked secret text' }],
    ['a name with markup', { name: '<img src=x>' }],
    ['an out-of-range status', { status: 42 }],
    ['a non-integer status', { status: 400.5 }],
    ['a code with spaces', { code: 'secret prompt text' }],
    ['an oversized code', { code: 'a'.repeat(65) }],
    ['a param with spaces', { param: 'messages secret' }],
    ['a request id with a slash', { requestID: 'req/secret' }],
    ['an unparseable response body', { responseBody: 'secret {' }],
  ])('drops %s', (_case, fields) => {
    const error = Object.assign(new Error('secret'), fields)

    expect(summarizeErrorForPrivacy(error)).toBe('Error')
  })

  it('never throws on hostile getters', () => {
    const error = new Error('secret')
    Object.defineProperty(error, 'status', {
      get() {
        throw new Error('secret')
      },
    })

    expect(summarizeErrorForPrivacy(error)).toBe('Error')
  })
})
