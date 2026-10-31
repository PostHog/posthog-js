import { PostHog } from 'posthog-node'

import { captureAiEvent, captureAiEventImmediate, isFullAiCaptureEnabled, usesAiLane } from '../src/captureAiEvent'

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
