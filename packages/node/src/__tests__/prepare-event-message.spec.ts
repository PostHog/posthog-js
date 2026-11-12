import { PostHog } from '../entrypoints/index.node'
import { version } from '../version'

describe('PostHog.prepareEventMessage', () => {
  let posthog: PostHog

  beforeEach(() => {
    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
    })
  })

  afterEach(async () => {
    await posthog.shutdown()
  })

  it('returns the message shape, with the filled options and top-level uuid, timestamp and disableGeoip', async () => {
    const timestamp = new Date('2026-01-02T03:04:05Z')
    const uuid = '0191c0a2-6f3c-7a8e-9b1d-2c3e4f5a6b7c'
    await posthog.registerOptions({ cookieless_mode: true })

    const message = await posthog.prepareEventMessage({
      distinctId: 'user_1',
      event: 'test_event',
      properties: { plan: 'pro' },
      options: { product_tour_id: 'tour' },
      uuid,
      timestamp,
      disableGeoip: false,
    })

    expect(message).toStrictEqual({
      distinctId: 'user_1',
      event: 'test_event',
      properties: { plan: 'pro', $lib: 'posthog-node', $lib_version: version, $geoip_disable: false, $is_server: true },
      options: { product_tour_id: 'tour', cookieless_mode: true },
      uuid,
      timestamp,
      disableGeoip: false,
    })
  })

  it('should NOT include $groups if groups is undefined', async () => {
    const message = await posthog.prepareEventMessage({
      distinctId: 'user_1',
      event: 'test_event',
    })
    expect(message.properties.$groups).toBeUndefined()
    expect(message.properties).not.toHaveProperty('$groups')
  })

  it('should NOT include $groups if groups is an empty object', async () => {
    const message = await posthog.prepareEventMessage({
      distinctId: 'user_1',
      event: 'test_event',
      groups: {},
    })
    expect(message.properties.$groups).toBeUndefined()
    expect(message.properties).not.toHaveProperty('$groups')
  })

  it('should include $groups if groups is NOT empty', async () => {
    const message = await posthog.prepareEventMessage({
      distinctId: 'user_1',
      event: 'test_event',
      groups: { organization: 'org_1' },
    })
    expect(message.properties.$groups).toEqual({ organization: 'org_1' })
  })
  describe('service name', () => {
    const prepare = async (options: object, properties?: Record<string, unknown>) => {
      const client = new PostHog('TEST_API_KEY', { host: 'http://example.com', ...options })
      try {
        return await client.prepareEventMessage({ distinctId: 'user_1', event: 'test_event', properties })
      } finally {
        await client.shutdown()
      }
    }

    it('stamps traces.serviceName on events', async () => {
      const message = await prepare({ traces: { serviceName: 'checkout-api' } })
      expect(message.properties.service_name).toBe('checkout-api')
    })

    it('falls back to metrics.serviceName', async () => {
      const message = await prepare({ metrics: { serviceName: 'billing-worker' } })
      expect(message.properties.service_name).toBe('billing-worker')
    })

    it('does not stamp anything when no service name is configured', async () => {
      const message = await prepare({})
      expect(message.properties).not.toHaveProperty('service_name')
    })

    it('prefers service.name from traces resource attributes, as spans do', async () => {
      const message = await prepare({
        traces: { serviceName: 'ignored', resourceAttributes: { 'service.name': 'checkout-api' } },
      })
      expect(message.properties.service_name).toBe('checkout-api')
    })

    it('prefers service.name from metrics resource attributes, as metrics do', async () => {
      const message = await prepare({
        metrics: { serviceName: 'ignored', resourceAttributes: { 'service.name': 'billing-worker' } },
      })
      expect(message.properties.service_name).toBe('billing-worker')
    })

    it('stamps events prepared without context properties (identify, alias, groupIdentify)', async () => {
      const client = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        traces: { serviceName: 'checkout-api' },
      })
      try {
        const message = await (client as any)._prepareEventMessage(
          { distinctId: 'user_1', event: '$identify', properties: { $set: { plan: 'pro' } } },
          { includeContextProperties: false }
        )
        expect(message.properties.service_name).toBe('checkout-api')
        expect(message.properties.$set).toEqual({ plan: 'pro' })
      } finally {
        await client.shutdown()
      }
    })

    it('lets an explicit property win', async () => {
      const message = await prepare({ traces: { serviceName: 'checkout-api' } }, { service_name: 'custom' })
      expect(message.properties.service_name).toBe('custom')
    })
  })
})
