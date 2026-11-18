import { PostHog } from 'posthog-node'

import {
  captureAiEvent,
  captureAiEventImmediate,
  eventOptionFields,
  isFullAiCaptureEnabled,
  usesAiLane,
} from '../src/captureAiEvent'

const makeClient = (overrides: Record<string, unknown> = {}): any => ({
  capture: vi.fn(),
  captureImmediate: vi.fn().mockResolvedValue(undefined),
  captureAi: vi.fn(),
  captureAiImmediate: vi.fn().mockResolvedValue(undefined),
  ...overrides,
})

describe('captureAiEvent routing', () => {
  const event = { distinctId: 'u', event: '$ai_generation', properties: {} }

  it('uses capture() by default (no opt-in)', () => {
    const client = makeClient()
    captureAiEvent(client, event)
    expect(client.capture).toHaveBeenCalledWith(event)
    expect(client.captureAi).not.toHaveBeenCalled()
  })

  it('routes to captureAi when enableFullAiCapture is true', () => {
    const client = makeClient({ enableFullAiCapture: true })
    captureAiEvent(client, event)
    expect(client.captureAi).toHaveBeenCalledWith(event)
    expect(client.capture).not.toHaveBeenCalled()
  })

  it('requires the flag to be strictly true (truthy mock attributes stay opted out)', () => {
    const client = makeClient({ enableFullAiCapture: vi.fn() })
    captureAiEvent(client, event)
    expect(client.capture).toHaveBeenCalledWith(event)
    expect(client.captureAi).not.toHaveBeenCalled()
  })

  it('falls back to capture() when an opted-in client lacks a callable captureAi', () => {
    const client = makeClient({ enableFullAiCapture: true, captureAi: undefined })
    captureAiEvent(client, event)
    expect(client.capture).toHaveBeenCalledWith(event)
  })

  // posthog-node 6 is told apart by `registerOptions`, never by `getLibraryVersion()`, which
  // `@posthog/mcp` (0.23.0) and subclasses override.
  it.each([
    ['posthog-node 6', true, { registerOptions: vi.fn(), getLibraryVersion: () => '6.0.0' }],
    [
      'posthog-node 6 reporting a wrapper version',
      true,
      { registerOptions: vi.fn(), getLibraryVersion: () => '0.23.0' },
    ],
    ['posthog-node 5', false, { getLibraryVersion: () => '5.61.1' }],
    ['posthog-node 5 reporting version 6', false, { getLibraryVersion: () => '6.0.0' }],
    ['a client whose registerOptions is not a function', false, { registerOptions: true }],
  ])('%s uses the AI lane without the opt-in: %s', async (_label, aiLane, overrides) => {
    const client = makeClient(overrides)
    captureAiEvent(client, event)
    await captureAiEventImmediate(client, event)
    expect(client.captureAi).toHaveBeenCalledTimes(aiLane ? 1 : 0)
    expect(client.captureAiImmediate).toHaveBeenCalledTimes(aiLane ? 1 : 0)
    expect(client.capture).toHaveBeenCalledTimes(aiLane ? 0 : 1)
    expect(client.captureImmediate).toHaveBeenCalledTimes(aiLane ? 0 : 1)
  })

  it('picks the AI lane for a real posthog-node 6 client whose version was overridden', async () => {
    const client = new PostHog('phc_test', { host: 'http://localhost', disabled: true })
    try {
      client.getLibraryVersion = () => '0.23.0'
      expect(usesAiLane(client)).toBe(true)
    } finally {
      await client.shutdown()
    }
  })

  it('immediate variant mirrors the routing', async () => {
    const optedIn = makeClient({ enableFullAiCapture: true })
    await captureAiEventImmediate(optedIn, event)
    expect(optedIn.captureAiImmediate).toHaveBeenCalledWith(event)
    expect(optedIn.captureImmediate).not.toHaveBeenCalled()

    const fallback = makeClient({ enableFullAiCapture: true, captureAiImmediate: undefined })
    await captureAiEventImmediate(fallback, event)
    expect(fallback.captureImmediate).toHaveBeenCalledWith(event)
  })
})

