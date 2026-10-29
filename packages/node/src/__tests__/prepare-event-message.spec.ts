import { PostHog } from '../entrypoints/index.node'

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
      properties: { plan: 'pro', $geoip_disable: false, $is_server: true },
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
})
