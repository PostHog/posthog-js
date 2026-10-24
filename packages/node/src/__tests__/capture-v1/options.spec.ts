import type { JsonType } from '@posthog/core'

import { EventMessage, PostHog, PostHogOptions } from '@/entrypoints/index.node'
import { AI_CAPTURE_PATH, ANALYTICS_CAPTURE_PATH, captureEvents } from '../utils'
import { V1WiringHarness } from '../utils/v1-wiring'

const OPTIONS_ERROR = '[PostHog] options must be an object; sending the event without its options'

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
    (console.error as vi.Mock).mock.calls.filter((call) => call[0] === OPTIONS_ERROR)

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

    it.each<[string, (client: PostHog, options: Record<string, JsonType>) => unknown, string]>([
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
      ],
      [
        'identifyImmediate',
        (c, options) => c.identifyImmediate({ distinctId: 'u', properties: { a: 1 }, options }),
        ANALYTICS_CAPTURE_PATH,
      ],
      ['alias', (c, options) => c.alias({ distinctId: 'u', alias: 'anon', options }), ANALYTICS_CAPTURE_PATH],
      [
        'aliasImmediate',
        (c, options) => c.aliasImmediate({ distinctId: 'u', alias: 'anon', options }),
        ANALYTICS_CAPTURE_PATH,
      ],
      [
        'groupIdentify',
        (c, options) => c.groupIdentify({ groupType: 'company', groupKey: 'acme', options }),
        ANALYTICS_CAPTURE_PATH,
      ],
      [
        'groupIdentifyImmediate',
        (c, options) => c.groupIdentifyImmediate({ groupType: 'company', groupKey: 'acme', options }),
        ANALYTICS_CAPTURE_PATH,
      ],
      [
        'setPersonProperties',
        (c, options) => c.setPersonProperties({ distinctId: 'u', properties: { plan: 'pro' }, options }),
        ANALYTICS_CAPTURE_PATH,
      ],
      [
        'unsetPersonProperties',
        (c, options) => c.unsetPersonProperties({ distinctId: 'u', properties: ['plan'], options }),
        ANALYTICS_CAPTURE_PATH,
      ],
    ])('%s', async (_method, send, path) => {
      const event = await sendOne((client) => send(client, OPTIONS), undefined, path)

      expect(event.options).toStrictEqual(OPTIONS)
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

  describe('before_send', () => {
    it('receives copies, so a hook that mutates the event cannot change the caller objects', async () => {
      const options: Record<string, JsonType> = { cookieless_mode: false }
      const properties = {
        $set: { name: 'caller' },
        $set_once: { first: 'caller' },
        $groups: { company: 'caller' },
        plain: 'caller',
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
      })
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

    it('sees a caller $lib, and neither it nor a hook-set $lib is sent', async () => {
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
      expect(event.properties.keep).toBe('me')
      expect(event.properties).not.toHaveProperty('$lib')
      expect(event.properties).not.toHaveProperty('$lib_version')
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