describe('isFullAiCaptureEnabled', () => {
  it('is true only for a strict true flag', () => {
    expect(isFullAiCaptureEnabled({ enableFullAiCapture: true })).toBe(true)
    expect(isFullAiCaptureEnabled({ enableFullAiCapture: 1 } as any)).toBe(false)
    expect(isFullAiCaptureEnabled({})).toBe(false)
    expect(isFullAiCaptureEnabled(undefined)).toBe(false)
  })
})

describe('eventOptionFields', () => {
  const node5 = {}
  const node6 = { registerOptions: vi.fn() }
  const properties = { $ai_trace_id: 'trace', feature: 'chat' }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('passes options through unchanged on posthog-node 6 and writes no option property', () => {
    const options = {
      process_person_profile: true,
      cookieless_mode: true,
      disable_skew_correction: true,
      product_tour_id: 'tour',
      custom_option: 'kept',
    }

    const fields = eventOptionFields(node6, properties, options, false)

    expect(fields).toEqual({ properties, options })
    expect(fields.options).not.toBe(options)
  })

  it('maps each known option to the property posthog-node 5 reads and drops unknown keys', () => {
    const fields = eventOptionFields(
      node5,
      properties,
      {
        process_person_profile: true,
        cookieless_mode: true,
        disable_skew_correction: true,
        product_tour_id: 'tour',
        custom_option: 'dropped',
      },
      false
    )

    expect(fields).toEqual({
      properties: {
        ...properties,
        $process_person_profile: true,
        $cookieless_mode: true,
        $ignore_sent_at: true,
        $product_tour_id: 'tour',
      },
    })
    expect(properties).toEqual({ $ai_trace_id: 'trace', feature: 'chat' })
  })

  it('does not map an option posthog-node 6 would treat as unset', () => {
    expect(
      eventOptionFields(node5, properties, { process_person_profile: null, cookieless_mode: undefined } as any, false)
    ).toEqual({ properties })
  })

  it('turns person processing off last for a personless event on posthog-node 6', () => {
    expect(eventOptionFields(node6, properties, { process_person_profile: true, cookieless_mode: true }, true)).toEqual(
      {
        properties,
        options: { process_person_profile: false, cookieless_mode: true },
      }
    )
  })

  it('turns person processing off last for a personless event on posthog-node 5, over option and property', () => {
    expect(
      eventOptionFields(
        node5,
        { ...properties, $process_person_profile: true },
        { process_person_profile: true, cookieless_mode: true },
        true
      )
    ).toEqual({ properties: { ...properties, $process_person_profile: false, $cookieless_mode: true } })
  })

  it.each([
    ['posthog-node 6', node6],
    ['posthog-node 5', node5],
  ])('leaves the event untouched on %s without options or personless', (_label, client) => {
    expect(eventOptionFields(client, properties, undefined, false)).toEqual({ properties })
    expect(eventOptionFields(client, properties, {}, false)).toEqual({ properties })
  })

  it.each([
    ['a string', 'abc', 'string'],
    ['an array', [{ process_person_profile: true }], 'array'],
    ['a number', 1, 'number'],
  ])('warns about and ignores options that are %s', (_label, options, typeName) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(eventOptionFields(node6, properties, options, false)).toEqual({ properties })
    expect(eventOptionFields(node5, properties, options, false)).toEqual({ properties })
    expect(eventOptionFields(node6, properties, options, true)).toEqual({
      properties,
      options: { process_person_profile: false },
    })
    expect(warn).toHaveBeenCalledTimes(3)
    expect(warn).toHaveBeenCalledWith(`[PostHog AI] options must be an object, got ${typeName}; ignoring them`)
  })

  it('treats null options as none without a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(eventOptionFields(node6, properties, null, false)).toEqual({ properties })
    expect(warn).not.toHaveBeenCalled()
  })
})
