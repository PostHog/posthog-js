import { PostHog, PostHogOptions, PostHogPersistedProperty } from '../src'

vi.useRealTimers()
const clients: PostHog[] = []
const newPostHog = (options: PostHogOptions = {}): PostHog => {
  const client = new PostHog('test-token', {
    persistence: 'memory',
    flushInterval: 0,
    captureAppLifecycleEvents: false,
    preloadFeatureFlags: false,
    ...options,
  })
  clients.push(client)
  return client
}
const queued = (client: PostHog, event: string): any =>
  ((client.getPersistedProperty(PostHogPersistedProperty.Queue) as any[]) ?? [])
    .map((item) => item.message)
    .filter((message) => message.event === event)
    .at(-1)

beforeEach(() => {
  global.fetch = vi.fn(async () => ({ status: 200, json: async () => ({}) })) as any
})
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.shutdown()))
})

describe('event property order', () => {
  it('lets registered properties win over the SDK properties, and caller properties win over both', () => {
    const client = newPostHog({ customAppProperties: { $os_name: 'SDK OS', $app_version: 'sdk' } })
    client.register({ $os_name: 'Registered OS', $app_version: 'registered', $screen_width: 1 })
    client.capture('Signed Up', { $app_version: 'caller' })
    expect(queued(client, 'Signed Up').properties).toMatchObject({
      $os_name: 'Registered OS',
      $app_version: 'caller',
      $screen_width: 1,
    })

    client.unregister('$os_name')
    client.capture('Viewed Dashboard')
    expect(queued(client, 'Viewed Dashboard').properties.$os_name).toBe('SDK OS')
  })

  it('lets registered properties win over the SDK properties on $autocapture', () => {
    const client = newPostHog()
    client.register({ $screen_height: 1 })
    client.autocapture('touch', [])
    expect(queued(client, '$autocapture').properties.$screen_height).toBe(1)
  })

  it.each([
    [{ $lib: 'my-wrapper' }, { $lib: 'my-wrapper' }],
    [
      { $lib: 'my-wrapper', $lib_version: '9.9.9' },
      { $lib: 'my-wrapper', $lib_version: '9.9.9' },
    ],
    [{ $lib_version: '9.9.9' }, { $lib: 'posthog-react-native', $lib_version: 'sdk' }],
    [{ $lib: 'posthog-react-native' }, { $lib: 'posthog-react-native', $lib_version: 'sdk' }],
  ])('fills the library name and version as a pair after the caller properties (case %#)', (properties, expected) => {
    const client = newPostHog()
    client.capture('Signed Up', properties)
    const sent = queued(client, 'Signed Up').properties
    expect({ $lib: sent.$lib, $lib_version: sent.$lib_version }).toEqual({
      $lib_version: undefined,
      ...expected,
      ...(expected.$lib_version === 'sdk' && { $lib_version: client.getLibraryVersion() }),
    })
  })

  it('fills the library name and version as a pair after the registered properties', () => {
    const client = newPostHog()
    client.register({ $lib_version: '9.9.9' })
    client.capture('Signed Up')
    expect(queued(client, 'Signed Up').properties).toMatchObject({
      $lib: 'posthog-react-native',
      $lib_version: client.getLibraryVersion(),
    })
  })

  it('lets a registered or caller $geoip_disable win over disableGeoip', () => {
    const client = newPostHog({ disableGeoip: true })
    client.capture('Signed Up')
    expect(queued(client, 'Signed Up').properties.$geoip_disable).toBe(true)

    client.register({ $geoip_disable: false })
    client.capture('Viewed Dashboard')
    expect(queued(client, 'Viewed Dashboard').properties.$geoip_disable).toBe(false)

    client.unregister('$geoip_disable')
    client.capture('Logged Out', { $geoip_disable: false })
    expect(queued(client, 'Logged Out').properties.$geoip_disable).toBe(false)
  })

  it('lets a per-call disableGeoip win over a registered $geoip_disable', () => {
    const client = newPostHog({ disableGeoip: true })
    client.register({ $geoip_disable: false })
    client.capture('Signed Up', {}, { disableGeoip: true })
    expect(queued(client, 'Signed Up').properties.$geoip_disable).toBe(true)

    client.register({ $geoip_disable: true })
    client.capture('Viewed Dashboard', {}, { disableGeoip: false })
    expect(queued(client, 'Viewed Dashboard').properties.$geoip_disable).toBe(false)
  })

  it('lets a caller $geoip_disable win over a per-call disableGeoip', () => {
    const client = newPostHog({ disableGeoip: true })
    client.capture('Signed Up', { $geoip_disable: false }, { disableGeoip: true })
    expect(queued(client, 'Signed Up').properties.$geoip_disable).toBe(false)

    client.register({ $geoip_disable: false })
    client.capture('Viewed Dashboard', { $geoip_disable: true }, { disableGeoip: false })
    expect(queued(client, 'Viewed Dashboard').properties.$geoip_disable).toBe(true)
  })

  it('leaves the SDK session alone when a caller $session_id wins', () => {
    const client = newPostHog()
    const sessionId = client.getSessionId()
    const lastActivity = Date.now() - 3600 * 1000
    client.setPersistedProperty(PostHogPersistedProperty.SessionLastTimestamp, lastActivity)

    client.capture('Signed Up', { $session_id: 'caller-session' })

    expect(client.getPersistedProperty(PostHogPersistedProperty.SessionId)).toBe(sessionId)
    expect(client.getPersistedProperty(PostHogPersistedProperty.SessionLastTimestamp)).toBe(lastActivity)
  })

  it('merges a caller $groups over the registered groups for that event only', () => {
    const client = newPostHog()
    client.group('company', 'acme')
    client.group('team', 't1')

    client.capture('Signed Up', { $groups: { team: 't2', project: 'p1' } })
    client.capture('Viewed Dashboard')

    expect(queued(client, 'Signed Up').properties.$groups).toEqual({ company: 'acme', team: 't2', project: 'p1' })
    expect(queued(client, 'Viewed Dashboard').properties.$groups).toEqual({ company: 'acme', team: 't1' })
  })

  it('keeps an anonymous user personless when a caller $groups is set', () => {
    const client = newPostHog()

    client.capture('Signed Up', { $groups: { company: 'acme' } })

    expect(queued(client, 'Signed Up').options).toEqual({ process_person_profile: false })
    expect(client.getPersistedProperty(PostHogPersistedProperty.PersonMode)).toBeUndefined()
  })

  it('records session activity when a registered $session_id wins', () => {
    const client = newPostHog()
    const sessionId = client.getSessionId()
    const lastActivity = Date.now() - 1000
    client.setPersistedProperty(PostHogPersistedProperty.SessionLastTimestamp, lastActivity)
    client.register({ $session_id: 'registered-session' })

    client.capture('Signed Up')

    expect(queued(client, 'Signed Up').properties.$session_id).toBe('registered-session')
    expect(client.getPersistedProperty(PostHogPersistedProperty.SessionId)).toBe(sessionId)
    expect(client.getPersistedProperty(PostHogPersistedProperty.SessionLastTimestamp)).toBeGreaterThan(lastActivity)
  })

  it('lets a registered or caller $session_id win for that event, and treats a null or blank one as unset', () => {
    const client = newPostHog()
    const sessionId = client.getSessionId()
    client.register({ $session_id: 'registered-session' })
    client.capture('Signed Up')
    expect(queued(client, 'Signed Up').properties.$session_id).toBe('registered-session')

    client.capture('Viewed Dashboard', { $session_id: 'caller-session' })
    expect(queued(client, 'Viewed Dashboard').properties.$session_id).toBe('caller-session')

    client.unregister('$session_id')
    for (const value of [null, ' ']) {
      client.capture('Logged Out', { $session_id: value })
      expect(queued(client, 'Logged Out').properties.$session_id).toBe(sessionId)
    }
  })
})
