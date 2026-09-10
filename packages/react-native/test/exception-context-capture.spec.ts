import { PostHog, PostHogOptions, PostHogPersistedProperty } from '../src'
import { AppState } from 'react-native'

const updates = vi.hoisted(() => ({
  isEnabled: true,
  updateId: 'ota-id',
  runtimeVersion: 'runtime',
  channel: 'production',
  isEmbeddedLaunch: false,
}))
vi.mock('../src/optional/OptionalExpoUpdates', () => ({ OptionalExpoUpdates: updates }))
const getPowerStateSync = vi.hoisted(() => vi.fn())
vi.mock('../src/optional/OptionalReactNativeDeviceInfo', () => ({
  OptionalReactNativeDeviceInfo: { getPowerStateSync },
}))

vi.useRealTimers()
const clients: PostHog[] = []
const newPostHog = (options: PostHogOptions = {}): PostHog => {
  const client = new PostHog('test-token', {
    persistence: 'memory',
    flushInterval: 0,
    captureAppLifecycleEvents: false,
    preloadFeatureFlags: false,
    disableRemoteConfig: true,
    ...options,
  })
  clients.push(client)
  return client
}
const exceptions = (client: PostHog): any[] =>
  ((client.getPersistedProperty(PostHogPersistedProperty.Queue) as any[]) ?? [])
    .map((item) => item.message)
    .filter((message) => message.event === '$exception')

beforeEach(() => {
  AppState.currentState = 'active'
  updates.updateId = 'ota-id'
  getPowerStateSync.mockReset().mockReturnValue({ batteryLevel: 0.5, batteryState: 'charging', lowPowerMode: true })
  global.fetch = vi.fn(async () => ({ status: 200, json: async () => ({}) })) as any
})
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.shutdown()))
  vi.unstubAllGlobals()
  AppState.currentState = 'active'
})

describe('PostHog.captureException context', () => {
  it('survives the real first JS exception path alongside existing app and exception metadata', () => {
    const client = newPostHog()
    expect(getPowerStateSync).not.toHaveBeenCalled()
    client.captureException(new Error('boom'))
    expect(exceptions(client)[0].properties).toMatchObject({
      $app_version: 'mock',
      $app_build: 'mock',
      $app_state: 'active',
      $expo_update_id: 'ota-id',
      $expo_runtime_version: 'runtime',
      $expo_channel: 'production',
      $expo_is_embedded_launch: false,
      $battery_level: 0.5,
      $battery_charging: true,
      $low_power_mode: true,
      $exception_list: [expect.objectContaining({ value: 'boom' })],
    })
    updates.updateId = 'next-id'
    AppState.currentState = 'background'
    client.captureException(new Error('next'))
    expect(exceptions(client)[1].properties).toMatchObject({ $expo_update_id: 'next-id', $app_state: 'background' })
    client.capture('ordinary event')
    const queue = client.getPersistedProperty(PostHogPersistedProperty.Queue) as any[]
    expect(queue.at(-1).message.properties).not.toHaveProperty('$expo_update_id')
    expect(queue.at(-1).message.properties).not.toHaveProperty('$app_state')
  })

  it('preserves caller overrides, custom static app properties and exception steps', () => {
    const client = newPostHog({ customAppProperties: { $app_version: 'custom-version', $app_build: 'custom-build' } })
    const properties = { $expo_update_id: 'caller-id', $app_state: null, $battery_level: 0.75, custom: true }
    client.addExceptionStep('before error')
    client.captureException(new Error('boom'), properties)
    expect(exceptions(client)[0].properties).toMatchObject({
      ...properties,
      $app_version: 'custom-version',
      $app_build: 'custom-build',
      $exception_steps: [expect.objectContaining({ $message: 'before error' })],
    })
    expect(properties).not.toHaveProperty('$expo_channel')
  })

  it('allows before_send to strip context or suppress the event', () => {
    const before_send = vi.fn((event) => {
      if (event.properties.drop) return null
      delete event.properties.$expo_update_id
      delete event.properties.$app_state
      return event
    })
    const client = newPostHog({ before_send })
    client.captureException(new Error('keep'))
    client.captureException(new Error('drop'), { drop: true })
    expect(before_send).toHaveBeenCalled()
    expect(exceptions(client)).toHaveLength(1)
    expect(exceptions(client)[0].properties).not.toHaveProperty('$expo_update_id')
    expect(exceptions(client)[0].properties).not.toHaveProperty('$app_state')
  })

  it.each([{ disabled: true }, { defaultOptIn: false }])('respects suppression %j', (options) => {
    const client = newPostHog(options)
    client.captureException(new Error('not sent'))
    expect(exceptions(client)).toEqual([])
    expect(getPowerStateSync).not.toHaveBeenCalled()
  })

  it('keeps the exception and OTA metadata when power collection throws', () => {
    getPowerStateSync.mockImplementation(() => {
      throw new Error('unlinked')
    })
    const client = newPostHog()
    client.captureException(new Error('original exception'))
    expect(exceptions(client)[0].properties).toMatchObject({
      $expo_update_id: 'ota-id',
      $exception_list: [expect.objectContaining({ value: 'original exception' })],
    })
    expect(exceptions(client)[0].properties).not.toHaveProperty('$battery_level')
  })

  it('respects runtime consent changes', async () => {
    const client = newPostHog()
    await client.optOut()
    client.captureException(new Error('not sent'))
    expect(exceptions(client)).toEqual([])
    await client.optIn()
    client.captureException(new Error('sent'))
    expect(exceptions(client)).toHaveLength(1)
  })

  it('enriches auto-captured JS errors and still calls the previous error handler', () => {
    const previous = vi.fn()
    let handler = previous
    vi.stubGlobal('ErrorUtils', {
      getGlobalHandler: () => handler,
      setGlobalHandler: (next: typeof handler) => {
        handler = next
      },
    })
    const client = newPostHog({ errorTracking: { autocapture: { uncaughtExceptions: true } } })
    handler(new Error('uncaught'), false)
    expect(exceptions(client)[0].properties).toMatchObject({ $expo_update_id: 'ota-id', $app_state: 'active' })
    expect(previous).toHaveBeenCalledTimes(1)
  })
})
