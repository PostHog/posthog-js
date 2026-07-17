import { PostHogAI } from '../src/otel'

describe('PostHogAI', () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch')

  beforeEach(() => {
    fetchMock.mockReset()
  })

  afterAll(() => {
    fetchMock.mockRestore()
  })

  it('submits a score using the gateway request and trace targets', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: '019b6e4a-85c4-7df1-a315-2c968e84083f' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const posthogAI = new PostHogAI({ projectSecret: 'phs_test' })

    const result = await posthogAI.score({
      id: ' 019b6e4a-85c4-7df1-a315-2c968e84083f ',
      requestId: ' req_gateway_123 ',
      traceId: ' 01010101010101010101010101010101 ',
      spanId: ' 0202020202020202 ',
      name: ' answer-quality ',
      value: 0.92,
      label: ' pass ',
      explanation: ' Used the retrieved context. ',
      distinctId: ' user_42 ',
    })

    expect(result).toEqual({ id: '019b6e4a-85c4-7df1-a315-2c968e84083f' })
    expect(fetchMock).toHaveBeenCalledWith('https://ai-gateway.us.posthog.com/i/v0/ai/scores', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer phs_test',
        'Content-Type': 'application/json',
        'X-PostHog-Distinct-Id': 'user_42',
      },
      body: JSON.stringify({
        id: '019b6e4a-85c4-7df1-a315-2c968e84083f',
        request_id: 'req_gateway_123',
        trace_id: '01010101010101010101010101010101',
        span_id: '0202020202020202',
        name: 'answer-quality',
        value: 0.92,
        label: 'pass',
        explanation: 'Used the retrieved context.',
      }),
      signal: undefined,
    })
  })

  it('rejects scores without explicit or active trace context', async () => {
    const posthogAI = new PostHogAI({ projectSecret: 'phs_test' })

    await expect(posthogAI.score({ name: 'answer-quality', value: 0.92 })).rejects.toThrow(
      'PostHogAI.score requires an active span or traceId'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects non-finite score values', async () => {
    const posthogAI = new PostHogAI({ projectSecret: 'phs_test' })

    await expect(
      posthogAI.score({
        traceId: '01010101010101010101010101010101',
        name: 'answer-quality',
        value: Number.NaN,
      })
    ).rejects.toThrow('PostHogAI.score requires a finite value')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
