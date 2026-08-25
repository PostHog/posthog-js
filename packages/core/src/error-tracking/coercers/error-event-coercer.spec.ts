import { ErrorPropertiesBuilder } from '../error-properties-builder'
import { createDefaultStackParser } from '../parsers'
import { Exception } from '../types'
import { ErrorCoercer } from './error-coercer'
import { ErrorEventCoercer } from './error-event-coercer'
import { EventCoercer } from './event-coercer'
import { ObjectCoercer } from './object-coercer'
import { PrimitiveCoercer } from './primitive-coercer'
import { StringCoercer } from './string-coercer'

// `ErrorEvent` is not available in the Node test environment, so use its runtime brand.
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
  const errorPropertiesBuilder = new ErrorPropertiesBuilder(
    [coercer, new ErrorCoercer(), new EventCoercer(), new ObjectCoercer(), new StringCoercer(), new PrimitiveCoercer()],
    createDefaultStackParser()
  )

  function buildException(input: unknown, syntheticException?: Error): Exception {
    return errorPropertiesBuilder.buildFromUnknown(input, { syntheticException }).$exception_list[0]
  }

  it.each([
    {
      name: 'an ErrorEvent carrying an Error',
      input: new FakeErrorEvent({ error: new Error('boom') }),
      expected: true,
    },
    {
      name: 'an ErrorEvent carrying a message',
      input: new FakeErrorEvent({ message: 'Script error.' }),
      expected: true,
    },
    { name: 'an ErrorEvent without an error or message', input: new FakeErrorEvent(), expected: false },
    { name: 'an ErrorEvent with an empty message', input: new FakeErrorEvent({ message: '' }), expected: false },
    { name: 'a non-ErrorEvent', input: { message: 'not an ErrorEvent' }, expected: false },
  ])('matches $name: $expected', ({ input, expected }) => {
    expect(coercer.match(input)).toBe(expected)
  })

  it('unwraps the Error carried by the ErrorEvent', () => {
    const error = new Error('Something broke')
    error.name = 'CustomTestError'

    expect(buildException(new FakeErrorEvent({ message: 'ignored', error }))).toMatchObject({
      type: 'CustomTestError',
      value: 'Something broke',
      mechanism: { synthetic: false },
    })
  })

  it('preserves the message and location when there is no Error object', () => {
    const exception = buildException(
      new FakeErrorEvent({
        message: 'Uncaught TypeError: x is not a function',
        filename: 'https://example.com/app.js',
        lineno: 42,
        colno: 13,
      })
    )

    expect(exception).toMatchObject({
      type: 'TypeError',
      value: 'x is not a function',
      mechanism: { synthetic: true },
      stacktrace: {
        frames: [
          expect.objectContaining({
            filename: 'https://example.com/app.js',
            lineno: 42,
            colno: 13,
          }),
        ],
      },
    })
  })

  it.each([
    { name: 'a zeroed position', lineno: 0, colno: 0 },
    { name: 'no position at all', lineno: undefined, colno: undefined },
    { name: 'a column but no line', lineno: 0, colno: 13 },
  ])('reports no stack trace for $name', ({ lineno, colno }) => {
    const exception = buildException(
      new FakeErrorEvent({
        message: 'ResizeObserver loop completed with undelivered notifications.',
        filename: 'https://example.com/dashboard/1',
        lineno,
        colno,
      })
    )

    expect(exception.stacktrace).toBeUndefined()
    expect(exception).toMatchObject({ value: 'ResizeObserver loop completed with undelivered notifications.' })
  })

  it('keeps a frame when only the column is zero', () => {
    const exception = buildException(
      new FakeErrorEvent({
        message: 'Uncaught TypeError: x is not a function',
        filename: 'https://example.com/app.js',
        lineno: 42,
        colno: 0,
      })
    )

    expect(exception.stacktrace?.frames).toEqual([
      expect.objectContaining({ filename: 'https://example.com/app.js', lineno: 42, colno: 0 }),
    ])
  })

  it('does not parse frame-shaped lines from a multiline message', () => {
    const exception = buildException(
      new FakeErrorEvent({
        message: 'Something broke\n    at injected (https://example.com/injected.js:1:2)',
        filename: 'https://example.com/app.js',
        lineno: 42,
        colno: 13,
      })
    )

    expect(exception.stacktrace?.frames).toEqual([
      expect.objectContaining({
        filename: 'https://example.com/app.js',
        lineno: 42,
        colno: 13,
      }),
    ])
  })
})
