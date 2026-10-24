import type { JsonType } from '@posthog/core'

import { EventMessage, PostHog, PostHogOptions } from '@/entrypoints/index.node'
import { FeatureFlagEvaluations } from '@/feature-flag-evaluations'
import { AI_CAPTURE_PATH, ANALYTICS_CAPTURE_PATH, apiImplementationV4, captureEvents } from '../utils'
import { V1WiringHarness } from '../utils/v1-wiring'

const { TRACE_ID, SPAN_ID } = vi.hoisted(() => ({
  TRACE_ID: '0af7651916cd43dd8448eb211c80319c',
  SPAN_ID: 'b7ad6b7169203331',
}))

vi.mock('@/extensions/error-tracking/trace-context', () => ({
  getActiveTraceProperties: async () => ({ $trace_id: TRACE_ID, $span_id: SPAN_ID }),
}))

type Layers = {
  event?: Record<string, JsonType>
  context?: Record<string, JsonType>
  global?: Record<string, JsonType>
}

type Source = keyof Layers

const SOURCES: Source[] = ['event', 'context', 'global']

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** What `before_send` received, copied so later changes cannot alter it. */
type HookView = { event: string; properties: Record<string, any>; options?: Record<string, JsonType> }

/** A `flags` snapshot with one enabled flag `x` set to variant `v`, built without a network call. */
const flagSnapshot = (): FeatureFlagEvaluations =>
  new FeatureFlagEvaluations({
    host: { captureFlagCalledEventIfNeeded: () => {}, logWarning: () => {} },
    distinctId: 'u',
    flags: {
      x: {
        key: 'x',
        enabled: true,
        variant: 'v',
        payload: undefined,
        id: 1,
        version: 1,
        reason: undefined,
        locallyEvaluated: true,
        hasExperiment: undefined,
      },
    },
  })

