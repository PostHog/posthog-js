import { PostHog } from 'posthog-node'
import { captureAiGeneration } from '../src/captureAiGeneration'
import { AIEvent } from '../src/utils'
import { version } from '../package.json'

jest.mock('posthog-node')

const baseRequiredOptions = {
  model: 'gpt-5',
  provider: 'openai',
  input: 'hello',
  output: 'world',
}

const buildClient = (overrides: Partial<{ enableExceptionAutocapture: boolean; privacy_mode: boolean }> = {}) =>
  ({
    capture: jest.fn(),
    captureImmediate: jest.fn(),
    captureException: jest.fn(),
    options: { enableExceptionAutocapture: overrides.enableExceptionAutocapture ?? false },
    privacy_mode: overrides.privacy_mode ?? false,
  }) as unknown as jest.Mocked<PostHog>

const lastCaptureProperties = (client: jest.Mocked<PostHog>) =>
  (client.capture as jest.Mock).mock.calls[0][0].properties as Record<string, any>

describe('captureAiGeneration', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('emits a $ai_generation event with the canonical property shape', async () => {
    const client = buildClient()

    await captureAiGeneration(client, {
      distinctId: 'user-123',
      traceId: 'trace-abc',
      provider: 'cloudflare-workers-ai',
      model: '@cf/zai-org/glm-4.7-flash',
      input: 'tell me a joke',
      output: 'why did the chicken cross the road?',
      modelParameters: { temperature: 0.7, max_tokens: 200 },
      latency: 1.5,
      timeToFirstToken: 0.4,
      baseURL: 'https://api.example.com',
      usage: { inputTokens: 10, outputTokens: 15 },
      properties: { feature: 'transcript-toc' },
      groups: { company: 'acme' },
      stopReason: 'stop',
      tools: [{ type: 'function', function: { name: 'foo', parameters: {} } } as any],
    })

    expect(client.capture).toHaveBeenCalledTimes(1)
    expect(client.captureImmediate).not.toHaveBeenCalled()

    const event = (client.capture as jest.Mock).mock.calls[0][0]
    expect(event.event).toBe(AIEvent.Generation)
    expect(event.distinctId).toBe('user-123')
    expect(event.groups).toEqual({ company: 'acme' })

    expect(event.properties).toMatchObject({
      $ai_lib: 'posthog-ai',
      $ai_lib_version: version,
      $ai_provider: 'cloudflare-workers-ai',
      $ai_model: '@cf/zai-org/glm-4.7-flash',
      $ai_model_parameters: { temperature: 0.7, max_tokens: 200 },
      $ai_input: 'tell me a joke',
      $ai_output_choices: 'why did the chicken cross the road?',
      $ai_http_status: 200,
      $ai_input_tokens: 10,
      $ai_output_tokens: 15,
      $ai_latency: 1.5,
      $ai_time_to_first_token: 0.4,
      $ai_trace_id: 'trace-abc',
      $ai_base_url: 'https://api.example.com',
      $ai_stop_reason: 'stop',
      $ai_tokens_source: 'sdk',
      feature: 'transcript-toc',
    })
    expect(event.properties.$ai_tools).toEqual([{ type: 'function', function: { name: 'foo', parameters: {} } }])
    expect(event.properties.$process_person_profile).toBeUndefined()
  })

  it('auto-generates a traceId and uses it as distinctId when missing', async () => {
    const client = buildClient()

    await captureAiGeneration(client, baseRequiredOptions)

    const event = (client.capture as jest.Mock).mock.calls[0][0]
    expect(event.properties.$ai_trace_id).toEqual(expect.any(String))
    expect(event.distinctId).toBe(event.properties.$ai_trace_id)
    // Anonymous events disable person processing
    expect(event.properties.$process_person_profile).toBe(false)
  })

  it('honours captureImmediate by awaiting captureImmediate instead of capture', async () => {
    const client = buildClient()

    await captureAiGeneration(client, { ...baseRequiredOptions, captureImmediate: true })

    expect(client.capture).not.toHaveBeenCalled()
    expect(client.captureImmediate).toHaveBeenCalledTimes(1)
  })

  it('swallows synchronous capture delivery failures', async () => {
    const client = buildClient()
    const captureError = new Error('capture failed')
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    client.capture.mockImplementation(() => {
      throw captureError
    })

    await expect(captureAiGeneration(client, baseRequiredOptions)).resolves.toBeUndefined()
    expect(client.capture).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith('[PostHog AI] Failed to capture generation telemetry:', captureError)
  })

  it('awaits the immediate delivery attempt but swallows its rejection', async () => {
    const client = buildClient()
    const captureError = new Error('captureImmediate failed')
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    client.captureImmediate.mockRejectedValue(captureError)

    await expect(
      captureAiGeneration(client, { ...baseRequiredOptions, captureImmediate: true })
    ).resolves.toBeUndefined()
    expect(client.captureImmediate).toHaveBeenCalledTimes(1)
    expect(client.capture).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith('[PostHog AI] Failed to capture generation telemetry:', captureError)
  })

  it('swallows exception autocapture failures', async () => {
    const client = buildClient({ enableExceptionAutocapture: true })
    const captureError = new Error('captureException failed')
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    client.captureException.mockImplementation(() => {
      throw captureError
    })

    await expect(
      captureAiGeneration(client, { ...baseRequiredOptions, error: new Error('provider failed') })
    ).resolves.toBeUndefined()
    expect(client.captureException).toHaveBeenCalledTimes(1)
    expect(client.capture).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith('[PostHog AI] Failed to capture generation telemetry:', captureError)
  })

  it('swallows event construction failures', async () => {
    const client = buildClient()
    const constructionError = new Error('properties failed')
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const properties = new Proxy<Record<string, unknown>>(
      {},
      {
        ownKeys: () => {
          throw constructionError
        },
      }
    )

    await expect(captureAiGeneration(client, { ...baseRequiredOptions, properties })).resolves.toBeUndefined()
    expect(client.capture).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith('[PostHog AI] Failed to capture generation telemetry:', constructionError)
  })

  it('redacts input and output when privacyMode is true', async () => {
    const client = buildClient()

    await captureAiGeneration(client, {
      ...baseRequiredOptions,
      input: 'secret prompt',
      output: 'secret response',
      privacyMode: true,
    })

    const properties = lastCaptureProperties(client)
    expect(properties.$ai_input).toBeNull()
    expect(properties.$ai_output_choices).toBeNull()
  })

  it('preserves input and output overrides from custom properties', async () => {
    const client = buildClient()

    await captureAiGeneration(client, {
      ...baseRequiredOptions,
      properties: { $ai_input: 'override prompt', $ai_output_choices: 'override response' },
    })

    const properties = lastCaptureProperties(client)
    expect(properties.$ai_input).toBe('override prompt')
    expect(properties.$ai_output_choices).toBe('override response')
  })

  it('redacts input and output before inspecting them in privacy mode', async () => {
    const client = buildClient()
    const inspectInput = jest.fn(() => {
      throw new Error('input inspected')
    })
    const inspectOutput = jest.fn(() => {
      throw new Error('output inspected')
    })
    const input = new Proxy({}, { ownKeys: inspectInput })
    const output = new Proxy({}, { ownKeys: inspectOutput })

    await expect(
      captureAiGeneration(client, { ...baseRequiredOptions, input, output, privacyMode: true })
    ).resolves.toBeUndefined()

    expect(inspectInput).not.toHaveBeenCalled()
    expect(inspectOutput).not.toHaveBeenCalled()
    expect(lastCaptureProperties(client)).toMatchObject({ $ai_input: null, $ai_output_choices: null })
  })

  it('converts circular, BigInt, function, and throwing-toJSON input/output to JSON-safe values', async () => {
    const client = buildClient()
    const throwingToJSON = jest.fn(() => {
      throw new Error('cannot serialize')
    })
    const input: Record<string, unknown> = {
      count: 42n,
      callback: () => 'secret',
      nested: { value: 'kept', toJSON: throwingToJSON },
    }
    input.self = input
    const output: unknown[] = [7n, () => undefined]
    output.push(output)

    await expect(captureAiGeneration(client, { ...baseRequiredOptions, input, output })).resolves.toBeUndefined()

    const properties = lastCaptureProperties(client)
    expect(properties.$ai_input).toEqual({
      count: '42',
      callback: '[Function]',
      nested: { value: 'kept', toJSON: '[Function]' },
      self: '[Circular]',
    })
    expect(properties.$ai_output_choices).toEqual(['7', '[Function]', '[Circular]'])
    expect(throwingToJSON).toHaveBeenCalledTimes(1)
    expect(() => JSON.stringify(properties.$ai_input)).not.toThrow()
    expect(() => JSON.stringify(properties.$ai_output_choices)).not.toThrow()
  })

  it('uses intrinsic Date methods instead of caller-provided overrides', async () => {
    const client = buildClient()
    const getTimeOverride = jest.fn(() => 0)
    const toISOStringOverride = jest.fn(() => 2n)
    const validDate = new Date('2025-01-02T03:04:05.000Z')
    const invalidDate = new Date(Number.NaN)

    for (const date of [validDate, invalidDate]) {
      Object.defineProperties(date, {
        getTime: { value: getTimeOverride },
        toISOString: { value: toISOStringOverride },
      })
    }

    await captureAiGeneration(client, { ...baseRequiredOptions, input: validDate, output: invalidDate })

    const properties = lastCaptureProperties(client)
    expect(properties.$ai_input).toBe('2025-01-02T03:04:05.000Z')
    expect(properties.$ai_output_choices).toBeNull()
    expect(getTimeOverride).not.toHaveBeenCalled()
    expect(toISOStringOverride).not.toHaveBeenCalled()
    expect(() => JSON.stringify(properties)).not.toThrow()
  })

  it('bounds deeply nested and oversized input/output values', async () => {
    const client = buildClient()
    const input: Record<string, unknown> = {}
    let cursor = input
    for (let depth = 0; depth < 100; depth++) {
      const child: Record<string, unknown> = {}
      cursor.child = child
      cursor = child
    }
    const output = Array.from({ length: 2_000 }, (_, index) => index)

    await captureAiGeneration(client, { ...baseRequiredOptions, input, output })

    const properties = lastCaptureProperties(client)
    expect(JSON.stringify(properties.$ai_input)).toContain('[Truncated]')
    expect(properties.$ai_output_choices).toHaveLength(1_001)
    expect(properties.$ai_output_choices.at(-1)).toBe('[Truncated]')
  })

  it.each([
    {
      name: 'derives httpStatus from error.status',
      error: Object.assign(new Error('boom'), { status: 503 }),
      httpStatus: undefined,
      expected: 503,
    },
    {
      name: 'derives httpStatus from error.statusCode',
      error: Object.assign(new Error('boom'), { statusCode: 400 }),
      httpStatus: undefined,
      expected: 400,
    },
    {
      name: 'falls back to 500 when the error has no status',
      error: new Error('plain'),
      httpStatus: undefined,
      expected: 500,
    },
    {
      name: 'preserves a caller-supplied httpStatus even when error is provided',
      error: new Error('no status field'),
      httpStatus: 429,
      expected: 429,
    },
  ])('error path: $name', async ({ error, httpStatus, expected }) => {
    const client = buildClient()

    await captureAiGeneration(client, { ...baseRequiredOptions, error, httpStatus })

    const properties = lastCaptureProperties(client)
    expect(properties.$ai_is_error).toBe(true)
    expect(properties.$ai_error).toEqual(expect.any(String))
    const decoded = JSON.parse(properties.$ai_error as string)
    expect(decoded).toEqual(
      expect.objectContaining({
        name: 'Error',
        message: error.message,
        stack: expect.any(String),
      })
    )
    expect(properties.$ai_http_status).toBe(expected)
  })

  it('preserves message, stack, custom fields, and the cause chain in $ai_error', async () => {
    const client = buildClient()
    const root = new Error('root cause')
    const error = Object.assign(new Error('outer', { cause: root }), { statusCode: 502 })

    await captureAiGeneration(client, { ...baseRequiredOptions, error })

    const properties = lastCaptureProperties(client)
    const decoded = JSON.parse(properties.$ai_error as string) as Record<string, unknown>
    expect(decoded.name).toBe('Error')
    expect(decoded.message).toBe('outer')
    expect(typeof decoded.stack).toBe('string')
    expect(decoded.statusCode).toBe(502)
    expect(decoded.cause).toEqual(
      expect.objectContaining({ name: 'Error', message: 'root cause', stack: expect.any(String) })
    )
  })

  it('mutates the original error in place when autocapture is enabled, so callers can re-throw safely', async () => {
    const client = buildClient({ enableExceptionAutocapture: true })
    const error = new Error('boom')

    await captureAiGeneration(client, { ...baseRequiredOptions, error })

    expect((error as any).__posthog_previously_captured_error).toBe(true)
  })

  it('runs exception autocapture and tags the trace when enabled', async () => {
    const client = buildClient({ enableExceptionAutocapture: true })
    const error = new Error('boom')

    await captureAiGeneration(client, { ...baseRequiredOptions, error })

    expect(client.captureException).toHaveBeenCalledTimes(1)
    const [capturedError, , properties, exceptionId] = (client.captureException as jest.Mock).mock.calls[0]
    expect(capturedError).toBe(error)
    expect(properties).toEqual({ $ai_trace_id: expect.any(String) })
    expect(typeof exceptionId).toBe('string')

    expect(lastCaptureProperties(client).$exception_event_id).toBe(exceptionId)
    expect((error as any).__posthog_previously_captured_error).toBe(true)
  })

  it.each([
    {
      name: 'falls back to model/provider when no override is set',
      modelOverride: undefined,
      providerOverride: undefined,
      expectedModel: baseRequiredOptions.model,
      expectedProvider: baseRequiredOptions.provider,
    },
    {
      name: 'honours providerOverride and modelOverride when set',
      modelOverride: 'override-model',
      providerOverride: 'override-provider',
      expectedModel: 'override-model',
      expectedProvider: 'override-provider',
    },
  ])(
    'model/provider resolution: $name',
    async ({ modelOverride, providerOverride, expectedModel, expectedProvider }) => {
      const client = buildClient()

      await captureAiGeneration(client, { ...baseRequiredOptions, modelOverride, providerOverride })

      expect(lastCaptureProperties(client)).toMatchObject({
        $ai_model: expectedModel,
        $ai_provider: expectedProvider,
      })
    }
  )

  it('computes cost overrides from inputTokens/outputTokens', async () => {
    const client = buildClient()

    await captureAiGeneration(client, {
      ...baseRequiredOptions,
      usage: { inputTokens: 1000, outputTokens: 500 },
      costOverride: { inputCost: 0.000_01, outputCost: 0.000_03 },
    })

    const properties = lastCaptureProperties(client)
    expect(properties.$ai_input_cost_usd).toBeCloseTo(0.01)
    expect(properties.$ai_output_cost_usd).toBeCloseTo(0.015)
    expect(properties.$ai_total_cost_usd).toBeCloseTo(0.025)
  })

  it('supports embedding events via eventType', async () => {
    const client = buildClient()

    await captureAiGeneration(client, { ...baseRequiredOptions, eventType: AIEvent.Embedding })

    expect((client.capture as jest.Mock).mock.calls[0][0].event).toBe(AIEvent.Embedding)
  })

  it.each([
    { name: 'null', error: null },
    { name: 'undefined', error: undefined },
  ])('does not emit error metadata when error is $name', async ({ error }) => {
    const client = buildClient()

    await captureAiGeneration(client, { ...baseRequiredOptions, error })

    const properties = lastCaptureProperties(client)
    expect(properties.$ai_is_error).toBeUndefined()
    expect(properties.$ai_error).toBeUndefined()
    expect(properties.$ai_http_status).toBe(200)
  })

  it('skips emission when client.capture is unavailable', async () => {
    const client = { options: {} } as unknown as jest.Mocked<PostHog>

    await expect(captureAiGeneration(client, baseRequiredOptions)).resolves.toBeUndefined()
  })

  it('marks tokens source as passthrough when properties contain token overrides', async () => {
    const client = buildClient()

    await captureAiGeneration(client, {
      ...baseRequiredOptions,
      properties: { $ai_input_tokens: 99 },
    })

    expect(lastCaptureProperties(client).$ai_tokens_source).toBe('passthrough')
  })
})
