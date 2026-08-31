// The real @google/adk package pulls in the full agent runtime (and ESM-only
// deps jest does not transform), so stub the BasePlugin base class the adapter
// extends. This mirrors how processor.test.ts mocks its heavy OpenTelemetry
// deps, and keeps the test focused on the adapter's capture behavior.
jest.mock('@google/adk', () => ({
  BasePlugin: class {
    public readonly name: string
    constructor(name: string) {
      this.name = name
    }
  },
}))

import { PostHogADKPlugin } from '../src/adk'

// Minimal mocks of the @google/adk callback payloads. The plugin only reads a
// handful of fields off each, so plain objects cast to the callback shapes are
// enough to exercise the full capture path through the shared
// captureAiGeneration primitive.
function createMockClient() {
  return {
    capture: jest.fn(),
    captureImmediate: jest.fn().mockResolvedValue(undefined),
    flush: jest.fn().mockResolvedValue(undefined),
  } as any
}

function createContext(overrides: Record<string, any> = {}): any {
  return {
    invocationId: 'inv_123',
    sessionId: 'sess_123',
    userId: 'user_123',
    agentName: 'assistant',
    invocationContext: {},
    ...overrides,
  }
}

function createRequest(overrides: Record<string, any> = {}): any {
  return {
    model: 'gemini-2.0-flash',
    contents: [{ role: 'user', parts: [{ text: 'Hello there' }] }],
    config: {
      systemInstruction: 'You are a helpful assistant',
      temperature: 0.7,
      maxOutputTokens: 256,
      tools: [{ functionDeclarations: [{ name: 'get_weather' }] }],
    },
    ...overrides,
  }
}

function createResponse(overrides: Record<string, any> = {}): any {
  return {
    content: { role: 'model', parts: [{ text: 'Hi, how can I help?' }] },
    modelVersion: 'gemini-2.0-flash-001',
    finishReason: 'STOP',
    usageMetadata: {
      promptTokenCount: 12,
      candidatesTokenCount: 8,
      thoughtsTokenCount: 3,
      cachedContentTokenCount: 4,
      totalTokenCount: 27,
    },
    ...overrides,
  }
}

function capturedEvent(client: ReturnType<typeof createMockClient>, index = 0): any {
  return client.capture.mock.calls[index][0]
}

