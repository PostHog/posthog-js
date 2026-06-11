import { captureException } from '../extensions/exceptions'

/**
 * `captureException` is a thin wrapper over `@posthog/core`'s
 * `ErrorPropertiesBuilder`. These tests cover the MCP-specific integration
 * (the `$exception_list` contract we emit, plus CallToolResult handling) — not
 * core's stack parser internals, which core tests on its own.
 */
describe('captureException', () => {
  describe('error type + message', () => {
    it.each([
      ['Error', new Error('plain'), 'Error', 'plain'],
      ['TypeError', new TypeError('type'), 'TypeError', 'type'],
      ['ReferenceError', new ReferenceError('ref'), 'ReferenceError', 'ref'],
    ])('captures %s into $exception_list', (_, error, expectedType, expectedValue) => {
      const result = captureException(error)
      expect(result.$exception_level).toBe('error')
      expect(result.$exception_list[0]).toMatchObject({ type: expectedType, value: expectedValue })
    })

    it('reads name from a custom Error subclass', () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message)
          this.name = 'CustomError'
        }
      }
      const result = captureException(new CustomError('custom'))
      expect(result.$exception_list[0]).toMatchObject({ type: 'CustomError', value: 'custom' })
    })
  })

  describe('non-Error throwables', () => {
    it.each([
      ['string', 'oops', 'oops'],
      ['number', 42, '42'],
      ['boolean', false, 'false'],
      ['plain object with message', { code: 404, message: 'nf' }, 'nf'],
    ])('coerces %s into an exception value', (_, input, expectedFragment) => {
      const result = captureException(input)
      const [exception] = result.$exception_list
      expect(exception.value).toContain(expectedFragment)
      // Coerced (non-Error) inputs have no real stack.
      expect(exception.mechanism?.synthetic).toBe(true)
    })

    it('does not throw on objects with circular references', () => {
      const obj: any = { name: 'test' }
      obj.self = obj
      const result = captureException(obj)
      expect(typeof result.$exception_list[0].value).toBe('string')
    })
  })

  describe('stack trace parsing', () => {
    it('parses frames from a real thrown Error', () => {
      const result = captureException(new Error('Test'))
      const frames = result.$exception_list[0].stacktrace?.frames
      expect(frames?.length).toBeGreaterThan(0)
      expect(frames?.[0]).toMatchObject({
        function: expect.any(String),
        filename: expect.any(String),
        in_app: expect.any(Boolean),
      })
      expect(frames?.some((f) => f.in_app)).toBe(true)
    })

    it('marks node_modules + node: frames as in_app=false, user code as in_app=true', () => {
      const err = new Error('Test')
      err.stack = `Error: Test
    at userFn (/app/src/test.ts:10:5)
    at libFn (/app/node_modules/some-lib/index.js:42:10)
    at internal (node:internal/process:123:45)`
      const frames = captureException(err).$exception_list[0].stacktrace?.frames
      // Core emits frames most-recent-call-last, so the user frame is last here.
      const inAppByFile = Object.fromEntries((frames ?? []).map((f) => [f.filename, f.in_app]))
      expect(inAppByFile['/app/src/test.ts']).toBe(true)
      expect(inAppByFile['/app/node_modules/some-lib/index.js']).toBe(false)
      expect(inAppByFile['node:internal/process']).toBe(false)
    })
  })

  describe('Error.cause chain', () => {
    it('captures each cause as its own entry in $exception_list', () => {
      const cause = new Error('root')
      const middle = new Error('middle', { cause })
      const top = new Error('top', { cause: middle })
      const result = captureException(top)
      expect(result.$exception_list.map((e) => e.value)).toEqual(['top', 'middle', 'root'])
    })

    it('handles a non-Error cause', () => {
      const result = captureException(new Error('top', { cause: 'string cause' }))
      expect(result.$exception_list.map((e) => e.value)).toContain('top')
      expect(result.$exception_list.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('CallToolResult errors (MCP SDK 1.21.0+)', () => {
    it('extracts the text content as the exception value', () => {
      const result = captureException({
        content: [{ type: 'text', text: 'tool blew up' }],
        isError: true,
      })
      expect(result.$exception_list[0].value).toBe('tool blew up')
    })

    it('joins multiple text parts', () => {
      const result = captureException({
        content: [
          { type: 'text', text: 'part one' },
          { type: 'text', text: 'part two' },
        ],
        isError: true,
      })
      expect(result.$exception_list[0].value).toBe('part one part two')
    })

    it('falls back to "Unknown error" when there is no text content', () => {
      const result = captureException({
        content: [{ type: 'image', data: 'xxx' }],
        isError: true,
      })
      expect(result.$exception_list[0].value).toBe('Unknown error')
    })
  })

  describe('malformed input', () => {
    it('still produces an exception when Error.stack is undefined', () => {
      const e = new Error('no stack')
      e.stack = undefined
      const result = captureException(e)
      expect(result.$exception_list[0].value).toBe('no stack')
    })

    it('does not throw on a whitespace-only stack', () => {
      const e = new Error('Test')
      e.stack = '   \n  '
      expect(() => captureException(e)).not.toThrow()
    })
  })
})
