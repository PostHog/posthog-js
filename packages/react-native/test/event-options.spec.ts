import { PostHog, type PostHogOptions } from '../src'

type SentEvent = { event: string; options?: Record<string, unknown>; properties: Record<string, unknown> }

describe('per-event options', () => {
  const originalFetch = (globalThis as any).window.fetch
  let sent: { path: string; event: SentEvent }[]
  let posthog: PostHog

  beforeAll(() => {
    vi.useRealTimers()
  })

  afterAll(() => {
    ;(globalThis as any).window.fetch = originalFetch
    vi.useFakeTimers()
  })

  const createClient = async (options: Partial<PostHogOptions> = {}): Promise<PostHog> => {
    const client = new PostHog('test-token', {
      persistence: 'memory',
      flushInterval: 0,
      preloadFeatureFlags: false,
      disableCompression: true,
      captureAiCompression: 'none',
      captureAppLifecycleEvents: false,
      ...options,
    })
    await client.ready()
    return client
  }

  beforeEach(async () => {
    sent = []
    ;(globalThis as any).window.fetch = vi.fn(async (url: string, options: any) => {
      const path = new URL(String(url)).pathname
      if (path.startsWith('/i/v1/')) {
        for (const event of JSON.parse(options.body).batch) {
          sent.push({ path, event })
        }
      }
      return {
        status: 200,
        headers: { get: () => null },
        json: async () => ({ results: {} }),
        text: async () => '{"results":{}}',
      }
    })
    posthog = await createClient()
  })

  afterEach(async () => {
    await posthog.shutdown()
  })

  const sentEvent = (name: string): SentEvent => {
    const match = sent.find(({ event }) => event.event === name)
    if (!match) {
      throw new Error(`"${name}" was not sent; sent: ${sent.map(({ event }) => event.event).join(', ')}`)
    }
    return match.event
  }

  const options = { process_person_profile: false, custom_flag: 7 }

  it.each<[string, string, (client: PostHog) => void | Promise<void>]>([
    ['capture', 'Signed Up', (client) => client.capture('Signed Up', {}, { options })],
    ['screen', '$screen', (client) => client.screen('Home', {}, { options })],
    ['identify', '$identify', (client) => client.identify('user-1', { plan: 'pro' }, { options })],
    [
      'identify with the current distinct id',
      '$set',
      (client) => {
        client.identify('user-1')
        client.identify('user-1', { plan: 'pro' }, { options })
      },
    ],
    [
      'setPersonProperties',
      '$set',
      (client) => client.setPersonProperties({ plan: 'pro' }, undefined, false, { options }),
    ],
    ['alias', '$create_alias', (client) => client.alias('alias-1', { options })],
    ['group', '$groupidentify', (client) => client.group('company', 'acme', { name: 'Acme' }, { options })],
    [
      'groupIdentify',
      '$groupidentify',
      (client) => client.groupIdentify('company', 'acme', { name: 'Acme' }, { options }),
    ],
    [
      'captureException',
      '$exception',
      (client) => client.captureException(new Error('boom'), {}, undefined, { options }),
    ],
  ])('sends the options passed to %s', async (_name, event, call) => {
    await call(posthog)
    await posthog.flush()

    expect(sentEvent(event).options).toEqual(options)
  })

  it('sends the options passed to captureAi on the AI endpoint', async () => {
    posthog.captureAi('$ai_generation', { $ai_model: 'gpt' }, { options })
    await posthog.flush()

    const match = sent.find(({ event }) => event.event === '$ai_generation')
    expect(match?.path).toBe('/i/v1/ai/events')
    expect(match?.event.options).toEqual(options)
  })

  it('lets an option win over its legacy property and removes the property', async () => {
    // Identified, so the SDK sets $process_person_profile: true on the event.
    posthog.identify('user-1')
    posthog.capture('Signed Up', {}, { options: { process_person_profile: false } })
    await posthog.flush()

    const event = sentEvent('Signed Up')
    expect(event.options).toEqual({ process_person_profile: false })
    expect(event.properties).not.toHaveProperty('$process_person_profile')
  })

  it('sends the options the caller passed, not later changes to its object', async () => {
    const callerOptions: Record<string, boolean> = { cookieless_mode: true }
    posthog.capture('Signed Up', {}, { options: callerOptions })
    callerOptions.cookieless_mode = false
    await posthog.flush()

    expect(sentEvent('Signed Up').options).toMatchObject({ cookieless_mode: true })
  })

  it('shows options to before_send and sends the ones it returns', async () => {
    await posthog.shutdown()
    const seen: unknown[] = []
    posthog = await createClient({
      before_send: (event) => {
        seen.push(event?.options)
        return event && { ...event, options: { ...event.options, product_tour_id: 'tour-1' } }
      },
    })

    posthog.capture('Signed Up', {}, { options: { cookieless_mode: true } })
    await posthog.flush()

    expect(seen).toEqual([{ cookieless_mode: true }])
    expect(sentEvent('Signed Up').options).toMatchObject({ cookieless_mode: true, product_tour_id: 'tour-1' })
  })

  it.each<[string, (event: any) => any, Record<string, unknown> | undefined]>([
    [
      'keeps the options when before_send returns a new event without them',
      ({ options: _o, ...event }) => event,
      { cookieless_mode: true },
    ],
    ['clears the options when before_send returns empty options', (event) => ({ ...event, options: {} }), undefined],
  ])('%s', async (_name, hook, expected) => {
    await posthog.shutdown()
    posthog = await createClient({ before_send: hook })

    posthog.capture('Signed Up', {}, { options: { cookieless_mode: true } })
    await posthog.flush()

    expect(sentEvent('Signed Up').options?.cookieless_mode).toEqual(expected?.cookieless_mode)
  })

  it.each<[string, unknown]>([
    ['false', false],
    ['a false string', 'false'],
  ])('sends the same person properties again after a $set whose process_person_profile is %s', async (_n, value) => {
    posthog.identify('user-1')
    posthog.setPersonProperties({ plan: 'pro' }, undefined, false)
    posthog.setPersonProperties({ plan: 'pro' }, undefined, false, {
      options: { process_person_profile: value as boolean },
    })
    posthog.setPersonProperties({ plan: 'pro' }, undefined, false)
    posthog.identify('user-1', { plan: 'pro' })
    await posthog.flush()

    // Identified, so the SDK sends true when the caller passes no option; the last identify is deduplicated.
    const settings = sent
      .filter(({ event }) => event.event === '$set')
      .map(({ event }) => event.options?.process_person_profile)
    expect(settings).toEqual([true, value, true])
  })

  it.each<[string, (event: any, nthSet: number) => any, number]>([
    [
      'sends it again when before_send sets the option to false',
      (event) => ({ ...event, options: { ...event.options, process_person_profile: false } }),
      2,
    ],
    [
      'sends it again when before_send sets the legacy property to false',
      (event) => ({ ...event, properties: { ...event.properties, $process_person_profile: false } }),
      2,
    ],
    [
      'skips it when before_send sets the option to true over a false legacy property',
      (event) => ({
        ...event,
        options: { ...event.options, process_person_profile: true },
        properties: { ...event.properties, $process_person_profile: false },
      }),
      1,
    ],
    ['sends it again when before_send dropped the first one', (event, nthSet) => (nthSet === 1 ? null : event), 1],
  ])('repeated identical $set: %s', async (_name, hook, expectedSets) => {
    await posthog.shutdown()
    let nthSet = 0
    posthog = await createClient({
      before_send: (event) => (event?.event === '$set' ? hook(event, ++nthSet) : event),
    })

    posthog.identify('user-1')
    posthog.setPersonProperties({ plan: 'pro' }, undefined, false)
    posthog.setPersonProperties({ plan: 'pro' }, undefined, false)
    await posthog.flush()

    expect(sent.filter(({ event }) => event.event === '$set')).toHaveLength(expectedSets)
  })

  it('does not record the hash for an $identify sent with process_person_profile false', async () => {
    posthog.identify('user-1', { plan: 'pro' }, { options: { process_person_profile: false } })
    posthog.setPersonProperties({ plan: 'pro' }, undefined, false)
    await posthog.flush()

    expect(sentEvent('$set').properties.$set).toEqual({ plan: 'pro' })
  })

  it('repairs a lone surrogate in an option rather than sending a batch capture rejects', async () => {
    posthog.capture('Signed Up', {}, { options: { custom_flag: 'a\ud800b' } })
    await posthog.flush()

    expect(sentEvent('Signed Up').options).toMatchObject({ custom_flag: 'a\ufffdb' })
  })
})
