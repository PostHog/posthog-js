import { captureAiEvent, captureAiEventImmediate, isFullAiCaptureEnabled } from '../src/captureAiEvent'

const makeClient = (overrides: Record<string, unknown> = {}): any => ({
  capture: jest.fn(),
  captureImmediate: jest.fn().mockResolvedValue(undefined),
  captureAi: jest.fn(),
  captureAiImmediate: jest.fn().mockResolvedValue(undefined),
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
    const client = makeClient({ enableFullAiCapture: jest.fn() })
    captureAiEvent(client, event)
    expect(client.capture).toHaveBeenCalledWith(event)
    expect(client.captureAi).not.toHaveBeenCalled()
  })

  it('falls back to capture() when an opted-in client lacks a callable captureAi', () => {
    const client = makeClient({ enableFullAiCapture: true, captureAi: undefined })
    captureAiEvent(client, event)
    expect(client.capture).toHaveBeenCalledWith(event)
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
