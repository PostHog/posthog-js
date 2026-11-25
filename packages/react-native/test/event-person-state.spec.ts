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
    for (const event of ['$identify', '$create_alias', '$merge_dangerously', '$groupidentify', '$set', '$set_once']) {
      client.capture(event, { distinct_id: 'user-123' })
      expect(queued(client, event).properties.$process_person_profile).toBe(true)
    }
  })

  it('lets a caller $process_person_profile win on identity events captured directly', () => {
    const client = newPostHog({ personProfiles: 'always' })
    client.capture('$identify', { distinct_id: 'user-123', $process_person_profile: false })
    expect(queued(client, '$identify').properties.$process_person_profile).toBe(false)
  })

  it('treats a null caller $process_person_profile as unset', () => {
    const client = newPostHog({ personProfiles: 'never' })
    client.capture('Signed Up', { $process_person_profile: null })
    expect(queued(client, 'Signed Up').properties.$process_person_profile).toBe(false)
  })

  it('sends no $is_identified when the caller or a registered value is null or undefined', () => {
    const client = newPostHog()
    client.identify('user-123')
    client.capture('Signed Up', { $is_identified: null })
    client.capture('Signed In', { $is_identified: undefined })
    client.register({ $is_identified: null })
    client.capture('Viewed Dashboard')
    for (const event of ['Signed Up', 'Signed In', 'Viewed Dashboard']) {
      expect(queued(client, event).properties).not.toHaveProperty('$is_identified')
    }
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

  it('queues the event when a property getter throws during cleanup', () => {
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
    expect(reads).toBe(1)
    expect(queued(client, 'Getter').properties.flaky.inner).toBe(flaky)
    expect(queued(client, 'Getter').properties).toHaveProperty('gone', null)
  })

  it('cleans event properties once during capture', () => {
    const client = newPostHog()
    let reads = 0
    const tracked = {
      get value(): number {
        reads++
        return 1
      },
    }
    client.capture('Tracked', { tracked, gone: null })
    expect(reads).toBe(1)
    expect(queued(client, 'Tracked').properties).not.toHaveProperty('gone')
  })

  it('keeps a top-level null $set, $set_once and $group_set as given', () => {
    const client = newPostHog()
    client.capture('Reserved', { $set: null, $set_once: null, $group_set: null, gone: null })
    const properties = queued(client, 'Reserved').properties
    expect(properties).toMatchObject({ $set: null, $set_once: null, $group_set: null })
    expect(properties).not.toHaveProperty('gone')
  })

  it('drops null members from fatal exceptions handed off to native', () => {
    const client = newPostHog()
    const uuid = '01950000-0000-7000-8000-000000000099'
    let handedOff: any
    ;(client as any)._captureFatalAndChooseOwner(
      uuid,
      (payload: any) => {
        handedOff = payload
        return async () => {}
      },
      () =>
        client.capture(
          '$exception',
          { gone: null, nested: { drop: null }, items: [null, { drop: null }], $set: { email: null } } as any,
          { uuid, _originatedFromCaptureException: true } as any
        )
    )
    expect(handedOff.properties).not.toHaveProperty('gone')
    expect(handedOff.properties).toMatchObject({ nested: {}, items: [null, {}], $set: { email: null } })
    expect(queued(client, '$exception')).toBeUndefined()
  })

  it('leaves an object with toJSON as it is', () => {
    const client = newPostHog()
    const custom = { value: null, toJSON: () => 'custom' }
    client.capture('Custom', { custom })
    expect(queued(client, 'Custom').properties.custom).toBe(custom)
  })

  it('drops null members from events restored from a 4.x queue when sending them', async () => {
    const store: Record<string, string> = {
      '.posthog-rn.json': JSON.stringify({
        version: 'v1',
        content: {
          [PostHogPersistedProperty.Queue]: [
            {
              message: {
                event: 'Restored',
                distinct_id: 'user-123',
                uuid: '01950000-0000-7000-8000-000000000001',
                timestamp: '2026-01-01T00:00:00.000Z',
                properties: {
                  test: null,
                  nested: { drop: null },
                  items: ['1', null, { drop: null }],
                  $set: { email: null },
                },
              },
            },
          ],
        },
      }),
    }
    const customStorage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value
      },
    }
    const client = newPostHog({ persistence: 'file', customStorage, disableCompression: true })
    await client.ready()
    await client.flush()

    const batchCall = (global.fetch as any).mock.calls.find(([url]: [string]) =>
      /\/batch\/|\/i\/v1\/analytics\/events/.test(String(url))
    )
    const sent = JSON.parse(batchCall[1].body).batch[0].properties
    expect(sent).not.toHaveProperty('test')
    expect(sent).toMatchObject({ nested: {}, items: ['1', null, {}], $set: { email: null } })
  })
})
