import { PostHog } from '../src/posthog-rn'

describe('$used_bootstrap_value on $feature_flag_called', () => {
  let posthog: PostHog

  const createClient = async (): Promise<PostHog> => {
    ;(globalThis as any).window.fetch = vi.fn(async (url: string) => ({
      status: 200,
      json: async () =>
        url.includes('/flags')
          ? { flags: { remote: { key: 'remote', enabled: true, metadata: {} } }, requestId: 'request-1' }
          : {},
    }))
    const client = new PostHog('token', {
      persistence: 'memory',
      flushInterval: 0,
      preloadFeatureFlags: false,
      bootstrap: { featureFlags: { bootstrapped: true } },
    })
    await client.ready()
    return client
  }

  const flagCalledProperties = (capture: ReturnType<typeof vi.spyOn>, key: string): Record<string, unknown> =>
    capture.mock.calls.find(
      ([event, properties]) => event === '$feature_flag_called' && properties?.$feature_flag === key
    )?.[1]

  afterEach(async () => {
    await posthog.shutdown()
  })

  it('is sent only for a bootstrapped flag before the first /flags response', async () => {
    posthog = await createClient()
    const capture = vi.spyOn(posthog, 'capture')

    posthog.getFeatureFlag('bootstrapped')
    posthog.getFeatureFlag('remote')

    expect(flagCalledProperties(capture, 'bootstrapped')).toMatchObject({ $used_bootstrap_value: true })
    expect(flagCalledProperties(capture, 'remote')).not.toHaveProperty('$used_bootstrap_value')
  })

  it('is false for a bootstrapped flag after a /flags response and absent for other flags', async () => {
    posthog = await createClient()
    await posthog.reloadFeatureFlagsAsync()
    const capture = vi.spyOn(posthog, 'capture')

    posthog.getFeatureFlag('bootstrapped')
    posthog.getFeatureFlag('remote')

    expect(flagCalledProperties(capture, 'bootstrapped')).toMatchObject({
      $feature_flag_bootstrapped_response: true,
      $used_bootstrap_value: false,
    })
    expect(flagCalledProperties(capture, 'remote')).toMatchObject({ $feature_flag_response: true })
    expect(flagCalledProperties(capture, 'remote')).not.toHaveProperty('$used_bootstrap_value')
  })
})
