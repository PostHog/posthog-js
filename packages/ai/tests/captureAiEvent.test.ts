import { captureAiEvent, captureAiEventImmediate, isMultimodalCaptureEnabled } from '../src/captureAiEvent'

const makeClient = (overrides: Record<string, unknown> = {}): any => ({
  capture: jest.fn(),
  captureImmediate: jest.fn().mockResolvedValue(undefined),
  _captureAi: jest.fn(),
  _captureAiImmediate: jest.fn().mockResolvedValue(undefined),
  ...overrides,
})

describe('captureAiEvent routing', () => {
  const event = { distinctId: 'u', event: '$ai_generation', properties: {} }

  it('uses capture() by default (no opt-in)', () => {
    const client = makeClient()
    captureAiEvent(client, event)
    expect(client.capture).toHaveBeenCalledWith(event)
    expect(client._captureAi).not.toHaveBeenCalled()
  })

  it('routes to _captureAi when _useAiLane is true', () => {
    const client = makeClient({ _useAiLane: true })
    captureAiEvent(client, event)
    expect(client._captureAi).toHaveBeenCalledWith(event)
    expect(client.capture).not.toHaveBeenCalled()
  })

  it('multimodal capture implies the lane', () => {
    const client = makeClient({ _enableMultimodalCapture: true })
    captureAiEvent(client, event)
    expect(client._captureAi).toHaveBeenCalledWith(event)
  })

  it('requires the flag to be strictly true (truthy mock attributes stay opted out)', () => {
    const client = makeClient({ _useAiLane: jest.fn() })
    captureAiEvent(client, event)
    expect(client.capture).toHaveBeenCalledWith(event)
    expect(client._captureAi).not.toHaveBeenCalled()
  })

  it('falls back to capture() when an opted-in client lacks a callable _captureAi', () => {
    const client = makeClient({ _useAiLane: true, _captureAi: undefined })
    captureAiEvent(client, event)
    expect(client.capture).toHaveBeenCalledWith(event)
  })

  it('immediate variant mirrors the routing', async () => {
    const optedIn = makeClient({ _useAiLane: true })
    await captureAiEventImmediate(optedIn, event)
    expect(optedIn._captureAiImmediate).toHaveBeenCalledWith(event)
    expect(optedIn.captureImmediate).not.toHaveBeenCalled()

    const fallback = makeClient({ _useAiLane: true, _captureAiImmediate: undefined })
    await captureAiEventImmediate(fallback, event)
    expect(fallback.captureImmediate).toHaveBeenCalledWith(event)
  })
})

describe('isMultimodalCaptureEnabled', () => {
  it('is true only for a strict true flag', () => {
    expect(isMultimodalCaptureEnabled({ _enableMultimodalCapture: true })).toBe(true)
    expect(isMultimodalCaptureEnabled({ _enableMultimodalCapture: 1 } as any)).toBe(false)
    expect(isMultimodalCaptureEnabled({})).toBe(false)
    expect(isMultimodalCaptureEnabled(undefined)).toBe(false)
  })
})
