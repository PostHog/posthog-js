import { CoercingContext } from '../types'
import { ErrorEventCoercer } from './error-event-coercer'

// `ErrorEvent` is a web-only global and isn't defined in the Node test env, so
// fake it structurally. `isErrorEvent` matches on the object's toStringTag.
class FakeErrorEvent {
  message?: string
  error?: unknown
  filename?: string
  lineno?: number
  colno?: number;
  [Symbol.toStringTag] = 'ErrorEvent'

  constructor(init: Partial<Omit<FakeErrorEvent, typeof Symbol.toStringTag>> = {}) {
    Object.assign(this, init)
  }
}

describe('ErrorEventCoercer', () => {
  const coercer = new ErrorEventCoercer()

  const buildCtx = (syntheticException?: Error): CoercingContext =>
    ({
      apply: jest.fn((err: any) => ({
        type: err.name,
        value: err.message,
        stack: err.stack,
        synthetic: false,
      })),
      next: jest.fn(),
      syntheticException,
    }) as unknown as CoercingContext

  describe('match', () => {
    it('matches an ErrorEvent carrying an Error', () => {
      expect(coercer.match(new FakeErrorEvent({ error: new Error('boom') }))).toBe(true)
    })

    it('matches an ErrorEvent with a usable message but no Error', () => {
      expect(coercer.match(new FakeErrorEvent({ message: 'Script error.' }))).toBe(true)
    })

    it('does not match a bare ErrorEvent with no message and no Error', () => {
      expect(coercer.match(new FakeErrorEvent())).toBe(false)
      expect(coercer.match(new FakeErrorEvent({ message: '' }))).toBe(false)
    })

    it('does not match non-ErrorEvents', () => {
      expect(coercer.match(new Error('nope'))).toBe(false)
      expect(coercer.match({ message: 'still nope' })).toBe(false)
    })
  })

  describe('coerce', () => {
    it('unwraps the Error carried by the ErrorEvent', () => {
      const buriedError = new Error('Something broke')
      buriedError.name = 'CustomTestError'
      const event = new FakeErrorEvent({ message: 'ignored when error is present', error: buriedError })

      expect(coercer.coerce(event as any, buildCtx())).toMatchObject({
        type: 'CustomTestError',
        value: 'Something broke',
        stack: buriedError.stack,
        synthetic: false,
      })
    })

    it('salvages a message + location into an exception with a synthetic frame', () => {
      const event = new FakeErrorEvent({
        message: 'Uncaught TypeError: x is not a function',
        filename: 'https://example.com/app.js',
        lineno: 42,
        colno: 13,
      })

      expect(coercer.coerce(event as any, buildCtx())).toEqual({
        type: 'Error',
        value: 'Uncaught TypeError: x is not a function',
        stack: 'Error: Uncaught TypeError: x is not a function\n    at https://example.com/app.js:42:13',
        synthetic: true,
      })
    })

    it('defaults missing lineno/colno to 0 in the synthetic frame', () => {
      const event = new FakeErrorEvent({ message: 'oops', filename: 'https://example.com/app.js' })

      expect(coercer.coerce(event as any, buildCtx())).toMatchObject({
        stack: 'Error: oops\n    at https://example.com/app.js:0:0',
      })
    })

    it('falls back to the synthetic exception stack when there is no location', () => {
      const syntheticException = new Error()
      const event = new FakeErrorEvent({ message: 'Script error.' })

      expect(coercer.coerce(event as any, buildCtx(syntheticException))).toEqual({
        type: 'Error',
        value: 'Script error.',
        stack: syntheticException.stack,
        synthetic: true,
      })
    })

    it('salvages the message when the carried error cannot be coerced', () => {
      const ctx = buildCtx()
      ;(ctx.apply as jest.Mock).mockReturnValueOnce(undefined)
      const event = new FakeErrorEvent({ message: 'Script error.', error: {} })

      expect(coercer.coerce(event as any, ctx)).toMatchObject({
        type: 'Error',
        value: 'Script error.',
        synthetic: true,
      })
    })
  })
})
