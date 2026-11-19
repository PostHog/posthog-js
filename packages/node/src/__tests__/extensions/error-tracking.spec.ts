import { ErrorTracking as CoreErrorTracking } from '@posthog/core'
import ErrorTracking from '@/extensions/error-tracking'
import { PostHog, PostHogOptions } from '@/entrypoints/index.node'
import { routeByUrl } from '../utils/v1-wiring'

const builder = new CoreErrorTracking.ErrorPropertiesBuilder(
  [new CoreErrorTracking.ErrorCoercer()],
  CoreErrorTracking.createStackParser('node:javascript', CoreErrorTracking.nodeStackLineParser),
  []
)

describe('public exception custom-property delivery', () => {
  let client: PostHog
  let requests: Record<string, any>[]

  const makeClient = (options: PostHogOptions = {}) =>
    new PostHog('test-token', {
      host: 'http://example.test',
      flushInterval: 0,
      disableCompression: true,
      fetchRetryCount: 0,
      fetch: async (url, options) => {
        requests.push(JSON.parse(options.body as string))
        return routeByUrl(url)
      },
      ...options,
    })

  beforeEach(() => {
    requests = []
    client = makeClient()
  })

  afterEach(async () => {
    await client.shutdown()
  })

  const deliveries = ['immediate', 'batched'] as const

  it.each(
    deliveries.flatMap((delivery) => (['delete', 'replace'] as const).map((redaction) => ({ delivery, redaction })))
  )('honors beforeSend $redaction redaction in $delivery delivery', async ({ delivery, redaction }) => {
    await client.shutdown()
    client = makeClient({
      beforeSend: (event) => {
        if (event?.properties) {
          if (redaction === 'delete') {
            delete event.properties.data.secret
          } else {
            event.properties.data.secret = '[REDACTED]'
          }
        }
        return event
      },
    })
    const secret = ['private', 'before', 'send', 'value'].join('-')
    const data = {
      secret,
      toJSON() {
        return { secret: this.secret, drop: null }
      },
    }

    if (delivery === 'immediate') {
      await client.captureExceptionImmediate(new Error('boom'), 'user', { data })
    } else {
      client.captureException(new Error('boom'), 'user', { data })
      await client.flush()
    }

    expect(requests).toHaveLength(1)
    expect(requests[0].batch[0].properties.data).toEqual(redaction === 'delete' ? {} : { secret: '[REDACTED]' })
    expect(JSON.stringify(requests)).not.toContain(secret)
  })

  it.each(
    deliveries.flatMap((delivery) =>
      (['object', 'primitive'] as const).map((representation) => ({ delivery, representation }))
    )
  )(
    'redacts backing fields for a $representation serializer in $delivery delivery',
    async ({ delivery, representation }) => {
      await client.shutdown()
      client = makeClient({
        beforeSend: (event) => {
          if (event?.properties) delete event.properties.data.secret
          return event
        },
      })
      const secret = ['private', 'serializer', 'backing', 'value'].join('-')
      const data = {
        secret,
        toJSON() {
          return representation === 'object' ? { token: this.secret } : this.secret
        },
      }

      if (delivery === 'immediate') {
        await client.captureExceptionImmediate(new Error('boom'), 'user', { data })
      } else {
        client.captureException(new Error('boom'), 'user', { data })
        await client.flush()
      }

      expect(requests).toHaveLength(1)
      expect(requests[0].batch[0].properties.data).toEqual(representation === 'object' ? {} : undefined)
      expect(JSON.stringify(requests)).not.toContain(secret)
    }
  )

  it.each(deliveries)('snapshots array length in %s delivery', async (delivery) => {
    await client.shutdown()
    client = makeClient()
    const makeArray = () => {
      const data = ['initial']
      Object.defineProperty(data, '0', {
        get() {
          data.push('ignored')
          return 'valid'
        },
      })
      return data
    }
    expect(JSON.stringify(makeArray())).toBe('["valid"]')

    if (delivery === 'immediate') {
      await client.captureExceptionImmediate(new Error('boom'), 'user', { data: makeArray() })
    } else {
      client.captureException(new Error('boom'), 'user', { data: makeArray() })
      await client.flush()
    }

    expect(requests).toHaveLength(1)
    expect(requests[0].batch[0].properties.data).toEqual(['valid'])
  })

  it.each(deliveries)('accepts a frozen beforeSend result in %s delivery', async (delivery) => {
    await client.shutdown()
    client = makeClient({ beforeSend: (event) => event && Object.freeze(event) })
    const data = Object.freeze({ keep: true, drop: null })

    if (delivery === 'immediate') {
      await client.captureExceptionImmediate(new Error('boom'), 'user', { data })
    } else {
      client.captureException(new Error('boom'), 'user', { data })
      await client.flush()
    }

    expect(requests).toHaveLength(1)
    expect(requests[0].batch[0].properties.data).toEqual({ keep: true })
    expect(data).toEqual({ keep: true, drop: null })
  })

  it.each(deliveries)('ignores non-index array getters in %s delivery', async (delivery) => {
    await client.shutdown()
    client = makeClient()
    const ignoredGetter = vi.fn(() => {
      throw new Error('non-index array getter evaluated')
    })
    const data = ['valid']
    Object.defineProperty(data, 'metadata', { enumerable: true, get: ignoredGetter })
    expect(JSON.stringify(data)).toBe('["valid"]')

    if (delivery === 'immediate') {
      await client.captureExceptionImmediate(new Error('boom'), 'user', { data })
    } else {
      client.captureException(new Error('boom'), 'user', { data })
      await client.flush()
    }

    expect(requests).toHaveLength(1)
    expect(requests[0].batch[0].properties.data).toEqual(['valid'])
    expect(ignoredGetter).not.toHaveBeenCalled()
  })

  it('preserves non-enumerable array elements that JSON serialization includes', async () => {
    const data = new Array(2)
    Object.defineProperty(data, '0', { value: { keep: true, drop: null } })
    data[1] = null
    expect(JSON.stringify(data)).toBe('[{"keep":true,"drop":null},null]')

    await client.captureExceptionImmediate(new Error('boom'), 'user', { data })

    expect(requests).toHaveLength(1)
    expect(requests[0].batch[0].properties.data).toEqual([{ keep: true }, null])
  })

  it('drops null custom object properties on delivery without changing arrays, native values or caller input', async () => {
    const properties = {
      test: null,
      nested: { drop: null, enabled: false, attempt: 0, text: '' },
      items: ['1', null, { drop: null }],
      date: new Date('2025-01-01T00:00:00Z'),
    }
    const original = structuredClone(properties)
    await client.captureExceptionImmediate(new TypeError('boom'), 'user', properties)

    expect(requests).toHaveLength(1)
    const delivered = requests[0].batch[0].properties
    expect(delivered).not.toHaveProperty('test')
    expect(delivered).toMatchObject({
      nested: { enabled: false, attempt: 0, text: '' },
      items: ['1', null, {}],
      date: '2025-01-01T00:00:00.000Z',
    })
    expect(delivered.nested).not.toHaveProperty('drop')
    expect(delivered.$exception_list[0]).toMatchObject({ type: 'TypeError', value: 'boom' })
    expect(properties).toEqual(original)
  })

  it('delivers sparse arrays and circular references without mutating them', async () => {
    const items = new Array(3)
    items[1] = null
    const properties: Record<string, any> = { items, drop: null }
    properties.self = properties
    await client.captureExceptionImmediate(new Error('boom'), 'user', properties)

    expect(requests).toHaveLength(1)
    const delivered = requests[0].batch[0].properties
    expect(delivered.items).toEqual([null, null, null])
    expect(delivered.self.self).toBe('[Circular]')
    expect(delivered).not.toHaveProperty('drop')
    expect(delivered.self).not.toHaveProperty('drop')
    expect(properties.drop).toBeNull()
    expect(properties.self).toBe(properties)
    expect(items).toHaveLength(3)
    expect(0 in items).toBe(false)
    expect(items[1]).toBeNull()
    expect(2 in items).toBe(false)
  })

  it('preserves explicit severity while cleaning custom properties', async () => {
    await client.captureExceptionImmediate(new Error('boom'), {
      distinctId: 'user',
      level: 'warning',
      properties: { $exception_level: 'fatal', drop: null, area: 'checkout' },
    })

    expect(requests).toHaveLength(1)
    const properties = requests[0].batch[0].properties
    expect(properties).toMatchObject({ $exception_level: 'warning', area: 'checkout' })
    expect(properties).not.toHaveProperty('drop')
  })

  it('does not invoke a custom serializer when beforeSend discards the event', async () => {
    await client.shutdown()
    client = makeClient({ beforeSend: () => null })
    const toJSON = vi.fn(() => {
      throw new Error('discarded serializer evaluated')
    })

    await client.captureExceptionImmediate(new Error('boom'), 'user', { data: { toJSON } })

    expect(requests).toEqual([])
    expect(toJSON).not.toHaveBeenCalled()
  })

  it('respects toJSON without reading hidden properties and cleans its serialized representation', async () => {
    const hiddenGetter = vi.fn(() => {
      throw new Error('nested getter evaluated')
    })
    const data = {
      get value() {
        return hiddenGetter()
      },
      toJSON(key: string) {
        expect(this).toBe(data)
        return { safe: true, key, drop: null, items: [null, { drop: null }] }
      },
    }
    expect(JSON.parse(JSON.stringify({ data })).data.safe).toBe(true)
    await client.captureExceptionImmediate(new Error('boom'), 'user', { data })

    expect(requests).toHaveLength(1)
    expect(requests[0].batch[0].properties.data).toEqual({ safe: true, key: 'data', items: [null, {}] })
    expect(hiddenGetter).not.toHaveBeenCalled()
    expect(Object.getOwnPropertyDescriptor(data, 'value')?.get).toBeDefined()
  })

  it.each(['$exception_future_field', '$exception_list', '$debug_images', '$cymbal_errors'])(
    'discards reserved %s before reading its nested values',
    async (key) => {
      const hiddenGetter = vi.fn(() => {
        throw new Error('ignored nested getter evaluated')
      })
      const data = {
        get value() {
          return hiddenGetter()
        },
        toJSON() {
          return { safe: true }
        },
      }
      await client.captureExceptionImmediate(new Error('boom'), 'user', { [key]: data, area: 'checkout' })

      expect(requests).toHaveLength(1)
      expect(requests[0].batch[0].properties.area).toBe('checkout')
      expect(hiddenGetter).not.toHaveBeenCalled()
      if (key === '$exception_list') {
        expect(requests[0].batch[0].properties[key][0].type).toBe('Error')
      } else {
        expect(requests[0].batch[0].properties).not.toHaveProperty(key)
      }
    }
  )

  it('cleans toJSON null results according to their object or array position', async () => {
    const data = { toJSON: () => null }
    client.captureException(new Error('boom'), 'user', { data, items: [data] })
    await client.flush()

    expect(requests).toHaveLength(1)
    expect(requests[0].batch[0].properties).not.toHaveProperty('data')
    expect(requests[0].batch[0].properties.items).toEqual([null])
    expect(data.toJSON()).toBeNull()
  })

  it('uses the normal safe serializer for cycles returned by toJSON without reapplying its root hook', async () => {
    const secondHook = vi.fn(() => {
      throw new Error('representation hook must not run twice')
    })
    const cycle: Record<string, any> = {}
    cycle.self = cycle
    const representation = { drop: null, toJSON: secondHook, cycle }
    const data = { toJSON: () => representation }
    await client.captureExceptionImmediate(new Error('boom'), 'user', { data })

    expect(requests).toHaveLength(1)
    expect(requests[0].batch[0].properties.data).toEqual({ cycle: { self: '[Circular]' } })
    expect(secondHook).not.toHaveBeenCalled()
    expect(cycle.self).toBe(cycle)
    expect(representation.drop).toBeNull()
  })

  it('does not read an ignored reserved property getter', async () => {
    const ignoredGetter = vi.fn(() => {
      throw new Error('ignored getter evaluated')
    })
    const properties = {
      get $exception_future_field() {
        return ignoredGetter()
      },
      area: 'checkout',
    }
    await client.captureExceptionImmediate(new Error('boom'), 'user', properties)

    expect(requests).toHaveLength(1)
    expect(requests[0].batch[0].properties.area).toBe('checkout')
    expect(ignoredGetter).not.toHaveBeenCalled()
  })

  it('delivers deeply nested JSON without overflowing cleanup and preserves null semantics', async () => {
    let data: Record<string, any> = { end: true, drop: null, items: [null, { drop: null }] }
    for (let index = 0; index < 4000; index++) data = { child: data }
    expect(JSON.stringify({ data }).length).toBeGreaterThan(40000)
    await client.captureExceptionImmediate(new Error('boom'), 'user', { data })

    expect(requests).toHaveLength(1)
    let delivered = requests[0].batch[0].properties.data
    let original = data
    for (let index = 0; index < 4000; index++) {
      delivered = delivered.child
      original = original.child
    }
    expect(delivered).toEqual({ end: true, items: [null, {}] })
    expect(original).toEqual({ end: true, drop: null, items: [null, { drop: null }] })
  })
})

