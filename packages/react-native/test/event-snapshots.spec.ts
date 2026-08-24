import { AppState, Linking } from 'react-native'

import { PostHog } from '../src'

Linking.getInitialURL = jest.fn(() => Promise.resolve(null))
AppState.addEventListener = jest.fn()

const fixedTime = new Date('2024-01-02T03:04:05.000Z')
const clients: PostHog[] = []

type FetchCall = [string, { body?: unknown; headers?: Record<string, string>; method?: string }]
type WireEvent = Record<string, any> & { properties: Record<string, any> }

const mockResponse = (body: Record<string, unknown> = { status: 'ok' }) => ({
  status: 200,
  json: () => Promise.resolve(body),
})

const installFetchMock = (responseForUrl?: (url: string) => Record<string, unknown>): jest.Mock => {
  const fetchMock = jest.fn(async (url: string) => mockResponse(responseForUrl?.(url)))
  ;(globalThis as any).window = (globalThis as any).window ?? {}
  ;(globalThis as any).window.fetch = fetchMock
  ;(globalThis as any).fetch = fetchMock
  return fetchMock
}

const normalizeSdkVersion = (value: unknown): string => {
  expect(typeof value).toBe('string')
  expect(value).not.toBe('')
  return '<sdk-version>'
}

const normalizeEvent = (event: WireEvent): WireEvent => {
  expect(typeof event.uuid).toBe('string')
  expect(event.uuid).not.toBe('')
  expect(typeof event.timestamp).toBe('string')
  expect(event.timestamp).toBe(fixedTime.toISOString())
  expect(typeof event.properties.$session_id).toBe('string')
  expect(event.properties.$session_id).not.toBe('')

  return {
    ...event,
    uuid: '<event-uuid>',
    timestamp: '<event-timestamp>',
    properties: {
      ...event.properties,
      $lib_version: normalizeSdkVersion(event.properties.$lib_version),
      $session_id: '<session-id>',
    },
  }
}

const parsedCall = (fetchMock: jest.Mock, path: string): { url: string; options: FetchCall[1]; body: any } => {
  const call = fetchMock.mock.calls.find(([url]) => new URL(url).pathname === path) as FetchCall | undefined
  expect(call).toBeDefined()
  expect(call![1].method).toBe('POST')
  expect(call![1].headers).toEqual(expect.objectContaining({ 'Content-Type': 'application/json' }))
  expect(typeof call![1].body).toBe('string')

  return { url: call![0], options: call![1], body: JSON.parse(call![1].body as string) }
}

const createClient = (options: ConstructorParameters<typeof PostHog>[1] = {}): PostHog => {
  const client = new PostHog('snapshot-project-token', {
    host: 'https://snapshot.posthog.test',
    persistence: 'memory',
    flushInterval: 0,
    disableCompression: true,
    disableRemoteConfig: true,
    disableSurveys: true,
    captureAppLifecycleEvents: false,
    capturePushNotificationSubscriptions: false,
    capturePushNotificationOpened: false,
    customAppProperties: {
      $app_build: '42',
      $app_name: 'Snapshot App',
      $app_namespace: 'com.posthog.snapshot',
      $app_version: '1.2.3',
      $device_manufacturer: 'PostHog',
      $device_name: 'Snapshot Phone',
      $device_type: 'Mobile',
      $is_emulator: false,
      $locale: 'en-US',
      $os_name: 'iOS',
      $os_version: '17.0',
      $timezone: 'UTC',
    },
    ...options,
  })
  clients.push(client)
  return client
}

