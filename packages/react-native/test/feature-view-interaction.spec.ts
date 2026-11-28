import { PostHog, PostHogPersistedProperty } from '../src'

vi.useRealTimers()
const clients: PostHog[] = []
const newPostHog = (): PostHog => {
  const client = new PostHog('test-token', {
    persistence: 'memory',
    flushInterval: 0,
    captureAppLifecycleEvents: false,
    preloadFeatureFlags: false,
    bootstrap: { featureFlags: { multi: 'variant-a', bool: true, off: false } },
  })
  clients.push(client)
  return client
}
const queuedEvents = (client: PostHog): any[] =>
  ((client.getPersistedProperty(PostHogPersistedProperty.Queue) as any[]) ?? []).map((item) => item.message)

beforeEach(() => {
  global.fetch = vi.fn(async () => ({ status: 200, json: async () => ({}) })) as any
})
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.shutdown()))
})

describe.each([
  ['captureFeatureView', '$feature_view'],
  ['captureFeatureInteraction', '$feature_interaction'],
] as const)('%s', (method, event) => {
  it('captures the current variant without $feature_flag_called', async () => {
    const client = newPostHog()
    await client.ready()
    client[method]('multi')

    const events = queuedEvents(client)
    expect(events.map((e) => e.event)).toEqual([event])
    expect(events[0].properties).toMatchObject({
      feature_flag: 'multi',
      feature_flag_variant: 'variant-a',
      $set: { [`${event}/multi`]: 'variant-a' },
    })
  })

  it.each([
    ['bool', true],
    ['off', false],
  ])('sets the boolean value of %s without a variant property', async (flag, value) => {
    const client = newPostHog()
    await client.ready()
    client[method](flag)

    const [captured] = queuedEvents(client)
    expect(captured.properties).not.toHaveProperty('feature_flag_variant')
    expect(captured.properties.$set).toEqual({ [`${event}/${flag}`]: value })
  })

  it('uses the given variant over the flag value', async () => {
    const client = newPostHog()
    await client.ready()
    client[method]('multi', 'variant-b')

    const [captured] = queuedEvents(client)
    expect(captured.properties).toMatchObject({
      feature_flag_variant: 'variant-b',
      $set: { [`${event}/multi`]: 'variant-b' },
    })
  })

  it('skips the event when the flag has no value and no variant is given', async () => {
    const client = newPostHog()
    await client.ready()
    client[method]('unknown')

    expect(queuedEvents(client)).toEqual([])
  })
})