describe('ErrorTracking.buildEventMessage', () => {
  it('does not let custom properties forge generated or processor-owned exception metadata', async () => {
    const properties = {
      $exception_list: [{ type: 'ForgedError', value: 'forged' }],
      $exception_level: 'fatal',
      $exception_source: 'forged.integration',
      $exception_future_field: 'forged',
      $exception_issue_id: 'forged',
      $debug_images: ['forged'],
      $cymbal_errors: ['forged'],
      $exception_fingerprint: 'custom-fingerprint',
      area: 'checkout',
    }
    const original = structuredClone(properties)
    const event = await ErrorTracking.buildEventMessage(builder, new TypeError('canonical'), {}, 'user', properties)

    expect(event.properties?.$exception_list[0]).toMatchObject({ type: 'TypeError', value: 'canonical' })
    expect(event.properties?.$exception_level).toBe('error')
    for (const key of [
      '$exception_source',
      '$exception_future_field',
      '$exception_issue_id',
      '$debug_images',
      '$cymbal_errors',
    ]) {
      expect(event.properties).not.toHaveProperty(key)
    }
    expect(event.properties?.area).toBe('checkout')
    expect(event.properties?.$exception_fingerprint).toBe('custom-fingerprint')
    expect(properties).toEqual(original)
  })
})