describe('PostHog React Native event and request snapshots', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] })
    jest.setSystemTime(fixedTime)
  })

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.shutdown()))
    jest.useRealTimers()
  })

  it('serializes timestamp overrides as UTC without rewriting caller properties', async () => {
    const fetchMock = installFetchMock()
    const posthog = createClient({ disableRemoteFeatureFlags: true, setDefaultPersonProperties: false })
    await posthog.ready()

    posthog.capture(
      'timezone override',
      { caller_timestamp: '2024-01-02T12:04:05.000+09:00' },
      { timestamp: new Date('2024-01-02T12:04:05.000+09:00') }
    )
    await posthog.flush()

    const event = parsedCall(fetchMock, '/batch/').body.batch[0]
    expect(event.timestamp).toBe('2024-01-02T03:04:05.000Z')
    expect(event.properties.caller_timestamp).toBe('2024-01-02T12:04:05.000+09:00')
  })

  it('snapshots complete enriched analytics events at the decoded batch boundary', async () => {
    const fetchMock = installFetchMock()
    const posthog = createClient({
      disableRemoteFeatureFlags: true,
      setDefaultPersonProperties: false,
      bootstrap: {
        distinctId: 'anonymous-snapshot-id',
        featureFlags: { 'checkout-flow': 'treatment' },
      },
    })
    await posthog.ready()

    posthog.register({ account_tier: 'pro' })
    posthog.capture('report exported', {
      export_format: 'csv',
      row_count: 42,
      undefined_fixture: undefined,
    })
    posthog.identify('identified-snapshot-id', {
      email: 'snapshot@example.com',
      $set_once: { first_seen_source: 'mobile' },
    })
    posthog.group('company', 'posthog', { name: 'PostHog', plan: 'enterprise' })
    expect(posthog.getFeatureFlag('checkout-flow')).toBe('treatment')

    const error = new Error('Snapshot checkout failure')
    error.stack = 'Error: Snapshot checkout failure\n    at checkout (app://checkout.ts:42:7)'
    posthog.captureException(error, { order_id: 'order-123' })

    await posthog.flush()

    const request = parsedCall(fetchMock, '/batch/')
    expect(request.body.sent_at).toBe(fixedTime.toISOString())
    expect(request.body.batch).toHaveLength(5)
    expect(request.body.batch[0].properties).not.toHaveProperty('undefined_fixture')
    expect(new Set(request.body.batch.map((event: WireEvent) => event.properties.$session_id))).toHaveProperty(
      'size',
      1
    )
    const eventUuids = request.body.batch.map((event: WireEvent) => event.uuid)
    eventUuids.forEach((uuid: unknown) => expect(typeof uuid).toBe('string'))
    expect(new Set(eventUuids)).toHaveProperty('size', eventUuids.length)

    const headers = { ...request.options.headers }
    expect(headers['User-Agent']).toMatch(/^posthog-react-native\/.+/)
    headers['User-Agent'] = `posthog-react-native/${normalizeSdkVersion(
      headers['User-Agent']?.replace('posthog-react-native/', '')
    )}`

    expect({
      url: request.url,
      method: request.options.method,
      headers,
      body: {
        ...request.body,
        batch: request.body.batch.map(normalizeEvent),
      },
    }).toMatchSnapshot()
  })

  it('snapshots the complete decoded feature flags request', async () => {
    const fetchMock = installFetchMock((url) =>
      url.includes('/flags/')
        ? {
            featureFlags: { 'checkout-flow': 'treatment' },
            featureFlagPayloads: { 'checkout-flow': { button: 'Buy now' } },
            requestId: 'flags-request-id',
          }
        : { status: 'ok' }
    )
    const posthog = createClient({
      setDefaultPersonProperties: true,
      preloadFeatureFlags: false,
      evaluationContexts: ['production', 'mobile'],
      bootstrap: { distinctId: 'flags-snapshot-id', isIdentifiedId: true },
    })
    await posthog.ready()

    posthog.register({ $groups: { company: 'posthog' } })
    posthog.setPersonPropertiesForFlags({ email: 'flags@example.com', plan: 'pro' }, false)
    posthog.setGroupPropertiesForFlags({ company: { name: 'PostHog', employees: 1000 } }, false)
    await posthog.reloadFeatureFlagsAsync()

    const request = parsedCall(fetchMock, '/flags/')
    expect(typeof request.body.$anon_distinct_id).toBe('string')
    expect(request.body.$anon_distinct_id).not.toBe('')
    expect(request.body.$anon_distinct_id).not.toBe(request.body.distinct_id)
    request.body.$anon_distinct_id = '<anonymous-id>'
    request.body.person_properties.$lib_version = normalizeSdkVersion(request.body.person_properties.$lib_version)

    const headers = { ...request.options.headers }
    expect(headers['User-Agent']).toMatch(/^posthog-react-native\/.+/)
    headers['User-Agent'] = `posthog-react-native/${normalizeSdkVersion(
      headers['User-Agent']?.replace('posthog-react-native/', '')
    )}`

    expect({
      url: request.url,
      method: request.options.method,
      headers,
      body: request.body,
    }).toMatchSnapshot()
  })
})
