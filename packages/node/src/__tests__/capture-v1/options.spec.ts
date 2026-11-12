import type { JsonType } from '@posthog/core'

import { EventMessage, PostHog, PostHogOptions } from '@/entrypoints/index.node'
import { AI_CAPTURE_PATH, ANALYTICS_CAPTURE_PATH, captureEvents } from '../utils'
import { V1WiringHarness } from '../utils/v1-wiring'

const UUID = '0199c3e8-4c7b-7e2e-9f21-2b6d5a1c9e04'
const OPTIONS_ERROR = /^\[PostHog\] options must be an object, got \w+; sending the event without its options$/

describe('per-event capture options', () => {
  vi.useFakeTimers()

  const harness = new V1WiringHarness()
  const makeClient = (options?: PostHogOptions): PostHog => harness.makeClient(options)
  const wireEvents = (path: string = ANALYTICS_CAPTURE_PATH): any[] => captureEvents(harness.fetch, path)

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    harness.useDefaultRouting()
  })

  afterEach(async () => {
    await harness.cleanup()
    vi.clearAllMocks()
  })

  const optionsErrors = (): unknown[][] =>
    (console.error as vi.Mock).mock.calls.filter((call) => OPTIONS_ERROR.test(String(call[0])))

  /** Sends one event through `client` and returns the single wire event it produced on `path`. */
  const sendOne = async (
    send: (client: PostHog) => unknown,
    clientOptions?: PostHogOptions,
    path: string = ANALYTICS_CAPTURE_PATH
  ): Promise<any> => {
    const posthog = makeClient(clientOptions)
    await send(posthog)
    await posthog.flush()
    const events = wireEvents(path)
    expect(events).toHaveLength(1)
    return events[0]
  }

  describe('every capture call sends its options', () => {
    // Values a converting SDK would change: each must arrive exactly as sent.
    const OPTIONS: Record<string, JsonType> = {
      cookieless_mode: 'YES',
      disable_skew_correction: 0,
      product_tour_id: ['tour', 1],
      future_option: { nested: 'no' },
    }

    // Identify-style emitters also get the person default, since OPTIONS leaves it unset.
    const PERSON = { process_person_profile: true }

    it.each<
      [string, (client: PostHog, options: Record<string, JsonType>) => unknown, string, Record<string, JsonType>?]
    >([
      ['capture', (c, options) => c.capture({ distinctId: 'u', event: 'e', options }), ANALYTICS_CAPTURE_PATH],
      [
        'captureImmediate',
        (c, options) => c.captureImmediate({ distinctId: 'u', event: 'e', options }),
        ANALYTICS_CAPTURE_PATH,
      ],
      ['captureAi', (c, options) => c.captureAi({ distinctId: 'u', event: '$ai_span', options }), AI_CAPTURE_PATH],
      [
        'captureAiImmediate',
        (c, options) => c.captureAiImmediate({ distinctId: 'u', event: '$ai_span', options }),
        AI_CAPTURE_PATH,
      ],
      [
        'identify',
        (c, options) => c.identify({ distinctId: 'u', properties: { a: 1 }, options }),
        ANALYTICS_CAPTURE_PATH,
        PERSON,
      ],
      [
        'identifyImmediate',
        (c, options) => c.identifyImmediate({ distinctId: 'u', properties: { a: 1 }, options }),
        ANALYTICS_CAPTURE_PATH,
        PERSON,
      ],
      ['alias', (c, options) => c.alias({ distinctId: 'u', alias: 'anon', options }), ANALYTICS_CAPTURE_PATH, PERSON],
      [
        'aliasImmediate',
        (c, options) => c.aliasImmediate({ distinctId: 'u', alias: 'anon', options }),
        ANALYTICS_CAPTURE_PATH,
        PERSON,
      ],
      [
        'groupIdentify',
        (c, options) => c.groupIdentify({ groupType: 'company', groupKey: 'acme', options }),
        ANALYTICS_CAPTURE_PATH,
        PERSON,
      ],
      [
        'groupIdentifyImmediate',
        (c, options) => c.groupIdentifyImmediate({ groupType: 'company', groupKey: 'acme', options }),
        ANALYTICS_CAPTURE_PATH,
        PERSON,
      ],
      [
        'setPersonProperties',
        (c, options) => c.setPersonProperties({ distinctId: 'u', properties: { plan: 'pro' }, options }),
        ANALYTICS_CAPTURE_PATH,
        PERSON,
      ],
      [
        'unsetPersonProperties',
        (c, options) => c.unsetPersonProperties({ distinctId: 'u', properties: ['plan'], options }),
        ANALYTICS_CAPTURE_PATH,
        PERSON,
      ],
    ])('%s', async (_method, send, path, added = {}) => {
      const event = await sendOne((client) => send(client, OPTIONS), undefined, path)

      expect(event.options).toStrictEqual({ ...OPTIONS, ...added })
    })
  })

  describe('an options value that is not an object', () => {
    it.each<[string, unknown]>([
      ['an array', ['cookieless_mode']],
      ['a string', 'cookieless_mode'],
      ['a number', 1],
      ['a boolean', true],
    ])('logs one error for %s and sends the event without it', async (_label, options) => {
      const event = await sendOne((client) =>
        client.capture({
          distinctId: 'u',
          event: 'e',
          properties: { $cookieless_mode: true, keep: 'me' },
          options: options as Record<string, JsonType>,
        })
      )

      expect(event.options).toStrictEqual({ cookieless_mode: true })
      expect(event.properties.keep).toBe('me')
      expect(event.properties).not.toHaveProperty('$cookieless_mode')
      expect(optionsErrors()).toHaveLength(1)
    })

    it('still applies the personless default', async () => {
      const event = await sendOne((client) =>
        client.capture({ event: 'e', options: 'bad' as unknown as Record<string, JsonType> })
      )

      expect(event.options).toStrictEqual({ process_person_profile: false })
      expect(optionsErrors()).toHaveLength(1)
    })

    it('logs one error when before_send returns one', async () => {
      const event = await sendOne(
        (client) => client.capture({ distinctId: 'u', event: 'e', options: { cookieless_mode: true } }),
        { before_send: (e) => (e ? { ...e, options: 'bad' as unknown as Record<string, JsonType> } : e) }
      )

      expect(event.options).toStrictEqual({})
      expect(optionsErrors()).toHaveLength(1)
    })

    it.each([null, undefined])('treats %s as no options, without logging', async (options) => {
      const event = await sendOne((client) =>
        client.capture({ distinctId: 'u', event: 'e', options: options as unknown as Record<string, JsonType> })
      )

      expect(event.options).toStrictEqual({})
      expect(console.error).not.toHaveBeenCalled()
    })
  })

  describe('personless events', () => {
    it('sets the process_person_profile option, not the legacy property, before before_send', async () => {
      const seen: EventMessage[] = []
      const event = await sendOne((client) => client.capture({ event: 'e', properties: { keep: 'me' } }), {
        before_send: (e) => {
          seen.push(structuredClone(e!))
          return e
        },
      })

      expect(seen[0].options).toStrictEqual({ process_person_profile: false })
      expect(seen[0].properties).not.toHaveProperty('$process_person_profile')
      expect(event.options).toStrictEqual({ process_person_profile: false })
    })

    it.each<[string, Record<string, JsonType>, Record<string, JsonType>]>([
      ['a caller true option wins', { process_person_profile: true }, { process_person_profile: true }],
      ['a caller null option gets the default', { process_person_profile: null }, { process_person_profile: false }],
      [
        'other caller options are kept',
        { cookieless_mode: true },
        { cookieless_mode: true, process_person_profile: false },
      ],
    ])('%s', async (_label, options, expected) => {
      const event = await sendOne((client) => client.capture({ event: 'e', options }))

      expect(event.options).toStrictEqual(expected)
    })

    it('does not set the option when the event has a distinct id', async () => {
      const event = await sendOne((client) => client.capture({ distinctId: 'u', event: 'e' }))

      expect(event.options).toStrictEqual({})
    })
  })

  describe('identify-style events', () => {
    const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    const IDENTIFY_STYLE_EVENTS = [
      '$identify',
      '$create_alias',
      '$merge_dangerously',
      '$groupidentify',
      '$set',
      '$set_once',
    ]

    /** The call's own options and properties; dedicated methods take only options. */
    type Call = { distinctId?: string; options?: Record<string, JsonType>; properties?: Record<string, JsonType> }
    type Emitter = [string, (client: PostHog, call: Call) => unknown, string]

    /** Every layer that can carry `process_person_profile`, as an option or as the legacy property. */
    type Layers = {
      registerOptions?: Record<string, JsonType>
      register?: Record<string, JsonType>
      contextOptions?: Record<string, JsonType>
      contextProperties?: Record<string, JsonType>
      contextDistinctId?: string
    }

    const DEDICATED_EMITTERS: Emitter[] = [
      ['identify', (c, { distinctId = 'u', options }) => c.identify({ distinctId, properties: { a: 1 }, options })],
      [
        'identifyImmediate',
        (c, { distinctId = 'u', options }) => c.identifyImmediate({ distinctId, properties: { a: 1 }, options }),
      ],
      ['alias', (c, { distinctId = 'u', options }) => c.alias({ distinctId, alias: 'anon', options })],
      [
        'aliasImmediate',
        (c, { distinctId = 'u', options }) => c.aliasImmediate({ distinctId, alias: 'anon', options }),
      ],
      [
        'groupIdentify',
        (c, { distinctId, options }) =>
          c.groupIdentify({ groupType: 'company', groupKey: 'acme', distinctId, options }),
      ],
      [
        'groupIdentifyImmediate',
        (c, { distinctId, options }) =>
          c.groupIdentifyImmediate({ groupType: 'company', groupKey: 'acme', distinctId, options }),
      ],
      [
        'setPersonProperties',
        (c, { distinctId = 'u', options }) =>
          c.setPersonProperties({ distinctId, properties: { plan: 'pro' }, options }),
      ],
      [
        'unsetPersonProperties',
        (c, { distinctId = 'u', options }) => c.unsetPersonProperties({ distinctId, properties: ['plan'], options }),
      ],
    ].map(([name, send]) => [name, send, ANALYTICS_CAPTURE_PATH] as Emitter)

    /** Generic capture calls, which also take the legacy `$process_person_profile` property. */
    const PROPERTY_EMITTERS: Emitter[] = [
      ...IDENTIFY_STYLE_EVENTS.flatMap((event): Emitter[] => [
        [`capture ${event}`, (c, call) => c.capture({ distinctId: 'u', ...call, event }), ANALYTICS_CAPTURE_PATH],
        [
          `captureImmediate ${event}`,
          (c, call) => c.captureImmediate({ distinctId: 'u', ...call, event }),
          ANALYTICS_CAPTURE_PATH,
        ],
      ]),
      [
        'captureAi $identify',
        (c, call) => c.captureAi({ distinctId: 'u', ...call, event: '$identify' }),
        AI_CAPTURE_PATH,
      ],
      [
        'captureAiImmediate $identify',
        (c, call) => c.captureAiImmediate({ distinctId: 'u', ...call, event: '$identify' }),
        AI_CAPTURE_PATH,
      ],
    ]

    const EMITTERS: Emitter[] = [...DEDICATED_EMITTERS, ...PROPERTY_EMITTERS]

    const LAYERED_FALSE: Layers = {
      registerOptions: { process_person_profile: false },
      register: { $process_person_profile: false },
      contextOptions: { process_person_profile: false },
      contextProperties: { $process_person_profile: false },
    }
    const LAYERED_TRUE: Layers = {
      registerOptions: { process_person_profile: true },
      register: { $process_person_profile: true },
      contextOptions: { process_person_profile: true },
      contextProperties: { $process_person_profile: true },
    }

    /** Sends one call under `layers` and returns the wire event plus what `before_send` saw. */
    const sendWithLayers = async (
      send: (client: PostHog) => unknown,
      layers: Layers,
      path: string,
      hook: (message: EventMessage) => EventMessage = (message) => message
    ): Promise<{ event: any; hookSaw: EventMessage }> => {
      const seen: EventMessage[] = []
      const event = await sendOne(
        async (client) => {
          if (layers.registerOptions) {
            await client.registerOptions(layers.registerOptions)
          }
          if (layers.register) {
            await client.register(layers.register)
          }
          const context = {
            distinctId: layers.contextDistinctId,
            options: layers.contextOptions,
            properties: layers.contextProperties,
          }
          return client.withContext(context, () => send(client))
        },
        {
          before_send: (message) => {
            seen.push(structuredClone(message!))
            return hook(message!)
          },
        },
        path
      )
      expect(seen).toHaveLength(1)
      return { event, hookSaw: seen[0] }
    }

    describe.each(EMITTERS)('%s', (_name, emit, path) => {
      it.each<[string, Call, Layers, JsonType]>([
        ['defaults to true with no call value and no layer', {}, {}, true],
        ['defaults to true over every layered false', {}, LAYERED_FALSE, true],
        [
          'defaults to true over a layered false option alone',
          {},
          { registerOptions: { process_person_profile: false } },
          true,
        ],
        [
          'defaults to true over a context false option alone',
          {},
          { contextOptions: { process_person_profile: false } },
          true,
        ],
        [
          'defaults to true over a register() false property alone',
          {},
          { register: { $process_person_profile: false } },
          true,
        ],
        [
          'defaults to true over a context false property alone',
          {},
          { contextProperties: { $process_person_profile: false } },
          true,
        ],
        [
          'keeps a call option false over every layered true',
          { options: { process_person_profile: false } },
          LAYERED_TRUE,
          false,
        ],
        [
          'keeps a call option true over every layered false',
          { options: { process_person_profile: true } },
          LAYERED_FALSE,
          true,
        ],
        ['treats a null call option as unset', { options: { process_person_profile: null } }, LAYERED_FALSE, true],
        [
          'defaults to true with a context distinct id',
          { distinctId: '' },
          { ...LAYERED_FALSE, contextDistinctId: 'ctx' },
          true,
        ],
      ])('%s', async (_label, call, layers, expected) => {
        const { event, hookSaw } = await sendWithLayers((client) => emit(client, call), layers, path)

        expect(hookSaw.options!.process_person_profile).toBe(expected)
        expect(hookSaw.properties).not.toHaveProperty('$process_person_profile')
        expect(event.options.process_person_profile).toBe(expected)
        expect(event.properties).not.toHaveProperty('$process_person_profile')
      })
    })

    describe.each(PROPERTY_EMITTERS)('%s with the legacy property', (_name, emit, path) => {
      it.each<[string, Call, Layers, JsonType]>([
        [
          'a call false moves into the option, over every layered true',
          { properties: { $process_person_profile: false } },
          LAYERED_TRUE,
          false,
        ],
        [
          'a call false moves into the option with no layer',
          { properties: { $process_person_profile: false } },
          {},
          false,
        ],
        [
          'a call true moves into the option, over every layered false',
          { properties: { $process_person_profile: true } },
          LAYERED_FALSE,
          true,
        ],
        [
          'a non-boolean call value moves into the option as is',
          { properties: { $process_person_profile: 'yes' } },
          {},
          'yes',
        ],
      ])('%s', async (_label, call, layers, expected) => {
        const { event, hookSaw } = await sendWithLayers((client) => emit(client, call), layers, path)

        expect(hookSaw.options!.process_person_profile).toBe(expected)
        expect(hookSaw.properties).not.toHaveProperty('$process_person_profile')
        expect(event.options.process_person_profile).toBe(expected)
        expect(event.properties).not.toHaveProperty('$process_person_profile')
      })

      it('a call option beats the call legacy property, which is removed before before_send', async () => {
        const { event, hookSaw } = await sendWithLayers(
          (client) =>
            emit(client, { options: { process_person_profile: false }, properties: { $process_person_profile: true } }),
          {},
          path
        )

        expect(hookSaw.properties).not.toHaveProperty('$process_person_profile')
        expect(event.options.process_person_profile).toBe(false)
        expect(event.properties).not.toHaveProperty('$process_person_profile')
      })

      it('treats a null call property as unset, and removes it before before_send', async () => {
        const { event, hookSaw } = await sendWithLayers(
          (client) => emit(client, { properties: { $process_person_profile: null } }),
          LAYERED_FALSE,
          path
        )

        expect(hookSaw.properties).not.toHaveProperty('$process_person_profile')
        expect(hookSaw.options!.process_person_profile).toBe(true)
        expect(event.options.process_person_profile).toBe(true)
        expect(event.properties).not.toHaveProperty('$process_person_profile')
      })
    })

    describe('a layered legacy false', () => {
      const LAYERED_LEGACY_FALSE: [string, Layers][] = [
        ['register()', { register: { $process_person_profile: false } }],
        ['context', { contextProperties: { $process_person_profile: false } }],
      ]
      const dropOptions = ({ options: _options, ...message }: EventMessage): EventMessage => message

      it.each(LAYERED_LEGACY_FALSE)(
        'from %s is removed before before_send sees the option',
        async (_source, layers) => {
          const { event, hookSaw } = await sendWithLayers(
            (client) => client.identify({ distinctId: 'u' }),
            layers,
            ANALYTICS_CAPTURE_PATH
          )

          expect(hookSaw.properties).not.toHaveProperty('$process_person_profile')
          expect(hookSaw.options).toStrictEqual({ process_person_profile: true })
          expect(event.options).toStrictEqual({ process_person_profile: true })
          expect(event.properties).not.toHaveProperty('$process_person_profile')
        }
      )

      it.each(LAYERED_LEGACY_FALSE)(
        'from %s is not sent when before_send drops the options',
        async (_source, layers) => {
          const { event } = await sendWithLayers(
            (client) => client.identify({ distinctId: 'u' }),
            layers,
            ANALYTICS_CAPTURE_PATH,
            dropOptions
          )

          expect(event.options).toStrictEqual({})
          expect(event.properties).not.toHaveProperty('$process_person_profile')
        }
      )

      it.each(LAYERED_LEGACY_FALSE)('from %s stays on other events and is sent', async (_source, layers) => {
        const { event, hookSaw } = await sendWithLayers(
          (client) => client.capture({ distinctId: 'u', event: 'signed_up' }),
          layers,
          ANALYTICS_CAPTURE_PATH,
          dropOptions
        )

        expect(hookSaw.properties!.$process_person_profile).toBe(false)
        expect(event.options).toStrictEqual({ process_person_profile: false })
        expect(event.properties).not.toHaveProperty('$process_person_profile')
      })
      it('stays on other events whose option is set, and the option is sent', async () => {
        const { event, hookSaw } = await sendWithLayers(
          (client) => client.capture({ distinctId: 'u', event: 'signed_up' }),
          { registerOptions: { process_person_profile: true }, register: { $process_person_profile: false } },
          ANALYTICS_CAPTURE_PATH
        )

        expect(hookSaw.properties!.$process_person_profile).toBe(false)
        expect(hookSaw.options).toStrictEqual({ process_person_profile: true })
        expect(event.options).toStrictEqual({ process_person_profile: true })
        expect(event.properties).not.toHaveProperty('$process_person_profile')
      })
    })

    describe('an SDK-generated distinct id', () => {
      it.each<[string, (client: PostHog) => unknown, string]>([
        ['identify', (c) => c.identify({ distinctId: '' }), ANALYTICS_CAPTURE_PATH],
        ['alias', (c) => c.alias({ distinctId: ' ', alias: 'anon' }), ANALYTICS_CAPTURE_PATH],
        [
          'setPersonProperties',
          (c) => c.setPersonProperties({ distinctId: undefined as unknown as string, properties: { plan: 'pro' } }),
          ANALYTICS_CAPTURE_PATH,
        ],
        ...IDENTIFY_STYLE_EVENTS.map((event): [string, (client: PostHog) => unknown, string] => [
          `capture ${event}`,
          (c) => c.capture({ event }),
          ANALYTICS_CAPTURE_PATH,
        ]),
        ['captureAi $identify', (c) => c.captureAi({ event: '$identify' }), AI_CAPTURE_PATH],
      ])('keeps the personless false on %s', async (_name, send, path) => {
        const event = await sendOne(send, undefined, path)

        expect(event.distinct_id).toMatch(UUID_V7)
        expect(event.options).toStrictEqual({ process_person_profile: false })
      })

      it.each([true, false])('takes a call legacy %s, which beats the personless default', async (value) => {
        const event = await sendOne((client) =>
          client.capture({ event: '$identify', properties: { $process_person_profile: value } })
        )

        expect(event.distinct_id).toMatch(UUID_V7)
        expect(event.options).toStrictEqual({ process_person_profile: value })
        expect(event.properties).not.toHaveProperty('$process_person_profile')
      })
    })

    it('before_send sees true and can set false, which is sent', async () => {
      const { event, hookSaw } = await sendWithLayers(
        (client) => client.identify({ distinctId: 'u' }),
        {},
        ANALYTICS_CAPTURE_PATH,
        (message) => ({ ...message, options: { ...message.options, process_person_profile: false } })
      )

      expect(hookSaw.options).toStrictEqual({ process_person_profile: true })
      expect(event.options).toStrictEqual({ process_person_profile: false })
    })

    it.each<[string, Layers]>([
      ['option', { registerOptions: { process_person_profile: false } }],
      ['property', { register: { $process_person_profile: false } }],
    ])('leaves a layered false %s on other events', async (_label, layers) => {
      const { event } = await sendWithLayers(
        (client) => client.capture({ distinctId: 'u', event: 'signed_up' }),
        layers,
        ANALYTICS_CAPTURE_PATH
      )

      expect(event.options).toStrictEqual({ process_person_profile: false })
    })

    it('gives no default to an event before_send renames to $identify', async () => {
      const { event } = await sendWithLayers(
        (client) => client.capture({ distinctId: 'u', event: 'signed_up' }),
        { registerOptions: { process_person_profile: false } },
        ANALYTICS_CAPTURE_PATH,
        (message) => ({ ...message, event: '$identify' })
      )

      expect(event.event).toBe('$identify')
      expect(event.options).toStrictEqual({ process_person_profile: false })
    })

    it('prepareEventMessage returns the default', async () => {
      const client = makeClient()
      await client.registerOptions({ process_person_profile: false })

      const message = await client.prepareEventMessage({ distinctId: 'u', event: '$identify' })

      expect(message.options).toStrictEqual({ process_person_profile: true })
    })
  })

  describe('before_send', () => {
    it('receives copies, so a hook that mutates the event cannot change the caller objects', async () => {
      const options: Record<string, JsonType> = { cookieless_mode: false }
      const properties = {
        $set: { name: 'caller' },
        $set_once: { first: 'caller' },
        $groups: { company: 'caller' },
        plain: 'caller',
        cart: { items: ['caller'] },
        user: { email: 'caller@example.com', name: 'caller' },
      }
      const snapshot = structuredClone({ options, properties })

      const event = await sendOne((client) => client.capture({ distinctId: 'u', event: 'e', properties, options }), {
        before_send: (e) => {
          e!.options!.cookieless_mode = true
          e!.options!.added = 'hook'
          e!.properties!.$set.name = 'hook'
          e!.properties!.$set_once.first = 'hook'
          e!.properties!.$groups.company = 'hook'
          e!.properties!.plain = 'hook'
          e!.properties!.cart.items.push('hook')
          delete e!.properties!.user.email
          return e
        },
      })

      expect({ options, properties }).toStrictEqual(snapshot)
      expect(event.options).toStrictEqual({ cookieless_mode: true, added: 'hook' })
      expect(event.properties).toMatchObject({
        $set: { name: 'hook' },
        $set_once: { first: 'hook' },
        $groups: { company: 'hook' },
        plain: 'hook',
        cart: { items: ['caller', 'hook'] },
        user: { name: 'caller' },
      })
    })

    it('cannot change register() defaults for later events', async () => {
      let first = true
      const posthog = makeClient({
        before_send: (e) => {
          if (first) {
            e!.properties!.app.version = 'hook'
            first = false
          }
          return e
        },
      })
      await posthog.register({ app: { version: 'caller' } })

      posthog.capture({ distinctId: 'u', event: 'first' })
      posthog.capture({ distinctId: 'u', event: 'second' })
      await posthog.flush()

      expect(wireEvents().map((event) => event.properties.app.version)).toEqual(['hook', 'caller'])
    })

    it('gets an options object when the caller passes none', async () => {
      const event = await sendOne((client) => client.capture({ distinctId: 'u', event: 'e' }), {
        before_send: (e) => {
          e!.options!.process_person_profile = false
          return e
        },
      })

      expect(event.options).toStrictEqual({ process_person_profile: false })
      expect(console.error).not.toHaveBeenCalled()
    })

    it.each<[string, (client: PostHog, properties: Record<string, any>) => unknown, string]>([
      [
        'capture',
        (c, properties) => c.capture({ distinctId: 'u', event: 'e', properties, uuid: UUID, timestamp: new Date(0) }),
        ANALYTICS_CAPTURE_PATH,
      ],
      [
        'captureAi',
        (c, properties) =>
          c.captureAi({ distinctId: 'u', event: '$ai_span', properties, uuid: UUID, timestamp: new Date(0) }),
        AI_CAPTURE_PATH,
      ],
    ])('a pass-through hook leaves the %s wire event unchanged', async (_method, send, path) => {
      const properties = () => ({
        nested: { list: [1, { deep: null }], empty_object: {}, empty_array: [] },
        nothing: null,
        when: new Date(0),
      })

      for (const client of [makeClient(), makeClient({ before_send: (e) => e })]) {
        await send(client, properties())
        await client.flush()
      }

      const events = captureEvents(harness.fetch, path)
      expect(events).toHaveLength(2)
      expect(events[1]).toStrictEqual(events[0])
    })

    it.each<[string, (client: PostHog, properties: Record<string, any>) => unknown]>([
      ['identify', (c, properties) => c.identify({ distinctId: 'u', properties: { $set: properties } })],
      ['groupIdentify', (c, properties) => c.groupIdentify({ groupType: 'company', groupKey: 'acme', properties })],
    ])('cannot change the person or group properties the caller passed to %s', async (_method, send) => {
      const callerProperties = { name: 'caller' }

      await sendOne((client) => send(client, callerProperties), {
        before_send: (e) => {
          for (const key of ['$set', '$group_set']) {
            if (e!.properties![key]) {
              e!.properties![key].name = 'hook'
            }
          }
          return e
        },
      })

      expect(callerProperties).toStrictEqual({ name: 'caller' })
    })

    it.each<[string, (e: EventMessage) => EventMessage, Record<string, JsonType>]>([
      [
        'replaced options are sent',
        (e) => ({ ...e, options: { product_tour_id: 'hook' } }),
        { product_tour_id: 'hook' },
      ],
      ['removed options remove the caller options', ({ options: _options, ...e }) => e, {}],
      [
        'an added legacy property fills an unset option',
        (e) => ({ ...e, properties: { ...e.properties, $process_person_profile: false } }),
        { cookieless_mode: true, process_person_profile: false },
      ],
      [
        'an added legacy property does not replace a set option',
        (e) => ({ ...e, properties: { ...e.properties, $cookieless_mode: false } }),
        { cookieless_mode: true },
      ],
    ])('%s', async (_label, hook, expected) => {
      const event = await sendOne(
        (client) => client.capture({ distinctId: 'u', event: 'e', options: { cookieless_mode: true } }),
        { before_send: (e) => hook(e!) }
      )

      expect(event.options).toStrictEqual(expected)
    })

    it('sees a caller $lib, and a hook-set $lib and $lib_version are sent', async () => {
      const seenLib: unknown[] = []
      const event = await sendOne(
        (client) => client.capture({ distinctId: 'u', event: 'e', properties: { $lib: 'caller-lib', keep: 'me' } }),
        {
          before_send: (e) => {
            seenLib.push(e!.properties!.$lib)
            return { ...e!, properties: { ...e!.properties, $lib: 'hook-lib', $lib_version: 'hook-version' } }
          },
        }
      )

      expect(seenLib).toEqual(['caller-lib'])
      expect(event.properties).toMatchObject({ keep: 'me', $lib: 'hook-lib', $lib_version: 'hook-version' })
    })

    it('can add $session_id and $window_id, which move to the top level', async () => {
      const event = await sendOne((client) => client.capture({ distinctId: 'u', event: 'e' }), {
        before_send: (e) => ({ ...e!, properties: { ...e!.properties, $session_id: 's', $window_id: 'w' } }),
      })

      expect(event.session_id).toBe('s')
      expect(event.window_id).toBe('w')
      expect(event.properties).not.toHaveProperty('$session_id')
      expect(event.properties).not.toHaveProperty('$window_id')
    })
  })
})
