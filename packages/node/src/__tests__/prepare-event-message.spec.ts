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
