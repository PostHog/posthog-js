import { ErrorCoercer } from './coercers'
import { ErrorPropertiesBuilder, sanitizeAdditionalExceptionProperties } from './error-properties-builder'
import { chromeStackLineParser, createStackParser } from './parsers'

const builder = new ErrorPropertiesBuilder(
  [new ErrorCoercer()],
  createStackParser('web:javascript', chromeStackLineParser)
)

describe('exception event metadata', () => {
  it('adds canonical manual capture metadata and deterministic linkage', () => {
    const cause = new Error('inner')
    const error = new Error('outer', { cause })

    expect(builder.buildFromUnknown(error)).toMatchObject({
      $exception_level: 'error',
      $exception_list: [
        {
          type: 'Error',
          value: 'outer',
          mechanism: { type: 'generic', handled: true, synthetic: false, exception_id: 0 },
        },
        {
          type: 'Error',
          value: 'inner',
          mechanism: { type: 'chained', source: 'cause', synthetic: false, exception_id: 1, parent_id: 0 },
        },
      ],
    })

    expect(builder.buildFromUnknown(error).$exception_list[1].mechanism).not.toHaveProperty('handled')
  })

  it('normalizes trusted capture metadata', () => {
    const properties = builder.buildFromUnknown(new Error('boom'), {
      level: 'warn',
      source: 'browser.console',
      mechanism: { type: 'onconsole', handled: true },
    })

    expect(properties.$exception_level).toBe('warning')
    expect(properties.$exception_source).toBe('browser.console')
  })

  it('ignores malformed typed fields without discarding valid siblings', () => {
    const properties = builder.buildFromUnknown(new Error('boom'), {
      level: 'unknown',
      source: '',
      mechanism: {
        type: '',
        handled: 'yes',
        platform_extension: { safe: true },
      },
    } as any)

    expect(properties.$exception_level).toBe('error')
    expect(properties).not.toHaveProperty('$exception_source')
    expect(properties.$exception_list[0].mechanism).toEqual({
      type: 'generic',
      handled: true,
      synthetic: false,
      exception_id: 0,
      platform_extension: { safe: true },
    })
  })

  it('keeps generic properties from overriding SDK and processor metadata', () => {
    expect(
      sanitizeAdditionalExceptionProperties({
        area: 'checkout',
        $exception_level: 'fatal',
        $exception_source: 'fake.integration',
        $exception_list: [],
        $exception_sources: ['fake.ts'],
        $exception_fingerprint: 'user-fingerprint',
      })
    ).toEqual({
      area: 'checkout',
      $exception_fingerprint: 'user-fingerprint',
    })
  })
})
