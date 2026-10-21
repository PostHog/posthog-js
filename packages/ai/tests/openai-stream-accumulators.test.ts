import { OpenAIChatStreamAccumulator, OpenAIResponsesStreamAccumulator } from '../src/openai/stream-accumulators'

describe('OpenAI-compatible stream accumulators', () => {
  // Separate from the accumulation test below because the setup is the absence
  // of a usage chunk: a stream cancelled before the end, or one streamed without
  // usage reporting on. Seeding the counts at 0 would report those as free.
  test('chat leaves token counts undefined when no chunk reported usage', () => {
    const accumulator = new OpenAIChatStreamAccumulator()
    accumulator.consume(
      {
        id: 'chatcmpl-1',
        model: 'gpt-4o',
        object: 'chat.completion.chunk',
        created: 1,
        choices: [{ index: 0, finish_reason: null, logprobs: null, delta: { content: 'Hel' } }],
      } as any,
      120
    )

    const { usage } = accumulator.result()
    expect(usage.inputTokens).toBeUndefined()
    expect(usage.outputTokens).toBeUndefined()
  })

  test('chat accumulates text, tools, stop reason, metadata, web search, and raw usage', () => {
    const accumulator = new OpenAIChatStreamAccumulator()
    accumulator.consume(
      {
        id: 'chatcmpl-1',
        model: 'gpt-4o',
        object: 'chat.completion.chunk',
        created: 1,
        system_fingerprint: 'fp-1',
        service_tier: 'default',
        choices: [
          {
            index: 0,
            finish_reason: null,
            logprobs: null,
            delta: {
              content: 'Hello ',
              role: 'assistant',
              refusal: null,
              tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{' } }],
            },
          },
        ],
      } as any,
      120
    )
    const rawUsage = {
      prompt_tokens: 12,
      completion_tokens: 7,
      total_tokens: 19,
      prompt_tokens_details: { cached_tokens: 3, cache_write_tokens: 2 },
      completion_tokens_details: { reasoning_tokens: 4 },
    }
    accumulator.consume({
      id: 'chatcmpl-1',
      model: 'gpt-4o',
      object: 'chat.completion.chunk',
      created: 1,
      choices: [
        {
          index: 0,
          finish_reason: 'tool_calls',
          logprobs: null,
          delta: {
            content: 'world',
            tool_calls: [{ index: 0, function: { arguments: '}' } }],
            annotations: [{ type: 'url_citation', url: 'https://example.com' }],
          },
        },
      ],
      usage: rawUsage,
      service_tier: 'flex',
    } as any)

    expect(accumulator.result()).toEqual({
      output: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Hello world' },
            { type: 'function', id: 'call-1', function: { name: 'lookup', arguments: '{}' } },
          ],
        },
      ],
      model: 'gpt-4o',
      completionId: 'chatcmpl-1',
      systemFingerprint: 'fp-1',
      serviceTier: 'flex',
      firstTokenTime: 120,
      stopReason: 'tool_calls',
      usage: {
        inputTokens: 12,
        outputTokens: 7,
        reasoningTokens: 4,
        cacheReadInputTokens: 3,
        cacheCreationInputTokens: 2,
        webSearchCount: 1,
        rawUsage,
      },
    })
  })

  describe('chat tool calls without an index', () => {
    const chunk = (toolCalls: unknown[], finishReason: string | null = null): any => ({
      id: 'chatcmpl-noindex',
      model: 'compat-model',
      object: 'chat.completion.chunk',
      created: 1,
      choices: [{ index: 0, finish_reason: finishReason, logprobs: null, delta: { tool_calls: toolCalls } }],
    })
    const toolCallContent = (accumulator: OpenAIChatStreamAccumulator) => accumulator.result().output[0].content

    test('keeps two whole calls that carry an id and no index', () => {
      const accumulator = new OpenAIChatStreamAccumulator()
      accumulator.consume(
        chunk([
          { id: 'call-a', type: 'function', function: { name: 'lookup', arguments: '{"q":"a"}' } },
          { id: 'call-b', type: 'function', function: { name: 'search', arguments: '{"q":"b"}' } },
        ])
      )
      accumulator.consume(chunk([], 'tool_calls'))

      expect(toolCallContent(accumulator)).toEqual([
        { type: 'function', id: 'call-a', function: { name: 'lookup', arguments: '{"q":"a"}' } },
        { type: 'function', id: 'call-b', function: { name: 'search', arguments: '{"q":"b"}' } },
      ])
    })

    test('joins argument fragments by id, then onto the latest call when there is no id', () => {
      const accumulator = new OpenAIChatStreamAccumulator()
      accumulator.consume(chunk([{ id: 'call-a', type: 'function', function: { name: 'lookup', arguments: '{"q":' } }]))
      accumulator.consume(chunk([{ id: 'call-a', function: { arguments: '"a"' } }]))
      accumulator.consume(chunk([{ function: { arguments: '}' } }]))

      expect(toolCallContent(accumulator)).toEqual([
        { type: 'function', id: 'call-a', function: { name: 'lookup', arguments: '{"q":"a"}' } },
      ])
    })

    test('keeps two named calls that have neither id nor index', () => {
      const accumulator = new OpenAIChatStreamAccumulator()
      accumulator.consume(chunk([{ function: { name: 'lookup', arguments: '{}' } }]))
      accumulator.consume(chunk([{ function: { name: 'search', arguments: '{}' } }]))

      expect(toolCallContent(accumulator)).toEqual([
        { type: 'function', id: '', function: { name: 'lookup', arguments: '{}' } },
        { type: 'function', id: '', function: { name: 'search', arguments: '{}' } },
      ])
    })

    test('does not let a later real index overwrite an earlier call without one', () => {
      const accumulator = new OpenAIChatStreamAccumulator()
      accumulator.consume(chunk([{ id: 'call-b', type: 'function', function: { name: 'search', arguments: '{}' } }]))
      accumulator.consume(chunk([{ index: 0, id: 'call-a', function: { name: 'lookup', arguments: '{}' } }]))
      accumulator.consume(chunk([{ index: 0, function: { arguments: '' } }], 'tool_calls'))

      expect(toolCallContent(accumulator)).toEqual([
        { type: 'function', id: 'call-b', function: { name: 'search', arguments: '{}' } },
        { type: 'function', id: 'call-a', function: { name: 'lookup', arguments: '{}' } },
      ])
    })

    test('still groups indexed deltas by index', () => {
      const accumulator = new OpenAIChatStreamAccumulator()
      accumulator.consume(chunk([{ index: 1, id: 'call-b', function: { name: 'search', arguments: '{' } }]))
      accumulator.consume(chunk([{ index: 0, id: 'call-a', function: { name: 'lookup', arguments: '{}' } }]))
      accumulator.consume(chunk([{ index: 1, function: { arguments: '}' } }]))

      expect(toolCallContent(accumulator)).toEqual([
        { type: 'function', id: 'call-b', function: { name: 'search', arguments: '{}' } },
        { type: 'function', id: 'call-a', function: { name: 'lookup', arguments: '{}' } },
      ])
    })
  })

  test('chat exposes partial metadata and output after an interrupted stream', () => {
    const accumulator = new OpenAIChatStreamAccumulator()
    accumulator.consume({
      id: 'chatcmpl-partial',
      model: 'gpt-4o',
      object: 'chat.completion.chunk',
      created: 1,
      system_fingerprint: 'fp-partial',
      choices: [{ index: 0, finish_reason: null, logprobs: null, delta: { content: 'partial' } }],
    } as any)

    expect(accumulator.result()).toMatchObject({
      completionId: 'chatcmpl-partial',
      systemFingerprint: 'fp-partial',
      output: [{ content: [{ type: 'text', text: 'partial' }] }],
    })
  })

  test('Responses keeps the final terminal response, usage, stop reason, and web search count', () => {
    const accumulator = new OpenAIResponsesStreamAccumulator()
    const rawUsage = {
      input_tokens: 9,
      output_tokens: 5,
      total_tokens: 14,
      input_tokens_details: { cached_tokens: 2, cache_write_tokens: 1 },
      output_tokens_details: { reasoning_tokens: 3 },
    }
    const response = {
      id: 'resp-1',
      model: 'gpt-4o',
      status: 'incomplete',
      service_tier: 'flex',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: 'answer',
              annotations: [{ type: 'url_citation', url: 'https://example.com' }],
            },
          ],
        },
      ],
      usage: rawUsage,
      incomplete_details: { reason: 'max_output_tokens' },
    }

    accumulator.consume({ type: 'response.output_text.delta', delta: 'answer' } as any, 150)
    accumulator.consume({ type: 'response.incomplete', response } as any, 200)

    expect(accumulator.result()).toEqual({
      output: response.output,
      model: 'gpt-4o',
      completionId: 'resp-1',
      serviceTier: 'flex',
      firstTokenTime: 150,
      stopReason: 'max_output_tokens',
      usage: {
        inputTokens: 9,
        outputTokens: 5,
        reasoningTokens: 3,
        cacheReadInputTokens: 2,
        cacheCreationInputTokens: 1,
        webSearchCount: 1,
        rawUsage,
      },
      terminalResponse: response,
    })
  })
})
