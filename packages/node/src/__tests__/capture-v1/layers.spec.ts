import type { JsonType } from '@posthog/core'

import { EventMessage, PostHog, PostHogOptions } from '@/entrypoints/index.node'
import { ANALYTICS_CAPTURE_PATH, captureEvents } from '../utils'
import { V1WiringHarness } from '../utils/v1-wiring'

type Layers = {
  event?: Record<string, JsonType>
  context?: Record<string, JsonType>
  global?: Record<string, JsonType>
}

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
    sendOne((client) => {
      if (layers.global) {
        client.registerOptions(layers.global)
      }
      const capture = (): void =>
        client.capture({ distinctId: 'u', event: 'e', ...message, options: layers.event ?? message.options })
      return layers.context ? client.withContext({ options: layers.context }, capture) : capture()
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
        (client) => {
          client.registerOptions({ cookieless_mode: true, product_tour_id: 'tour' })
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
        const event = await sendOne((client) => {
          client.registerOptions({ a: 1, b: 2 })
          client.registerOptions({ b: 3, c: 4 })
          client.unregisterOptions('a')
          client.capture({ distinctId: 'u', event: 'e' })
        })

        expect(event.options).toStrictEqual({ b: 3, c: 4 })
      })

      it('an event keeps the options it read when it was captured', async () => {
        const event = await sendOne((client) => {
          client.registerOptions({ a: 1 })
          client.capture({ distinctId: 'u', event: 'e' })
          client.registerOptions({ a: 2 })
          client.unregisterOptions('a')
        })

        expect(event.options).toStrictEqual({ a: 1 })
      })

      it.each<[string, unknown]>([
        ['an array', ['a']],
        ['a string', 'a'],
        ['a number', 1],
        ['null', null],
      ])('logs one error for %s and ignores it', async (_label, value) => {
        const event = await sendOne((client) => {
          client.registerOptions({ kept: true })
          client.registerOptions(value as Record<string, JsonType>)
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
})