describe('PostHogADKPlugin', () => {
  let client: ReturnType<typeof createMockClient>
  let plugin: PostHogADKPlugin

  beforeEach(() => {
    client = createMockClient()
    plugin = new PostHogADKPlugin({ client, distinctId: 'user@example.com' })
  })

  it('has the plugin name "posthog"', () => {
    expect(plugin.name).toBe('posthog')
  })

  it('does not intercept the model call (callbacks return undefined)', async () => {
    await expect(
      plugin.beforeModelCallback({ callbackContext: createContext(), llmRequest: createRequest() })
    ).resolves.toBeUndefined()
    await expect(
      plugin.afterModelCallback({ callbackContext: createContext(), llmResponse: createResponse() })
    ).resolves.toBeUndefined()
  })

  it('captures a full $ai_generation with input, output, model, tokens and latency', async () => {
    const ctx = createContext()
    await plugin.beforeModelCallback({ callbackContext: ctx, llmRequest: createRequest() })
    await plugin.afterModelCallback({ callbackContext: ctx, llmResponse: createResponse() })

    expect(client.capture).toHaveBeenCalledTimes(1)
    const event = capturedEvent(client)
    expect(event.event).toBe('$ai_generation')
    expect(event.distinctId).toBe('user@example.com')

    const props = event.properties
    expect(props.$ai_provider).toBe('gemini')
    expect(props.$ai_framework).toBe('google-adk')
    expect(props.$ai_model).toBe('gemini-2.0-flash-001')
    expect(props.$ai_trace_id).toBe('inv_123')
    expect(props.$ai_session_id).toBe('sess_123')
    expect(props.$ai_agent_name).toBe('assistant')
    expect(props.$ai_stop_reason).toBe('STOP')
    expect(typeof props.$ai_latency).toBe('number')
    expect(props.$ai_latency).toBeGreaterThanOrEqual(0)

    // Input includes the system instruction prepended, then the user message
    expect(props.$ai_input).toEqual([
      { role: 'system', content: 'You are a helpful assistant' },
      { role: 'user', content: [{ type: 'text', text: 'Hello there' }] },
    ])
    // Output is normalized to the assistant role with content blocks
    expect(props.$ai_output_choices).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'Hi, how can I help?' }] },
    ])

    // Model parameters extracted from the genai config
    expect(props.$ai_model_parameters).toEqual({ temperature: 0.7, maxOutputTokens: 256 })
    // Tools passed through
    expect(props.$ai_tools).toEqual([{ functionDeclarations: [{ name: 'get_weather' }] }])
  })

  it('maps ADK usageMetadata onto PostHog token fields', async () => {
    const ctx = createContext()
    await plugin.beforeModelCallback({ callbackContext: ctx, llmRequest: createRequest() })
    await plugin.afterModelCallback({ callbackContext: ctx, llmResponse: createResponse() })

    const props = capturedEvent(client).properties
    expect(props.$ai_input_tokens).toBe(12)
    expect(props.$ai_output_tokens).toBe(8)
    expect(props.$ai_reasoning_tokens).toBe(3)
    expect(props.$ai_cache_read_input_tokens).toBe(4)
    // cached tokens are reported inside prompt tokens, not exclusively
    expect(props.$ai_cache_reporting_exclusive).toBe(false)
    // never hardcode cost
    expect(props.$ai_total_cost_usd).toBeUndefined()
  })

  it('omits cache reporting flag when there are no cached tokens', async () => {
    const ctx = createContext()
    await plugin.beforeModelCallback({ callbackContext: ctx, llmRequest: createRequest() })
    await plugin.afterModelCallback({
      callbackContext: ctx,
      llmResponse: createResponse({
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8, totalTokenCount: 20 },
      }),
    })

    const props = capturedEvent(client).properties
    expect(props.$ai_cache_reporting_exclusive).toBeUndefined()
    expect(props.$ai_reasoning_tokens).toBeUndefined()
  })

  it('skips partial (streaming) responses and captures only the terminal one', async () => {
    const ctx = createContext()
    await plugin.beforeModelCallback({ callbackContext: ctx, llmRequest: createRequest() })
    await plugin.afterModelCallback({
      callbackContext: ctx,
      llmResponse: createResponse({ partial: true, content: { role: 'model', parts: [{ text: 'Hi' }] } }),
    })
    expect(client.capture).not.toHaveBeenCalled()

    await plugin.afterModelCallback({ callbackContext: ctx, llmResponse: createResponse() })
    expect(client.capture).toHaveBeenCalledTimes(1)
    expect(capturedEvent(client).properties.$ai_output_choices).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'Hi, how can I help?' }] },
    ])
  })

  it('captures function calls in both input and output', async () => {
    const ctx = createContext()
    await plugin.beforeModelCallback({
      callbackContext: ctx,
      llmRequest: createRequest({
        contents: [
          { role: 'user', parts: [{ text: "What's the weather?" }] },
          { role: 'model', parts: [{ functionCall: { id: 'call_1', name: 'get_weather', args: { city: 'SF' } } }] },
          {
            role: 'user',
            parts: [{ functionResponse: { id: 'call_1', name: 'get_weather', response: { temp: 21 } } }],
          },
        ],
        config: {},
      }),
    })
    await plugin.afterModelCallback({
      callbackContext: ctx,
      llmResponse: createResponse({
        content: { role: 'model', parts: [{ functionCall: { name: 'get_weather', args: { city: 'SF' } } }] },
      }),
    })

    const props = capturedEvent(client).properties
    expect(props.$ai_input).toEqual([
      { role: 'user', content: [{ type: 'text', text: "What's the weather?" }] },
      {
        role: 'assistant',
        content: [{ type: 'function', id: 'call_1', function: { name: 'get_weather', arguments: { city: 'SF' } } }],
      },
      { role: 'user', content: [{ type: 'text', text: JSON.stringify({ temp: 21 }) }] },
    ])
    expect(props.$ai_output_choices).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'function', function: { name: 'get_weather', arguments: { city: 'SF' } } }],
      },
    ])
  })

  it('correlates multiple sequential model calls within one invocation (FIFO)', async () => {
    const ctx = createContext()
    await plugin.beforeModelCallback({
      callbackContext: ctx,
      llmRequest: createRequest({ contents: [{ role: 'user', parts: [{ text: 'first' }] }], config: {} }),
    })
    await plugin.afterModelCallback({
      callbackContext: ctx,
      llmResponse: createResponse({ content: { role: 'model', parts: [{ text: 'first answer' }] } }),
    })
    await plugin.beforeModelCallback({
      callbackContext: ctx,
      llmRequest: createRequest({ contents: [{ role: 'user', parts: [{ text: 'second' }] }], config: {} }),
    })
    await plugin.afterModelCallback({
      callbackContext: ctx,
      llmResponse: createResponse({ content: { role: 'model', parts: [{ text: 'second answer' }] } }),
    })

    expect(client.capture).toHaveBeenCalledTimes(2)
    expect(capturedEvent(client, 0).properties.$ai_input).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'first' }] },
    ])
    expect(capturedEvent(client, 0).properties.$ai_output_choices).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'first answer' }] },
    ])
    expect(capturedEvent(client, 1).properties.$ai_input).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'second' }] },
    ])
  })

  it('captures an error event on onModelErrorCallback', async () => {
    const ctx = createContext()
    await plugin.beforeModelCallback({ callbackContext: ctx, llmRequest: createRequest() })
    await plugin.onModelErrorCallback({ callbackContext: ctx, llmRequest: createRequest(), error: new Error('boom') })

    expect(client.capture).toHaveBeenCalledTimes(1)
    const props = capturedEvent(client).properties
    expect(props.$ai_is_error).toBe(true)
    expect(props.$ai_error).toContain('boom')
    expect(props.$ai_output_choices).toEqual([])
    expect(props.$ai_trace_id).toBe('inv_123')
  })

  it('captures an error event when the response carries an errorCode', async () => {
    const ctx = createContext()
    await plugin.beforeModelCallback({ callbackContext: ctx, llmRequest: createRequest() })
    await plugin.afterModelCallback({
      callbackContext: ctx,
      llmResponse: { errorCode: 'SAFETY', errorMessage: 'blocked by safety filter' } as any,
    })

    const props = capturedEvent(client).properties
    expect(props.$ai_is_error).toBe(true)
    expect(props.$ai_error).toContain('blocked by safety filter')
  })

  describe('distinct id resolution', () => {
    it('accepts a resolver function using the callback context', async () => {
      plugin = new PostHogADKPlugin({ client, distinctId: (ctx) => ctx.userId })
      const ctx = createContext({ userId: 'resolver-user' })
      await plugin.beforeModelCallback({ callbackContext: ctx, llmRequest: createRequest() })
      await plugin.afterModelCallback({ callbackContext: ctx, llmResponse: createResponse() })
      expect(capturedEvent(client).distinctId).toBe('resolver-user')
    })

    it('falls back to the ADK userId when no distinctId option is given', async () => {
      plugin = new PostHogADKPlugin({ client })
      const ctx = createContext({ userId: 'adk-user' })
      await plugin.beforeModelCallback({ callbackContext: ctx, llmRequest: createRequest() })
      await plugin.afterModelCallback({ callbackContext: ctx, llmResponse: createResponse() })
      expect(capturedEvent(client).distinctId).toBe('adk-user')
    })

    it('captures anonymously (personless) when there is no distinctId or userId', async () => {
      plugin = new PostHogADKPlugin({ client })
      const ctx = createContext({ userId: '' })
      await plugin.beforeModelCallback({ callbackContext: ctx, llmRequest: createRequest() })
      await plugin.afterModelCallback({ callbackContext: ctx, llmResponse: createResponse() })
      const event = capturedEvent(client)
      expect(event.distinctId).toBe('inv_123')
      expect(event.properties.$process_person_profile).toBe(false)
    })
  })

  it('redacts input and output content in privacy mode', async () => {
    plugin = new PostHogADKPlugin({ client, distinctId: 'user@example.com', privacyMode: true })
    const ctx = createContext()
    await plugin.beforeModelCallback({ callbackContext: ctx, llmRequest: createRequest() })
    await plugin.afterModelCallback({ callbackContext: ctx, llmResponse: createResponse() })

    const props = capturedEvent(client).properties
    expect(props.$ai_input).toBeNull()
    expect(props.$ai_output_choices).toBeNull()
  })

  it('attaches groups and extra properties to the event', async () => {
    plugin = new PostHogADKPlugin({
      client,
      distinctId: 'user@example.com',
      groups: { organization: 'org_1' },
      properties: { environment: 'production' },
    })
    const ctx = createContext()
    await plugin.beforeModelCallback({ callbackContext: ctx, llmRequest: createRequest() })
    await plugin.afterModelCallback({ callbackContext: ctx, llmResponse: createResponse() })

    const event = capturedEvent(client)
    expect(event.groups).toEqual({ organization: 'org_1' })
    expect(event.properties.environment).toBe('production')
  })

  it('captures immediately when captureImmediate is set', async () => {
    plugin = new PostHogADKPlugin({ client, distinctId: 'user@example.com', captureImmediate: true })
    const ctx = createContext()
    await plugin.beforeModelCallback({ callbackContext: ctx, llmRequest: createRequest() })
    await plugin.afterModelCallback({ callbackContext: ctx, llmResponse: createResponse() })

    expect(client.captureImmediate).toHaveBeenCalledTimes(1)
    expect(client.capture).not.toHaveBeenCalled()
  })

  it('uses a configurable provider label', async () => {
    plugin = new PostHogADKPlugin({ client, distinctId: 'user@example.com', provider: 'anthropic' })
    const ctx = createContext()
    await plugin.beforeModelCallback({ callbackContext: ctx, llmRequest: createRequest({ model: 'claude-sonnet-4' }) })
    await plugin.afterModelCallback({
      callbackContext: ctx,
      llmResponse: createResponse({ modelVersion: undefined }),
    })
    const props = capturedEvent(client).properties
    expect(props.$ai_provider).toBe('anthropic')
    expect(props.$ai_model).toBe('claude-sonnet-4')
  })

  it('waits for the terminal response before capturing a streamed function call', async () => {
    const ctx = createContext()
    await plugin.beforeModelCallback({ callbackContext: ctx, llmRequest: createRequest() })

    await plugin.afterModelCallback({
      callbackContext: ctx,
      llmResponse: createResponse({
        partial: false,
        content: { role: 'model', parts: [{ functionCall: { name: 'get_weather', args: { city: 'SF' } } }] },
        usageMetadata: undefined,
        finishReason: undefined,
      }),
    })
    expect(client.capture).not.toHaveBeenCalled()

    await plugin.afterModelCallback({
      callbackContext: ctx,
      llmResponse: createResponse({ content: undefined, partial: false }),
    })

    expect(client.capture).toHaveBeenCalledTimes(1)
    const props = capturedEvent(client).properties
    expect(props.$ai_input).toEqual([
      { role: 'system', content: 'You are a helpful assistant' },
      { role: 'user', content: [{ type: 'text', text: 'Hello there' }] },
    ])
    expect(props.$ai_output_choices).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'function', function: { name: 'get_weather', arguments: { city: 'SF' } } }],
      },
    ])
    expect(props.$ai_input_tokens).toBe(12)
    expect(props.$ai_output_tokens).toBe(8)
  })

  it('pairs out-of-order parallel responses with their own request', async () => {
    const firstContext = createContext({ agentName: 'worker', invocationContext: { branch: 'parallel.first' } })
    const secondContext = createContext({ agentName: 'worker', invocationContext: { branch: 'parallel.second' } })
    await plugin.beforeModelCallback({
      callbackContext: firstContext,
      llmRequest: createRequest({ contents: [{ role: 'user', parts: [{ text: 'first request' }] }], config: {} }),
    })
    await plugin.beforeModelCallback({
      callbackContext: secondContext,
      llmRequest: createRequest({ contents: [{ role: 'user', parts: [{ text: 'second request' }] }], config: {} }),
    })

    await plugin.afterModelCallback({
      callbackContext: secondContext,
      llmResponse: createResponse({ content: { role: 'model', parts: [{ text: 'second response' }] } }),
    })
    await plugin.afterModelCallback({
      callbackContext: firstContext,
      llmResponse: createResponse({ content: { role: 'model', parts: [{ text: 'first response' }] } }),
    })

    expect(capturedEvent(client, 0).properties.$ai_input).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'second request' }] },
    ])
    expect(capturedEvent(client, 1).properties.$ai_input).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'first request' }] },
    ])
  })

  it('invokes onError when event capture fails', async () => {
    const captureError = new Error('capture failed')
    client.capture.mockImplementation(() => {
      throw captureError
    })
    const onError = jest.fn()
    plugin = new PostHogADKPlugin({ client, onError })
    const ctx = createContext()
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation()

    await plugin.beforeModelCallback({ callbackContext: ctx, llmRequest: createRequest() })
    await plugin.afterModelCallback({ callbackContext: ctx, llmResponse: createResponse() })

    expect(onError).toHaveBeenCalledWith(captureError)
    consoleWarn.mockRestore()
  })
})
