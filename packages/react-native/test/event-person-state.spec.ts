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

describe('event person state', () => {
  it('lets a caller $process_person_profile and $is_identified win for that event', () => {
    const client = newPostHog({ personProfiles: 'never' })
    client.capture('Signed Up', { $process_person_profile: true, $is_identified: true })
    expect(queued(client, 'Signed Up').properties).toMatchObject({
      $process_person_profile: true,
      $is_identified: true,
    })
    client.capture('Viewed Dashboard')
    expect(queued(client, 'Viewed Dashboard').properties).toMatchObject({
      $process_person_profile: false,
      $is_identified: false,
    })
  })

  it('lets a registered $process_person_profile win on ordinary events', () => {
    const client = newPostHog()
    client.identify('user-123')
    client.register({ $process_person_profile: false })
    client.capture('Viewed Dashboard')
    expect(queued(client, 'Viewed Dashboard').properties.$process_person_profile).toBe(false)
  })

  it('leaves a registered personless setting off person updates', () => {
    const client = newPostHog()
    client.register({ $process_person_profile: false })
    client.setPersonProperties({ plan: 'pro' })
    expect(queued(client, '$set').properties.$process_person_profile).toBe(true)
  })

  it('leaves a registered personless setting off identity events captured directly', () => {
    const client = newPostHog({ personProfiles: 'always' })
    client.register({ $process_person_profile: false })
    for (const event of ['$identify', '$create_alias', '$groupidentify']) {
      client.capture(event, { distinct_id: 'user-123' })
      expect(queued(client, event).properties.$process_person_profile).toBe(true)
    }
  })

  it('treats a null caller $process_person_profile and $is_identified as unset', () => {
    const client = newPostHog({ personProfiles: 'never' })
    client.capture('Signed Up', { $process_person_profile: null, $is_identified: null })
    expect(queued(client, 'Signed Up').properties).toMatchObject({
      $process_person_profile: false,
      $is_identified: false,
    })
  })

  it('lets a registered $is_identified win over the SDK value', () => {
    const client = newPostHog({ personProfiles: 'never' })
    client.register({ $is_identified: true })
    client.capture('Signed Up')
    expect(queued(client, 'Signed Up').properties.$is_identified).toBe(true)
  })

  it('leaves a registered personless setting off identity events', () => {
    const client = newPostHog()
    client.register({ $process_person_profile: false })
    client.identify('user-123')
    client.alias('alias-123')
    client.group('company', 'acme')
    for (const event of ['$identify', '$create_alias', '$groupidentify']) {
      expect(queued(client, event).properties).not.toHaveProperty('$process_person_profile')
    }
  })

  it('lets before_send set person processing on an identity event', () => {
    const client = newPostHog({
      before_send: (event) => {
        if (event?.event === '$identify') {
          event.properties.$process_person_profile = true
        }
        return event
      },
    })
    client.register({ $process_person_profile: false })
    client.identify('user-123')
    expect(queued(client, '$identify').properties.$process_person_profile).toBe(true)
  })

  it('stamps person processing and $is_identified on $autocapture', () => {
    const client = newPostHog({ personProfiles: 'identified_only' })
    client.autocapture('click', [])
    expect(queued(client, '$autocapture').properties).toMatchObject({
      $process_person_profile: false,
      $is_identified: false,
    })
    client.identify('user-123')
    client.autocapture('click', [])
    expect(queued(client, '$autocapture').properties).toMatchObject({
      $process_person_profile: true,
      $is_identified: true,
    })
  })
})

describe('null event properties', () => {
  it('drops null and undefined members without moving array elements', () => {
    const client = newPostHog()
    client.capture('Nullable Properties', {
      test: null,
      missing: undefined,
      nested: { drop: null },
      items: ['1', null, 2, { drop: null }, [null]],
      empty: '',
      zero: 0,
      enabled: false,
      literal: 'null',
      emptyArray: [],
    } as any)
    const properties = queued(client, 'Nullable Properties').properties
    expect(properties).not.toHaveProperty('test')
    expect(properties).not.toHaveProperty('missing')
    expect(properties).toMatchObject({
      nested: {},
      items: ['1', null, 2, {}, [null]],
      empty: '',
      zero: 0,
      enabled: false,
      literal: 'null',
      emptyArray: [],
    })
  })

  it('drops null members a before_send hook adds', () => {
    const client = newPostHog({
      before_send: (event) => {
        if (event) {
          event.properties.hookNull = null
          event.properties.hookItems = [null, { drop: null }]
        }
        return event
      },
    })
    client.capture('Hook Properties')
    const properties = queued(client, 'Hook Properties').properties
    expect(properties).not.toHaveProperty('hookNull')
    expect(properties.hookItems).toEqual([null, {}])
  })

  it('keeps null members of $set, $set_once and $group_set, which clear the property', () => {
    const client = newPostHog()
    client.identify('user-123', { $set: { email: null, name: 'Ada' }, $set_once: { referrer: null } } as any)
    expect(queued(client, '$identify').properties).toMatchObject({
      $set: { email: null, name: 'Ada' },
      $set_once: { referrer: null },
    })
    client.group('company', 'acme', { note: null } as any)
    expect(queued(client, '$groupidentify').properties.$group_set).toEqual({ note: null })
  })

  it('queues deeply nested properties without throwing', () => {
    const client = newPostHog()
    let nested: Record<string, unknown> = { leaf: null }
    for (let i = 0; i < 100_000; i++) {
      nested = { child: nested }
    }
    expect(() => client.capture('Deep', { nested, gone: null })).not.toThrow()
    expect(queued(client, 'Deep').properties).not.toHaveProperty('gone')
    // JSON can't encode this depth either, so keep the shutdown flush from trying.
    client.setPersistedProperty(PostHogPersistedProperty.Queue, [])
  })

  it('keeps an own __proto__ member next to a dropped null member', () => {
    const client = newPostHog()
    client.capture('Parsed', { payload: JSON.parse('{"__proto__": {"x": 1}, "gone": null}') })
    const payload = queued(client, 'Parsed').properties.payload
    expect(Object.getPrototypeOf(payload)).toBe(Object.prototype)
    expect(Object.getOwnPropertyDescriptor(payload, '__proto__')?.value).toEqual({ x: 1 })
    expect(payload).not.toHaveProperty('gone')
  })

  it('queues the event unchanged when a property getter throws during cleanup', () => {
    const client = newPostHog()
    let reads = 0
    const flaky = {
      get value(): number {
        reads++
        if (reads === 1) {
          throw new Error('boom')
        }
        return 1
      },
    }
    expect(() => client.capture('Getter', { flaky: { inner: flaky }, gone: null })).not.toThrow()
    expect(queued(client, 'Getter').properties).toHaveProperty('gone', null)
  })

  it('leaves an object with toJSON as it is', () => {
    const client = newPostHog()
    const custom = { value: null, toJSON: () => 'custom' }
    client.capture('Custom', { custom })
    expect(queued(client, 'Custom').properties.custom).toBe(custom)
  })
})
