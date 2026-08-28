import { buildChatErrorOptions, buildResponsesErrorOptions } from '../src/openai/telemetry'

const context = {
  client: { privacy_mode: false } as any,
  provider: 'openai' as const,
  baseURL: 'https://api.openai.com',
  monitoring: {} as any,
  modelParametersSource: {},
}

describe('openai telemetry error builders', () => {
  test.each([
    [
      'chat',
      (): ReturnType<typeof buildChatErrorOptions> =>
        buildChatErrorOptions(
          { ...context, params: { model: 'gpt-4', messages: [] } as any },
          new Error('stream died'),
          { usage: { inputTokens: 42, outputTokens: 7 }, latency: 1.5 }
        ),
    ],
    [
      'responses',
      (): ReturnType<typeof buildResponsesErrorOptions> =>
        buildResponsesErrorOptions(
          { ...context, params: { model: 'gpt-4', input: 'hi' } as any },
          new Error('stream died'),
          { usage: { inputTokens: 42, outputTokens: 7 }, latency: 1.5 }
        ),
    ],
  ])('%s error options carry the usage the stream reported and the real latency', (_api, build) => {
    const options = build()
    expect(options.usage).toEqual({ inputTokens: 42, outputTokens: 7 })
    expect(options.latency).toBe(1.5)
  })

  test('usage defaults to empty rather than zeros when the caller has none', () => {
    const options = buildChatErrorOptions(
      { ...context, params: { model: 'gpt-4', messages: [] } as any },
      new Error('failed before a response'),
      { latency: 0.5 }
    )
    expect(options.usage).toEqual({})
  })
})
