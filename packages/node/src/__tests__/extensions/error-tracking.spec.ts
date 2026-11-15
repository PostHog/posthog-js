import { ErrorTracking as CoreErrorTracking } from '@posthog/core'
import ErrorTracking from '@/extensions/error-tracking'
import { PostHog } from '@/entrypoints/index.node'

const builder = new CoreErrorTracking.ErrorPropertiesBuilder(
  [new CoreErrorTracking.ErrorCoercer()],
  CoreErrorTracking.createStackParser('node:javascript', CoreErrorTracking.nodeStackLineParser),
  []
)

describe('public exception custom-property delivery', () => {
  let client: PostHog
  let requests: Record<string, any>[]

  beforeEach(() => {
    requests = []
    client = new PostHog('test-token', {
      host: 'http://example.test',
      flushInterval: 0,
      disableCompression: true,
      fetchRetryCount: 0,
      fetch: async (_url, options) => {
        requests.push(JSON.parse(options.body as string))
        return { status: 200, text: async () => '{}', json: async () => ({}) }
      },
    })
  })

  afterEach(async () => {
    await client.shutdown()
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
  it('drops null custom object properties without changing arrays, other values or caller input', async () => {
    const properties = {
      test: null,
      nested: { drop: null, enabled: false, attempt: 0, text: '' },
      items: ['1', null, { drop: null }],
      date: new Date('2025-01-01T00:00:00Z'),
    }
    const original = structuredClone(properties)
    const event = await ErrorTracking.buildEventMessage(builder, new TypeError('boom'), {}, 'user', properties)

    expect(event.properties).not.toHaveProperty('test')
    expect(event.properties).toMatchObject({
      nested: { enabled: false, attempt: 0, text: '' },
      items: ['1', null, {}],
      date: properties.date,
    })
    expect(event.properties?.nested).not.toHaveProperty('drop')
    expect(event.properties?.$exception_list[0]).toMatchObject({ type: 'TypeError', value: 'boom' })
    expect(properties).toEqual(original)
  })

  it('keeps sparse array positions and circular references without mutating them', async () => {
    const items = new Array(3)
    items[1] = null
    const properties: Record<string, any> = { items, drop: null }
    properties.self = properties
    const event = await ErrorTracking.buildEventMessage(builder, new Error('boom'), {}, 'user', properties)

    expect(event.properties?.items).toHaveLength(3)
    expect(event.properties?.items[1]).toBeNull()
    expect(event.properties?.self.self).toBe(event.properties?.self)
    expect(event.properties?.self).not.toHaveProperty('drop')
    expect(properties.drop).toBeNull()
    expect(properties.self).toBe(properties)
  })

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