describe('layered event values', () => {
  vi.useFakeTimers()

  const harness = new V1WiringHarness()
  const wireEvents = (path: string = ANALYTICS_CAPTURE_PATH): any[] => captureEvents(harness.fetch, path)

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    harness.useDefaultRouting()
  })

  afterEach(async () => {
    await harness.cleanup()
    vi.clearAllMocks()
  })

  /** Sends what `send` captures on a new client and returns the one wire event it produced. */
  const sendOne = async (
    send: (client: PostHog) => unknown,
    clientOptions?: PostHogOptions,
    path: string = ANALYTICS_CAPTURE_PATH
  ): Promise<any> => {
    const client = harness.makeClient(clientOptions)
    await send(client)
    await client.flush()
    const events = wireEvents(path)
    expect(events).toHaveLength(1)
    return events[0]
  }

  /** Captures one event with options from the event, a context and `registerOptions()`. */
  const captureWithOptionLayers = (layers: Layers, message: Partial<EventMessage> = {}) =>
    sendOne(async (client) => {
      if (layers.global) {
        await client.registerOptions(layers.global)
      }
      const capture = (): void =>
        client.capture({ distinctId: 'u', event: 'e', ...message, options: layers.event ?? message.options })
      return layers.context ? client.withContext({ options: layers.context }, capture) : capture()
    })

  /**
   * Sends one event whose properties come from the event, a context and `register()`, and returns
   * the wire event plus what `before_send` saw.
   */
  const sendWithPropertyLayers = async (
    layers: Layers,
    message: Partial<EventMessage> = {},
    clientOptions: PostHogOptions = {}
  ): Promise<{ event: any; hookSaw: HookView }> => {
    const seen: HookView[] = []
    const event = await sendOne(
      async (client) => {
        if (layers.global) {
          await client.register(layers.global)
        }
        const capture = (): void =>
          client.capture({ distinctId: 'u', event: 'e', ...message, properties: layers.event ?? message.properties })
        return layers.context ? client.withContext({ properties: layers.context }, capture) : capture()
      },
      {
        ...clientOptions,
        before_send: (hookEvent) => {
          seen.push(
            structuredClone({
              event: hookEvent!.event,
              properties: hookEvent!.properties!,
              options: hookEvent!.options,
            })
          )
          return hookEvent
        },
      }
    )
    expect(seen).toHaveLength(1)
    return { event, hookSaw: seen[0] }
  }

  describe('properties', () => {
    it.each<[string, Layers, JsonType]>([
      [
        'the event beats context and global',
        { event: { k: 'event' }, context: { k: 'context' }, global: { k: 'global' } },
        'event',
      ],
      ['context beats global', { context: { k: 'context' }, global: { k: 'global' } }, 'context'],
      ['global fills alone', { global: { k: 'global' } }, 'global'],
      [
        'undefined on the event counts as unset',
        { event: { k: undefined as any }, context: { k: 'context' } },
        'context',
      ],
      ['null on the event blocks the fill', { event: { k: null }, context: { k: 'context' } }, null],
      ['null in context blocks the global fill', { context: { k: null }, global: { k: 'global' } }, null],
    ])('%s', async (_label, layers, expected) => {
      const { event, hookSaw } = await sendWithPropertyLayers(layers)

      expect(event.properties.k).toStrictEqual(expected)
      expect(hookSaw.properties.k).toStrictEqual(expected)
    })

    describe('nested fill', () => {
      it.each(['$set', '$set_once', '$groups', '$group_set'])('%s fills inner keys one level deep', async (key) => {
        const { event } = await sendWithPropertyLayers({
          event: { [key]: { a: 'event', u: undefined as any } },
          context: { [key]: { a: 'context', b: 'context', u: 'context' } },
          global: { [key]: { b: 'global', c: 'global' } },
        })

        expect(event.properties[key]).toStrictEqual({ a: 'event', b: 'context', c: 'global', u: 'context' })
      })

      it.each<[string, Layers, JsonType]>([
        ['an event $set that is not an object wins whole', { event: { $set: 'x' }, context: { $set: { a: 1 } } }, 'x'],
        ['$unset uses the top-level rule', { event: { $unset: ['a'] }, context: { $unset: ['b'] } }, ['a']],
        [
          'any other object uses the top-level rule',
          { event: { meta: { a: 1 } }, context: { meta: { b: 2 } } },
          { a: 1 },
        ],
      ])('%s', async (_label, layers, expected) => {
        const key = Object.keys(layers.event!)[0]
        const { event } = await sendWithPropertyLayers(layers)

        expect(event.properties[key]).toStrictEqual(expected)
      })

      it('a filled default never changes the registered object', async () => {
        const registered = { a: 'global' }
        await sendWithPropertyLayers({ event: { $set: { b: 'event' } }, global: { $set: registered } })

        expect(registered).toStrictEqual({ a: 'global' })
      })
    })

    it('typed groups merge over a $groups property key by key, then context fills', async () => {
      const { event, hookSaw } = await sendWithPropertyLayers(
        { event: { $groups: { company: 'property', org: 'property' } }, context: { $groups: { project: 'context' } } },
        { groups: { company: 'typed' } }
      )

      const expected = { company: 'typed', org: 'property', project: 'context' }
      expect(event.properties.$groups).toStrictEqual(expected)
      expect(hookSaw.properties.$groups).toStrictEqual(expected)
    })

    describe('SDK values', () => {
      it('fill $is_server and $geoip_disable when no layer sets them, before before_send', async () => {
        const { event, hookSaw } = await sendWithPropertyLayers({})

        expect(event.properties).toStrictEqual({ $is_server: true, $geoip_disable: true })
        expect(hookSaw.properties).toStrictEqual({ $is_server: true, $geoip_disable: true })
      })

      it.each<[string, PostHogOptions, string]>([
        ['isServer: false', { isServer: false }, '$is_server'],
        ['disableGeoip: false', { disableGeoip: false }, '$geoip_disable'],
      ])('%s leaves the value out', async (_label, clientOptions, key) => {
        const { event, hookSaw } = await sendWithPropertyLayers({}, {}, clientOptions)

        expect(event.properties).not.toHaveProperty(key)
        expect(hookSaw.properties).not.toHaveProperty(key)
      })

      const userValueCases = ['$is_server', '$geoip_disable'].flatMap((key) =>
        SOURCES.map((source): [string, Source] => [key, source])
      )
      it.each(userValueCases)('%s set in the %s layer beats the SDK value', async (key, source) => {
        const { event, hookSaw } = await sendWithPropertyLayers({ [source]: { [key]: false } })

        expect(event.properties[key]).toBe(false)
        expect(hookSaw.properties[key]).toBe(false)
      })

      it.each<[string, Layers, boolean]>([
        ['beats context and global', { context: { $geoip_disable: false }, global: { $geoip_disable: false } }, true],
        ["loses to the event's own property", { event: { $geoip_disable: false } }, false],
      ])('a per-call disableGeoip %s', async (_label, layers, expected) => {
        const { event } = await sendWithPropertyLayers(layers, { disableGeoip: true }, { disableGeoip: false })

        expect(event.properties.$geoip_disable).toBe(expected)
      })

      describe('feature flag properties from a flags snapshot', () => {
        it('fill before before_send', async () => {
          const { event, hookSaw } = await sendWithPropertyLayers({}, { flags: flagSnapshot() })

          for (const properties of [event.properties, hookSaw.properties]) {
            expect(properties['$feature/x']).toBe('v')
            expect(properties.$active_feature_flags).toStrictEqual(['x'])
          }
        })

        it.each(SOURCES)('lose to the %s layer', async (source) => {
          const userValues = { '$feature/x': 'mine', $active_feature_flags: ['mine'] }
          const { event, hookSaw } = await sendWithPropertyLayers({ [source]: userValues }, { flags: flagSnapshot() })

          expect(event.properties).toMatchObject(userValues)
          expect(hookSaw.properties).toMatchObject(userValues)
        })
      })

      describe('trace ids on $exception', () => {
        it('fill as a pair before before_send', async () => {
          const { event, hookSaw } = await sendWithPropertyLayers({}, { event: '$exception' })

          for (const properties of [event.properties, hookSaw.properties]) {
            expect(properties).toMatchObject({ $trace_id: TRACE_ID, $span_id: SPAN_ID })
          }
        })

        const pairCases = ['$trace_id', '$span_id'].flatMap((key) =>
          SOURCES.map((source): [string, Source] => [key, source])
        )
        it.each(pairCases)('a %s in the %s layer stops both', async (key, source) => {
          const { event } = await sendWithPropertyLayers({ [source]: { [key]: 'mine' } }, { event: '$exception' })

          const otherKey = key === '$trace_id' ? '$span_id' : '$trace_id'
          expect(event.properties[key]).toBe('mine')
          expect(event.properties).not.toHaveProperty(otherKey)
        })

        it('are not added to other events', async () => {
          const { event } = await sendWithPropertyLayers({})

          expect(event.properties).not.toHaveProperty('$trace_id')
        })
      })

      describe('$release_id on $exception', () => {
        beforeEach(() => {
          vi.stubEnv('POSTHOG_RELEASE_ID', 'injected-release')
        })

        afterEach(() => {
          vi.unstubAllEnvs()
        })

        it('fills before before_send', async () => {
          const { event, hookSaw } = await sendWithPropertyLayers({}, { event: '$exception' })

          expect(event.properties.$release_id).toBe('injected-release')
          expect(hookSaw.properties.$release_id).toBe('injected-release')
        })

        it.each(SOURCES)('loses to the %s layer', async (source) => {
          const { event } = await sendWithPropertyLayers({ [source]: { $release_id: 'mine' } }, { event: '$exception' })

          expect(event.properties.$release_id).toBe('mine')
        })

        it('loses to captureException properties', async () => {
          const event = await sendOne((client) =>
            client.captureException(new Error('boom'), 'u', { $release_id: 'mine' })
          )

          expect(event.properties.$release_id).toBe('mine')
        })
      })
    })

    it('before_send sees the $bot_pageview rename and has the final say', async () => {
      const seen: HookView[] = []
      const event = await sendOne(
        (client) =>
          client.capture({
            distinctId: 'u',
            event: '$pageview',
            properties: { $raw_user_agent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
          }),
        {
          __preview_capture_bot_pageviews: true,
          before_send: (hookEvent) => {
            seen.push(structuredClone({ event: hookEvent!.event, properties: hookEvent!.properties! }))
            delete hookEvent!.properties!.$browser_type
            return hookEvent
          },
        }
      )

      expect(seen[0].event).toBe('$bot_pageview')
      expect(seen[0].properties.$browser_type).toBe('bot')
      expect(event.event).toBe('$bot_pageview')
      expect(event.properties).not.toHaveProperty('$browser_type')
    })

    it('before_send can remove every SDK value and nothing re-adds it', async () => {
      const event = await sendOne(
        (client) => client.capture({ distinctId: 'u', event: '$exception', flags: flagSnapshot() }),
        {
          before_send: (hookEvent) => {
            hookEvent!.properties = {}
            hookEvent!.options = {}
            return hookEvent
          },
        }
      )

      expect(event.properties).toStrictEqual({})
      expect(event.options).toStrictEqual({})
    })

    it('a minimal $feature_flag_called event keeps the properties that set options and session fields', async () => {
      harness.fetch.mockImplementation(
        apiImplementationV4({
          flags: {
            'test-flag': {
              key: 'test-flag',
              enabled: true,
              variant: undefined,
              reason: { code: 'condition_match', condition_index: 0, description: 'Matched' },
              metadata: { id: 1, version: 1, payload: undefined, has_experiment: false },
            },
          },
          errorsWhileComputingFlags: false,
          minimalFlagCalledEvents: true,
        } as any)
      )
      const event = await sendOne(async (client) => {
        await client.register({
          $cookieless_mode: true,
          $ignore_sent_at: true,
          $product_tour_id: 'tour',
          $process_person_profile: false,
          $window_id: 'window',
          dropped: 'yes',
        })
        await client.registerOptions({ future_option: 1 })
        await client.withContext({ sessionId: 'session' }, () => client.getFeatureFlag('test-flag', 'u'))
      })

      expect(event.event).toBe('$feature_flag_called')
      expect(event.options).toStrictEqual({
        cookieless_mode: true,
        disable_skew_correction: true,
        product_tour_id: 'tour',
        process_person_profile: false,
        future_option: 1,
      })
      expect(event.session_id).toBe('session')
      expect(event.window_id).toBe('window')
      expect(event.properties).not.toHaveProperty('dropped')
    })
  })

  describe('options', () => {
    it.each<[string, Layers, JsonType]>([
      [
        'the event beats context and global',
        { event: { k: 'event' }, context: { k: 'context' }, global: { k: 'global' } },
        'event',
      ],
      ['context beats global', { context: { k: 'context' }, global: { k: 'global' } }, 'context'],
      ['global fills alone', { global: { k: 'global' } }, 'global'],
      ['a null event option is filled', { event: { k: null }, context: { k: 'context' } }, 'context'],
      ['a null context option is filled', { context: { k: null }, global: { k: 'global' } }, 'global'],
      ['a null option with nothing below stays null', { event: { k: null } }, null],
    ])('%s', async (_label, layers, expected) => {
      const event = await captureWithOptionLayers(layers)

      expect(event.options).toStrictEqual({ k: expected })
    })

    it.each<[string, Layers, JsonType]>([
      ['the personless option fills last', {}, false],
      ['a context option beats the personless option', { context: { process_person_profile: true } }, true],
      ['a global option beats the personless option', { global: { process_person_profile: true } }, true],
    ])('%s', async (_label, layers, expected) => {
      const event = await captureWithOptionLayers(layers, { distinctId: undefined })

      expect(event.options.process_person_profile).toBe(expected)
    })

    it('a global option beats a legacy property on the event', async () => {
      const event = await captureWithOptionLayers(
        { global: { cookieless_mode: true } },
        { properties: { $cookieless_mode: false } }
      )

      expect(event.options).toStrictEqual({ cookieless_mode: true })
      expect(event.properties).not.toHaveProperty('$cookieless_mode')
    })

    it('before_send sees the filled options and can remove one', async () => {
      const seen: EventMessage[] = []
      const event = await sendOne(
        async (client) => {
          await client.registerOptions({ cookieless_mode: true, product_tour_id: 'tour' })
          client.capture({ distinctId: 'u', event: 'e' })
        },
        {
          before_send: (message) => {
            seen.push(structuredClone(message))
            delete message!.options!.product_tour_id
            return message
          },
        }
      )

      expect(seen[0].options).toStrictEqual({ cookieless_mode: true, product_tour_id: 'tour' })
      expect(event.options).toStrictEqual({ cookieless_mode: true })
    })

    describe('registerOptions', () => {
      it('merges calls, and unregisterOptions removes one key', async () => {
        const event = await sendOne(async (client) => {
          await expect(client.registerOptions({ a: 1, b: 2 })).resolves.toBeUndefined()
          await client.registerOptions({ b: 3, c: 4 })
          await expect(client.unregisterOptions('a')).resolves.toBeUndefined()
          client.capture({ distinctId: 'u', event: 'e' })
        })

        expect(event.options).toStrictEqual({ b: 3, c: 4 })
      })

      it('an event keeps the options it read when it was captured', async () => {
        const event = await sendOne(async (client) => {
          await client.registerOptions({ a: 1 })
          client.capture({ distinctId: 'u', event: 'e' })
          await client.registerOptions({ a: 2 })
          await client.unregisterOptions('a')
        })

        expect(event.options).toStrictEqual({ a: 1 })
      })

      it.each<[string, unknown]>([
        ['an array', ['a']],
        ['a string', 'a'],
        ['a number', 1],
        ['null', null],
      ])('logs one error for %s and ignores it', async (_label, value) => {
        const event = await sendOne(async (client) => {
          await client.registerOptions({ kept: true })
          await client.registerOptions(value as Record<string, JsonType>)
          client.capture({ distinctId: 'u', event: 'e' })
        })

        expect(event.options).toStrictEqual({ kept: true })
        expect(console.error).toHaveBeenCalledTimes(1)
        expect(console.error).toHaveBeenCalledWith('[PostHog] registerOptions takes an object; ignoring the value')
      })
    })

    describe('context options', () => {
      it.each<[string, boolean, Record<string, JsonType>]>([
        ['a nested context inherits and overrides its parent', false, { a: 'outer', b: 'inner', c: 'inner' }],
        ['a fresh context drops its parent', true, { b: 'inner', c: 'inner' }],
      ])('%s', async (_label, fresh, expected) => {
        const event = await sendOne((client) =>
          client.withContext({ options: { a: 'outer', b: 'outer' } }, () =>
            client.withContext(
              { options: { b: 'inner', c: 'inner' } },
              () => client.capture({ distinctId: 'u', event: 'e' }),
              { fresh }
            )
          )
        )

        expect(event.options).toStrictEqual(expected)
      })

      it('enterContext sets options', async () => {
        const event = await sendOne((client) =>
          client.withContext({}, () => {
            client.enterContext({ options: { a: 1 } })
            client.capture({ distinctId: 'u', event: 'e' })
          })
        )

        expect(event.options).toStrictEqual({ a: 1 })
      })
    })
  })

  describe('identity', () => {
    /** Sends one event from `send`, inside a context when `context` is given. */
    const sendInContext = (
      send: (client: PostHog) => unknown,
      context?: { distinctId?: string; sessionId?: string; properties?: Record<string, JsonType> }
    ): Promise<any> => sendOne((client) => (context ? client.withContext(context, () => send(client)) : send(client)))

    const BLANK_IDS: [string, string | undefined][] = [
      ['missing', undefined],
      ['empty', ''],
      ['whitespace', ' \t '],
    ]

    it.each(BLANK_IDS)('a %s distinct id takes the context id', async (_label, distinctId) => {
      const event = await sendInContext((client) => client.capture({ distinctId, event: 'e' }), { distinctId: 'ctx' })

      expect(event.distinct_id).toBe('ctx')
      expect(event.options).toStrictEqual({})
    })

    it.each(BLANK_IDS)('a %s distinct id with no context id becomes a personless v7 id', async (_label, distinctId) => {
      const event = await sendInContext((client) => client.capture({ distinctId, event: 'e' }), { distinctId: '  ' })

      expect(event.distinct_id).toMatch(UUID_V7)
      expect(event.options).toStrictEqual({ process_person_profile: false })
    })

    it("the caller's process_person_profile beats the personless option", async () => {
      const event = await sendInContext((client) =>
        client.capture({ event: 'e', options: { process_person_profile: true } })
      )

      expect(event.distinct_id).toMatch(UUID_V7)
      expect(event.options).toStrictEqual({ process_person_profile: true })
    })

    it.each<[string, Record<string, JsonType>, string | undefined]>([
      ['fills an unset $session_id', {}, 'ctx-session'],
      ["loses to the event's own $session_id", { $session_id: 'event-session' }, 'event-session'],
      ['loses to a null $session_id', { $session_id: null }, undefined],
    ])('the context session %s', async (_label, properties, expected) => {
      const event = await sendInContext((client) => client.capture({ distinctId: 'u', event: 'e', properties }), {
        sessionId: 'ctx-session',
      })

      expect(event.session_id).toBe(expected)
    })

    describe('groupIdentify', () => {
      it.each<[string, string | undefined, string | undefined, string]>([
        ["uses the caller's id", 'caller', 'ctx', 'caller'],
        ['uses the context id when the caller gives a blank one', '  ', 'ctx', 'ctx'],
        ['falls back to $<type>_<key>', undefined, undefined, '$company_acme'],
      ])('%s', async (_label, distinctId, contextId, expected) => {
        const event = await sendInContext(
          (client) => client.groupIdentify({ groupType: 'company', groupKey: 'acme', distinctId }),
          { distinctId: contextId, sessionId: 'ctx-session' }
        )

        expect(event.distinct_id).toBe(expected)
        expect(event.options).toStrictEqual({})
        expect(event).not.toHaveProperty('session_id')
      })
    })

    describe('alias', () => {
      it('never takes its target from context or register()', async () => {
        const event = await sendOne(async (client) => {
          await client.register({ alias: 'global-target' })
          client.withContext({ properties: { alias: 'context-target' } }, () =>
            client.alias({ distinctId: 'u', alias: undefined as unknown as string })
          )
        })

        expect(event.properties).not.toHaveProperty('alias')
      })

      it('takes its own distinct id from context and reports it in properties', async () => {
        const event = await sendInContext((client) => client.alias({ distinctId: '', alias: 'anon' }), {
          distinctId: 'ctx',
          sessionId: 'ctx-session',
        })

        expect(event.distinct_id).toBe('ctx')
        expect(event.properties).toMatchObject({ distinct_id: 'ctx', alias: 'anon' })
        expect(event.session_id).toBe('ctx-session')
      })
    })

    describe('identify', () => {
      it('puts context properties in the event properties, not in $set, and sends no empty $set_once', async () => {
        const event = await sendInContext(
          (client) => client.identify({ distinctId: 'u', properties: { plan: 'pro' } }),
          { properties: { region: 'eu' } }
        )

        expect(event.properties.$set).toStrictEqual({ plan: 'pro' })
        expect(event.properties.region).toBe('eu')
        expect(event.properties).not.toHaveProperty('$set_once')
      })

      it('sends only $set and $set_once when the caller gives $set', async () => {
        const event = await sendInContext((client) =>
          client.identify({ distinctId: 'u', properties: { $set: { a: 1 }, $set_once: { b: 2 }, other: 3 } })
        )

        expect(event.properties).toMatchObject({ $set: { a: 1 }, $set_once: { b: 2 } })
        expect(event.properties).not.toHaveProperty('other')
      })
    })
  })

  describe('layers reach every message type', () => {
    it.each<[string, (client: PostHog) => unknown, string]>([
      ['capture', (c) => c.capture({ distinctId: 'u', event: 'e' }), ANALYTICS_CAPTURE_PATH],
      ['captureAi', (c) => c.captureAi({ distinctId: 'u', event: '$ai_span' }), AI_CAPTURE_PATH],
      ['captureException', (c) => c.captureException(new Error('boom'), 'u'), ANALYTICS_CAPTURE_PATH],
      ['identify', (c) => c.identify({ distinctId: 'u', properties: { a: 1 } }), ANALYTICS_CAPTURE_PATH],
      ['identifyImmediate', (c) => c.identifyImmediate({ distinctId: 'u' }), ANALYTICS_CAPTURE_PATH],
      ['alias', (c) => c.alias({ distinctId: 'u', alias: 'anon' }), ANALYTICS_CAPTURE_PATH],
      ['aliasImmediate', (c) => c.aliasImmediate({ distinctId: 'u', alias: 'anon' }), ANALYTICS_CAPTURE_PATH],
      ['groupIdentify', (c) => c.groupIdentify({ groupType: 'company', groupKey: 'acme' }), ANALYTICS_CAPTURE_PATH],
      [
        'setPersonProperties',
        (c) => c.setPersonProperties({ distinctId: 'u', properties: { a: 1 } }),
        ANALYTICS_CAPTURE_PATH,
      ],
      [
        'unsetPersonProperties',
        (c) => c.unsetPersonProperties({ distinctId: 'u', properties: ['a'] }),
        ANALYTICS_CAPTURE_PATH,
      ],
    ])('%s', async (_method, send, path) => {
      const event = await sendOne(
        async (client) => {
          await client.register({ global_prop: 'g' })
          await client.registerOptions({ global_option: 'g' })
          return client.withContext({ properties: { context_prop: 'c' }, options: { context_option: 'c' } }, () =>
            send(client)
          )
        },
        undefined,
        path
      )

      expect(event.properties).toMatchObject({ global_prop: 'g', context_prop: 'c', $is_server: true })
      expect(event.options).toMatchObject({ global_option: 'g', context_option: 'c' })
    })
  })

  describe('captureException properties', () => {
    it.each([
      '$exception_source',
      '$debug_images',
      '$exception_types',
      '$exception_values',
      '$exception_sources',
      '$exception_functions',
      '$exception_fingerprint_version',
      '$exception_fingerprint_record',
      '$exception_issue_id',
      '$exception_release',
      '$cymbal_errors',
    ])('cannot set %s', async (key) => {
      const event = await sendOne((client) => client.captureException(new Error('boom'), 'u', { [key]: 'caller' }))

      expect(event.properties).not.toHaveProperty(key)
    })

    it('cannot replace $exception_list or $exception_level, and keep other properties', async () => {
      const event = await sendOne((client) =>
        client.captureException(new Error('boom'), 'u', {
          $exception_list: 'caller',
          $exception_level: 'fatal',
          $exception_fingerprint: 'custom',
          custom: 1,
        })
      )

      expect(event.properties.$exception_list[0]).toMatchObject({ type: 'Error', value: 'boom' })
      expect(event.properties.$exception_level).toBe('error')
      expect(event.properties).toMatchObject({ $exception_fingerprint: 'custom', custom: 1 })
    })
  })
})
