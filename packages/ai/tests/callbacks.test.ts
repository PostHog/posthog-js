import { LangChainCallbackHandler } from '../src/langchain/callbacks'
import { PostHog } from 'posthog-node'
import { AIMessage } from '@langchain/core/messages'
import type { ChatGeneration } from '@langchain/core/outputs'
import { version } from '../package.json'

const mockPostHogClient = {
  capture: jest.fn(),
} as unknown as PostHog

describe('LangChainCallbackHandler', () => {
  let handler: LangChainCallbackHandler

  beforeEach(() => {
    handler = new LangChainCallbackHandler({
      client: mockPostHogClient,
    })
    jest.clearAllMocks()
  })

  it('should include $ai_lib and $ai_lib_version in captured events', async () => {
    const serialized = {
      lc: 1,
      type: 'constructor' as const,
      id: ['langchain', 'llms', 'openai', 'OpenAI'],
      kwargs: { openai_api_base: 'https://api.openai.com/v1' },
    }

    const prompts = ['Test prompt for library version']
    const runId = 'run_lib_test'
    const parentRunId = 'parent_lib'
    const metadata = { ls_model_name: 'gpt-4', ls_provider: 'openai' }
    // Need to provide extraParams with invocation_params to set up modelParams
    const extraParams = {
      invocation_params: {
        temperature: 0.7,
        max_tokens: 100,
      },
    }

    // Start LLM with extraParams
    handler.handleLLMStart(serialized, prompts, runId, parentRunId, extraParams, undefined, metadata)

    // Mock LLM response
    const llmResult = {
      generations: [
        [
          {
            text: 'Test response',
            message: new AIMessage('Test response'),
          },
        ],
      ],
      llmOutput: {
        tokenUsage: {
          promptTokens: 10,
          completionTokens: 3,
          totalTokens: 13,
        },
      },
    }

    // End LLM
    handler.handleLLMEnd(llmResult, runId)

    // Verify capture was called
    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls

    // Check $ai_lib and $ai_lib_version
    expect(captureCall[0].properties['$ai_lib']).toBe('posthog-ai')
    expect(captureCall[0].properties['$ai_lib_version']).toBe(version)

    // Check $ai_framework
    expect(captureCall[0].properties['$ai_framework']).toBe('langchain')

    // Check other expected properties
    expect(captureCall[0].event).toBe('$ai_generation')
    expect(captureCall[0].properties.$ai_model).toBe('gpt-4')
    expect(captureCall[0].properties.$ai_provider).toBe('openai')
  })

  it('does not throw when generation capture fails', () => {
    const capture = mockPostHogClient.capture as jest.Mock
    capture.mockImplementationOnce(() => {
      throw new Error('telemetry failed')
    })
    const runId = 'run_capture_failure'

    handler.handleLLMStart(
      { lc: 1, type: 'constructor', id: ['langchain', 'llms', 'openai', 'OpenAI'], kwargs: {} },
      ['Hello'],
      runId,
      undefined,
      { invocation_params: {} },
      undefined,
      { ls_model_name: 'gpt-4', ls_provider: 'openai' }
    )

    expect(() =>
      handler.handleLLMEnd(
        {
          generations: [[{ text: 'Hello back' }]],
          llmOutput: {},
        },
        runId
      )
    ).not.toThrow()
    expect(capture).toHaveBeenCalledTimes(1)
  })

  it('does not throw when trace capture fails', () => {
    const capture = mockPostHogClient.capture as jest.Mock
    capture.mockImplementationOnce(() => {
      throw new Error('telemetry failed')
    })
    const runId = 'chain_capture_failure'

    handler.handleChainStart(
      { lc: 1, type: 'constructor', id: ['langchain', 'chains', 'TestChain'], kwargs: {} },
      { input: 'Hello' },
      runId
    )

    expect(() => handler.handleChainEnd({ output: 'Hello back' }, runId)).not.toThrow()
    expect(capture).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      name: 'usage_metadata and finish_reason',
      serializedId: ['langchain', 'chat_models', 'openai', 'ChatOpenAI'],
      runId: 'run_ai_message_metadata',
      model: 'gpt-4',
      provider: 'openai',
      generation: {
        message: new AIMessage({
          content: 'Test response',
          usage_metadata: {
            input_tokens: 12,
            output_tokens: 4,
            total_tokens: 16,
          },
          response_metadata: { finish_reason: 'stop' },
        }),
      },
      expectedInputTokens: 12,
      expectedOutputTokens: 4,
      expectedStopReason: 'stop',
    },
    {
      name: 'response_metadata usage and stop_reason',
      serializedId: ['langchain', 'chat_models', 'anthropic', 'ChatAnthropic'],
      runId: 'run_ai_message_response_metadata',
      model: 'claude-3',
      provider: 'anthropic',
      generation: {
        message: new AIMessage({
          content: 'Test response',
          response_metadata: {
            stop_reason: 'end_turn',
            usage: {
              input_tokens: 15,
              output_tokens: 5,
            },
          },
        }),
      },
      expectedInputTokens: 15,
      expectedOutputTokens: 5,
      expectedStopReason: 'end_turn',
    },
    {
      name: 'generationInfo usage_metadata and finish_reason',
      serializedId: ['langchain', 'chat_models', 'openai', 'ChatOpenAI'],
      runId: 'run_generation_info_usage_metadata',
      model: 'gpt-4',
      provider: 'openai',
      generation: {
        generationInfo: {
          usage_metadata: {
            input_tokens: 18,
            output_tokens: 6,
          },
          finish_reason: 'length',
        },
      },
      expectedInputTokens: 18,
      expectedOutputTokens: 6,
      expectedStopReason: 'length',
    },
    {
      name: 'generationInfo response_metadata usage and stop_reason',
      serializedId: ['langchain', 'chat_models', 'anthropic', 'ChatAnthropic'],
      runId: 'run_generation_info_response_metadata',
      model: 'claude-3',
      provider: 'anthropic',
      generation: {
        generationInfo: {
          response_metadata: {
            usage: {
              input_tokens: 21,
              output_tokens: 7,
            },
            stop_reason: 'end_turn',
          },
        },
      },
      expectedInputTokens: 21,
      expectedOutputTokens: 7,
      expectedStopReason: 'end_turn',
    },
    {
      name: 'response_metadata Bedrock invocation metrics',
      serializedId: ['langchain', 'chat_models', 'bedrock', 'ChatBedrock'],
      runId: 'run_message_bedrock_invocation_metrics',
      model: 'anthropic.claude-3',
      provider: 'bedrock',
      generation: {
        message: new AIMessage({
          content: 'Test response',
          response_metadata: {
            finish_reason: 'stop',
            'amazon-bedrock-invocationMetrics': {
              inputTokenCount: 24,
              outputTokenCount: 8,
            },
          },
        }),
      },
      expectedInputTokens: 24,
      expectedOutputTokens: 8,
      expectedStopReason: 'stop',
    },
    {
      name: 'generationInfo response_metadata Bedrock invocation metrics',
      serializedId: ['langchain', 'chat_models', 'bedrock', 'ChatBedrock'],
      runId: 'run_generation_info_bedrock_invocation_metrics',
      model: 'anthropic.claude-3',
      provider: 'bedrock',
      generation: {
        generationInfo: {
          response_metadata: {
            stop_reason: 'end_turn',
            'amazon-bedrock-invocationMetrics': {
              inputTokenCount: 27,
              outputTokenCount: 9,
            },
          },
        },
      },
      expectedInputTokens: 27,
      expectedOutputTokens: 9,
      expectedStopReason: 'end_turn',
    },
  ])(
    'should extract usage and stop reason from AIMessage $name without llmOutput',
    ({
      serializedId,
      runId,
      model,
      provider,
      generation,
      expectedInputTokens,
      expectedOutputTokens,
      expectedStopReason,
    }) => {
      const serialized = {
        lc: 1,
        type: 'constructor' as const,
        id: serializedId,
        kwargs: {},
      }

      handler.handleLLMStart(serialized, ['Test prompt'], runId, undefined, { invocation_params: {} }, undefined, {
        ls_model_name: model,
        ls_provider: provider,
      })
      const llmResult = {
        generations: [
          [
            {
              text: 'Test response',
              ...generation,
            },
          ],
        ],
      }
      handler.handleLLMEnd(llmResult, runId)

      const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls
      expect(captureCall[0].properties['$ai_input_tokens']).toBe(expectedInputTokens)
      expect(captureCall[0].properties['$ai_output_tokens']).toBe(expectedOutputTokens)
      expect(captureCall[0].properties['$ai_stop_reason']).toBe(expectedStopReason)
    }
  )

  it('routes generation events through captureAi when the client opted into the AI lane', async () => {
    const aiLaneClient = {
      capture: jest.fn(),
      enableFullAiCapture: true,
      captureAi: jest.fn(),
    } as unknown as PostHog
    const aiLaneHandler = new LangChainCallbackHandler({
      client: aiLaneClient,
    })

    const serialized = {
      lc: 1,
      type: 'constructor' as const,
      id: ['langchain', 'llms', 'openai', 'OpenAI'],
      kwargs: { openai_api_base: 'https://api.openai.com/v1' },
    }

    const prompts = ['Test prompt for library version']
    const runId = 'run_lib_test'
    const parentRunId = 'parent_lib'
    const metadata = { ls_model_name: 'gpt-4', ls_provider: 'openai' }
    const extraParams = {
      invocation_params: {
        temperature: 0.7,
        max_tokens: 100,
      },
    }

    aiLaneHandler.handleLLMStart(serialized, prompts, runId, parentRunId, extraParams, undefined, metadata)

    const llmResult = {
      generations: [
        [
          {
            text: 'Test response',
            message: new AIMessage('Test response'),
          },
        ],
      ],
      llmOutput: {
        tokenUsage: {
          promptTokens: 10,
          completionTokens: 3,
          totalTokens: 13,
        },
      },
    }

    aiLaneHandler.handleLLMEnd(llmResult, runId)

    expect((aiLaneClient as any).captureAi).toHaveBeenCalledTimes(1)
    expect(aiLaneClient.capture).not.toHaveBeenCalled()
    const [captureCall] = (aiLaneClient as any).captureAi.mock.calls

    expect(captureCall[0].properties['$ai_lib']).toBe('posthog-ai')
    expect(captureCall[0].properties['$ai_lib_version']).toBe(version)
    expect(captureCall[0].properties['$ai_framework']).toBe('langchain')
    expect(captureCall[0].event).toBe('$ai_generation')
    expect(captureCall[0].properties.$ai_model).toBe('gpt-4')
    expect(captureCall[0].properties.$ai_provider).toBe('openai')
  })

  it('strips wrapper-sanitized state when privacy mode wins over the full-capture flag', () => {
    const privacyModeClient = {
      capture: jest.fn(),
      captureAi: jest.fn(),
      enableFullAiCapture: true,
      privacy_mode: true,
    } as unknown as PostHog
    const handler = new LangChainCallbackHandler({ client: privacyModeClient })

    const dataUrl = 'data:image/jpeg;base64,' + 'A'.repeat(2000)
    const serialized = {
      lc: 1,
      type: 'constructor' as const,
      id: ['langchain', 'schema', 'runnable', 'RunnableSequence'],
      kwargs: {},
    }
    const runId = 'run_chain_privacy'

    handler.handleChainStart(
      serialized,
      {
        messages: [
          {
            content: [
              { type: 'text', text: 'describe this image' },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      } as any,
      runId
    )
    handler.handleChainEnd({ echoed: dataUrl }, runId)

    expect((privacyModeClient as any).captureAi).toHaveBeenCalledTimes(1)
    expect(privacyModeClient.capture).not.toHaveBeenCalled()
    const [captureCall] = (privacyModeClient as any).captureAi.mock.calls

    expect(captureCall[0].properties['$ai_input_state']).toBeNull()
    expect(captureCall[0].properties['$ai_output_state']).toBeNull()
  })

  it('should convert AIMessage with tool calls to dict format', () => {
    const toolCalls = [
      {
        id: 'call_123',
        name: 'get_weather',
        args: { city: 'San Francisco', units: 'celsius' },
      },
    ]

    const aiMessage = new AIMessage({
      content: "I'll check the weather for you.",
      tool_calls: toolCalls,
    })

    const result = (handler as any)._convertMessageToDict(aiMessage)

    expect(result.role).toBe('assistant')
    expect(result.content).toBe("I'll check the weather for you.")
    expect(result.tool_calls).toEqual([
      {
        type: 'function',
        id: 'call_123',
        function: {
          name: 'get_weather',
          arguments: '{"city":"San Francisco","units":"celsius"}',
        },
      },
    ])
  })

  it('should handle LLM start with tool calls correctly', () => {
    // Spy on private methods
    const logDebugEventSpy = jest.spyOn(handler as any, '_logDebugEvent')
    const setParentOfRunSpy = jest.spyOn(handler as any, '_setParentOfRun')
    const setLLMMetadataSpy = jest.spyOn(handler as any, '_setLLMMetadata')

    const serialized = {
      lc: 1,
      type: 'constructor' as const,
      id: ['langchain', 'llms', 'openai', 'OpenAI'],
      kwargs: { openai_api_base: 'https://api.openai.com/v1' },
    }

    const prompts = ['Test prompt']
    const runId = 'run_123'
    const parentRunId = 'parent_456'
    const tags = ['test']
    const tools = [{ type: 'function', function: { name: 'test_tool' } }]
    const extraParams = { invocation_params: { tools } }
    const metadata = { ls_model_name: 'gpt-4', ls_provider: 'openai' }
    const runName = 'test_run'

    // Call the method under test
    handler.handleLLMStart(serialized, prompts, runId, parentRunId, extraParams, tags, metadata, runName)

    // Verify private methods were called correctly
    expect(logDebugEventSpy).toHaveBeenCalledWith('on_llm_start', runId, parentRunId, { prompts, tags })
    expect(setParentOfRunSpy).toHaveBeenCalledWith(runId, parentRunId)
    expect(setLLMMetadataSpy).toHaveBeenCalledWith(serialized, runId, prompts, metadata, extraParams, runName)

    // Verify run metadata includes tool information
    const runMetadata = (handler as any).runs[runId]
    expect(runMetadata.name).toBe(runName)
    expect(runMetadata.input).toEqual(prompts)
    expect(runMetadata.tools).toEqual(tools)
    expect(runMetadata.model).toBe('gpt-4')
    expect(runMetadata.provider).toBe('openai')
    expect(runMetadata.baseUrl).toBe('https://api.openai.com/v1')

    // Clean up spies
    logDebugEventSpy.mockRestore()
    setParentOfRunSpy.mockRestore()
    setLLMMetadataSpy.mockRestore()
  })

  it('should not subtract cache_read_tokens from input_tokens for OpenAI', async () => {
    const serialized = {
      lc: 1,
      type: 'constructor' as const,
      id: ['langchain', 'llms', 'openai', 'OpenAI'],
      kwargs: {},
    }

    const prompts = ['Use the cached prompt for this request']
    const runId = 'run_cache_test_1'
    const metadata = { ls_model_name: 'gpt-4', ls_provider: 'openai' }
    const extraParams = {
      invocation_params: {
        temperature: 0.7,
      },
    }

    handler.handleLLMStart(serialized, prompts, runId, undefined, extraParams, undefined, metadata)

    // Mock LLM response with cache read tokens
    // For OpenAI, input_tokens is already separate from cache_read tokens
    const llmResult = {
      generations: [
        [
          {
            text: 'Response using cached prompt context.',
            message: new AIMessage('Response using cached prompt context.'),
          },
        ],
      ],
      llmOutput: {
        tokenUsage: {
          promptTokens: 150,
          completionTokens: 40,
          totalTokens: 190,
          prompt_tokens_details: {
            cached_tokens: 100, // 100 tokens read from cache
          },
        },
      },
    }

    handler.handleLLMEnd(llmResult, runId)

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls

    expect(captureCall[0].event).toBe('$ai_generation')
    // Input tokens should NOT be reduced for OpenAI: 150 (no subtraction)
    expect(captureCall[0].properties['$ai_input_tokens']).toBe(150)
    expect(captureCall[0].properties['$ai_output_tokens']).toBe(40)
    expect(captureCall[0].properties['$ai_cache_read_input_tokens']).toBe(100)
  })

  it('should not subtract for OpenAI even when cache_read_tokens >= input_tokens', async () => {
    const serialized = {
      lc: 1,
      type: 'constructor' as const,
      id: ['langchain', 'llms', 'openai', 'OpenAI'],
      kwargs: {},
    }

    const prompts = ['Edge case with large cache read']
    const runId = 'run_cache_test_2'
    const metadata = { ls_model_name: 'gpt-4', ls_provider: 'openai' }
    const extraParams = {
      invocation_params: {
        temperature: 0.7,
      },
    }

    handler.handleLLMStart(serialized, prompts, runId, undefined, extraParams, undefined, metadata)

    // Edge case: cache_read_tokens >= input_tokens
    // For OpenAI, no subtraction should happen
    const llmResult = {
      generations: [
        [
          {
            text: 'Response with edge case token counts.',
            message: new AIMessage('Response with edge case token counts.'),
          },
        ],
      ],
      llmOutput: {
        tokenUsage: {
          promptTokens: 80,
          completionTokens: 20,
          totalTokens: 100,
          prompt_tokens_details: {
            cached_tokens: 100, // More than promptTokens
          },
        },
      },
    }

    handler.handleLLMEnd(llmResult, runId)

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls

    expect(captureCall[0].event).toBe('$ai_generation')
    // Input tokens should NOT be reduced for OpenAI: 80 (no subtraction)
    expect(captureCall[0].properties['$ai_input_tokens']).toBe(80)
    expect(captureCall[0].properties['$ai_output_tokens']).toBe(20)
    expect(captureCall[0].properties['$ai_cache_read_input_tokens']).toBe(100)
  })

  it('should not subtract when there are no cache_read_tokens', async () => {
    const serialized = {
      lc: 1,
      type: 'constructor' as const,
      id: ['langchain', 'llms', 'openai', 'OpenAI'],
      kwargs: {},
    }

    const prompts = ['Normal request without cache']
    const runId = 'run_cache_test_3'
    const metadata = { ls_model_name: 'gpt-4', ls_provider: 'openai' }
    const extraParams = {
      invocation_params: {
        temperature: 0.7,
      },
    }

    handler.handleLLMStart(serialized, prompts, runId, undefined, extraParams, undefined, metadata)

    // No cache usage - input_tokens should remain as-is
    const llmResult = {
      generations: [
        [
          {
            text: 'Response without cache.',
            message: new AIMessage('Response without cache.'),
          },
        ],
      ],
      llmOutput: {
        tokenUsage: {
          promptTokens: 100,
          completionTokens: 30,
          totalTokens: 130,
          // No cached_tokens
        },
      },
    }

    handler.handleLLMEnd(llmResult, runId)

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls

    expect(captureCall[0].event).toBe('$ai_generation')
    // Input tokens should remain unchanged at 100
    expect(captureCall[0].properties['$ai_input_tokens']).toBe(100)
    expect(captureCall[0].properties['$ai_output_tokens']).toBe(30)
  })

  it('should handle zero input_tokens with cache_read_tokens', async () => {
    const serialized = {
      lc: 1,
      type: 'constructor' as const,
      id: ['langchain', 'llms', 'openai', 'OpenAI'],
      kwargs: {},
    }

    const prompts = ['Edge case query']
    const runId = 'run_cache_test_4'
    const metadata = { ls_model_name: 'gpt-4', ls_provider: 'openai' }
    const extraParams = {
      invocation_params: {
        temperature: 0.7,
      },
    }

    handler.handleLLMStart(serialized, prompts, runId, undefined, extraParams, undefined, metadata)

    // Edge case: input_tokens is 0 (falsy), should skip subtraction
    const llmResult = {
      generations: [
        [
          {
            text: 'Response.',
            message: new AIMessage('Response.'),
          },
        ],
      ],
      llmOutput: {
        tokenUsage: {
          promptTokens: 0,
          completionTokens: 10,
          totalTokens: 10,
          prompt_tokens_details: {
            cached_tokens: 50,
          },
        },
      },
    }

    handler.handleLLMEnd(llmResult, runId)

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls

    expect(captureCall[0].event).toBe('$ai_generation')
    // Input tokens should remain 0 (no subtraction because input_tokens is falsy)
    expect(captureCall[0].properties['$ai_input_tokens']).toBe(0)
    expect(captureCall[0].properties['$ai_output_tokens']).toBe(10)
    expect(captureCall[0].properties['$ai_cache_read_input_tokens']).toBe(50)
  })

  it('should use generation info usage when message response metadata is empty', async () => {
    const serialized = {
      lc: 1,
      type: 'constructor' as const,
      id: ['langchain', 'llms', 'openai', 'OpenAI'],
      kwargs: {},
    }
    const runId = 'run_generation_info_usage_test'
    handler.handleLLMStart(serialized, ['Use generation info'], runId, undefined, {}, undefined, {
      ls_model_name: 'gpt-4',
      ls_provider: 'openai',
    })

    const generation = {
      text: 'Response with generation info usage.',
      message: new AIMessage({
        content: 'Response with generation info usage.',
        response_metadata: {},
      }),
      generationInfo: {
        response_metadata: {
          usage: {
            input_tokens: 21,
            output_tokens: 9,
          },
        },
      },
    } satisfies ChatGeneration

    handler.handleLLMEnd(
      {
        generations: [[generation]],
      },
      runId
    )

    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls
    expect(captureCall[0].properties['$ai_input_tokens']).toBe(21)
    expect(captureCall[0].properties['$ai_output_tokens']).toBe(9)
  })

  it('should ignore empty top-level usage and fall back to generation metadata', async () => {
    const serialized = {
      lc: 1,
      type: 'constructor' as const,
      id: ['langchain', 'llms', 'openai', 'OpenAI'],
      kwargs: {},
    }
    const runId = 'run_empty_top_level_usage_test'
    handler.handleLLMStart(serialized, ['Use generation info'], runId, undefined, {}, undefined, {
      ls_model_name: 'gpt-4',
      ls_provider: 'openai',
    })

    const generation = {
      text: 'Response with generation info usage.',
      message: new AIMessage({
        content: 'Response with generation info usage.',
        response_metadata: {},
      }),
      generationInfo: {
        response_metadata: {
          usage: {
            input_tokens: 21,
            output_tokens: 9,
          },
        },
      },
    } satisfies ChatGeneration

    handler.handleLLMEnd(
      {
        generations: [[generation]],
        llmOutput: {
          tokenUsage: {},
        },
      },
      runId
    )

    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls
    expect(captureCall[0].properties['$ai_input_tokens']).toBe(21)
    expect(captureCall[0].properties['$ai_output_tokens']).toBe(9)
  })

  it('should ignore empty Anthropic generation usage and fall back to raw generation usage', async () => {
    const serialized = {
      lc: 1,
      type: 'constructor' as const,
      id: ['langchain', 'chat_models', 'anthropic', 'ChatAnthropic'],
      kwargs: {},
    }
    const runId = 'run_empty_anthropic_generation_usage_test'
    handler.handleLLMStart(serialized, ['Use raw generation usage'], runId, undefined, {}, undefined, {
      ls_model_name: 'claude-sonnet-4-6',
      ls_provider: 'anthropic',
    })

    const generation = {
      text: 'Response with raw Anthropic usage.',
      message: new AIMessage({
        content: 'Response with raw Anthropic usage.',
        usage_metadata: {} as NonNullable<AIMessage['usage_metadata']>,
        response_metadata: {
          usage: {
            input_tokens: 21,
            output_tokens: 9,
          },
        },
      }),
    } satisfies ChatGeneration

    handler.handleLLMEnd(
      {
        generations: [[generation]],
      },
      runId
    )

    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls
    expect(captureCall[0].properties['$ai_input_tokens']).toBe(21)
    expect(captureCall[0].properties['$ai_output_tokens']).toBe(9)
  })

  it('should prefer top-level usage for non-Anthropic providers', async () => {
    const serialized = {
      lc: 1,
      type: 'constructor' as const,
      id: ['langchain', 'llms', 'openai', 'OpenAI'],
      kwargs: {},
    }
    const runId = 'run_top_level_usage_precedence_test'
    handler.handleLLMStart(serialized, ['Use top-level usage'], runId, undefined, {}, undefined, {
      ls_model_name: 'gpt-4',
      ls_provider: 'openai',
    })

    const generation = {
      text: 'Response with differing usage sources.',
      message: new AIMessage({
        content: 'Response with differing usage sources.',
        usage_metadata: {
          input_tokens: 999,
          output_tokens: 888,
          total_tokens: 1887,
        },
      }),
    } satisfies ChatGeneration

    handler.handleLLMEnd(
      {
        generations: [[generation]],
        llmOutput: {
          tokenUsage: {
            promptTokens: 100,
            completionTokens: 20,
            totalTokens: 120,
          },
        },
      },
      runId
    )

    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls
    expect(captureCall[0].properties['$ai_input_tokens']).toBe(100)
    expect(captureCall[0].properties['$ai_output_tokens']).toBe(20)
  })

  it('should subtract cache_read_tokens from input_tokens for Anthropic provider', async () => {
    const serialized = {
      lc: 1,
      type: 'constructor' as const,
      id: ['langchain', 'chat_models', 'anthropic', 'ChatAnthropic'],
      kwargs: {},
    }

    const prompts = ['Test with Anthropic caching']
    const runId = 'run_anthropic_cache_test'
    const metadata = { ls_model_name: 'claude-3-sonnet-20240229', ls_provider: 'anthropic' }
    const extraParams = {
      invocation_params: {
        temperature: 0.7,
      },
    }

    handler.handleLLMStart(serialized, prompts, runId, undefined, extraParams, undefined, metadata)

    // For Anthropic, LangChain reports input_tokens as sum of input + cache_read
    // input_tokens=1200 includes 800 cache_read tokens, so actual input is 400
    const llmResult = {
      generations: [
        [
          {
            text: 'Response from Anthropic with caching.',
            message: new AIMessage('Response from Anthropic with caching.'),
          },
        ],
      ],
      llmOutput: {
        tokenUsage: {
          promptTokens: 1200, // Sum of actual input (400) + cache read (800)
          completionTokens: 50,
          totalTokens: 1250,
          prompt_tokens_details: {
            cached_tokens: 800, // 800 tokens read from cache
          },
        },
      },
    }

    handler.handleLLMEnd(llmResult, runId)

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls

    expect(captureCall[0].event).toBe('$ai_generation')
    // Input tokens should be reduced for Anthropic: 1200 - 800 = 400
    expect(captureCall[0].properties['$ai_input_tokens']).toBe(400)
    expect(captureCall[0].properties['$ai_output_tokens']).toBe(50)
    expect(captureCall[0].properties['$ai_cache_read_input_tokens']).toBe(800)
  })

  it('should subtract cache_read_tokens when model name contains "anthropic"', async () => {
    const serialized = {
      lc: 1,
      type: 'constructor' as const,
      id: ['langchain', 'chat_models', 'ChatOpenAI'],
      kwargs: {},
    }

    const prompts = ['Test with Anthropic model via different provider']
    const runId = 'run_anthropic_model_test'
    // Provider might not be "anthropic" but model name contains it
    const metadata = { ls_model_name: 'anthropic/claude-3-opus', ls_provider: 'openrouter' }
    const extraParams = {
      invocation_params: {
        temperature: 0.7,
      },
    }

    handler.handleLLMStart(serialized, prompts, runId, undefined, extraParams, undefined, metadata)

    const llmResult = {
      generations: [
        [
          {
            text: 'Response.',
            message: new AIMessage('Response.'),
          },
        ],
      ],
      llmOutput: {
        tokenUsage: {
          promptTokens: 500,
          completionTokens: 30,
          totalTokens: 530,
          prompt_tokens_details: {
            cached_tokens: 200,
          },
        },
      },
    }

    handler.handleLLMEnd(llmResult, runId)

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls

    expect(captureCall[0].event).toBe('$ai_generation')
    // Should subtract because model name contains "anthropic": 500 - 200 = 300
    expect(captureCall[0].properties['$ai_input_tokens']).toBe(300)
    expect(captureCall[0].properties['$ai_output_tokens']).toBe(30)
    expect(captureCall[0].properties['$ai_cache_read_input_tokens']).toBe(200)
  })

  it('should prevent negative input_tokens for Anthropic when cache_read >= input', async () => {
    const serialized = {
      lc: 1,
      type: 'constructor' as const,
      id: ['langchain', 'chat_models', 'anthropic', 'ChatAnthropic'],
      kwargs: {},
    }

    const prompts = ['Edge case']
    const runId = 'run_anthropic_negative_test'
    const metadata = { ls_model_name: 'claude-3-sonnet', ls_provider: 'anthropic' }
    const extraParams = {
      invocation_params: {
        temperature: 0.7,
      },
    }

    handler.handleLLMStart(serialized, prompts, runId, undefined, extraParams, undefined, metadata)

    // Edge case: cache_read >= input_tokens
    const llmResult = {
      generations: [
        [
          {
            text: 'Response.',
            message: new AIMessage('Response.'),
          },
        ],
      ],
      llmOutput: {
        tokenUsage: {
          promptTokens: 100,
          completionTokens: 20,
          totalTokens: 120,
          prompt_tokens_details: {
            cached_tokens: 150, // More than promptTokens
          },
        },
      },
    }

    handler.handleLLMEnd(llmResult, runId)

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls

    expect(captureCall[0].event).toBe('$ai_generation')
    // Should be max(100 - 150, 0) = 0
    expect(captureCall[0].properties['$ai_input_tokens']).toBe(0)
    expect(captureCall[0].properties['$ai_output_tokens']).toBe(20)
    expect(captureCall[0].properties['$ai_cache_read_input_tokens']).toBe(150)
  })

  it('should subtract cache_creation_input_tokens from input_tokens for Anthropic provider', async () => {
    const serialized = {
      lc: 1,
      type: 'constructor' as const,
      id: ['langchain', 'chat_models', 'anthropic', 'ChatAnthropic'],
      kwargs: {},
    }

    const prompts = ['Test with Anthropic cache write']
    const runId = 'run_anthropic_cache_write_test'
    const metadata = { ls_model_name: 'claude-3-sonnet-20240229', ls_provider: 'anthropic' }
    const extraParams = {
      invocation_params: {
        temperature: 0.7,
      },
    }

    handler.handleLLMStart(serialized, prompts, runId, undefined, extraParams, undefined, metadata)

    // For Anthropic, LangChain reports input_tokens as sum of input + cache_creation
    // input_tokens=1000 includes 800 cache_creation tokens, so actual uncached input is 200
    const llmResult = {
      generations: [
        [
          {
            text: 'Response from Anthropic with cache creation.',
            message: new AIMessage('Response from Anthropic with cache creation.'),
          },
        ],
      ],
      llmOutput: {
        tokenUsage: {
          promptTokens: 1000, // Sum of actual uncached input (200) + cache creation (800)
          completionTokens: 50,
          totalTokens: 1050,
          cache_creation_input_tokens: 800, // 800 tokens written to cache
        },
      },
    }

    handler.handleLLMEnd(llmResult, runId)

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls

    expect(captureCall[0].event).toBe('$ai_generation')
    // Input tokens should be reduced for Anthropic: 1000 - 800 = 200
    expect(captureCall[0].properties['$ai_input_tokens']).toBe(200)
    expect(captureCall[0].properties['$ai_output_tokens']).toBe(50)
    expect(captureCall[0].properties['$ai_cache_creation_input_tokens']).toBe(800)
    expect(captureCall[0].properties['$ai_cache_creation_5m_input_tokens']).toBeUndefined()
    expect(captureCall[0].properties['$ai_cache_creation_1h_input_tokens']).toBeUndefined()
  })

  it('should subtract both cache_read and cache_creation tokens for Anthropic', async () => {
    const serialized = {
      lc: 1,
      type: 'constructor' as const,
      id: ['langchain', 'chat_models', 'anthropic', 'ChatAnthropic'],
      kwargs: {},
    }

    const prompts = ['Test with Anthropic cache read and write']
    const runId = 'run_anthropic_cache_both_test'
    const metadata = { ls_model_name: 'claude-3-sonnet-20240229', ls_provider: 'anthropic' }
    const extraParams = {
      invocation_params: {
        temperature: 0.7,
      },
    }

    handler.handleLLMStart(serialized, prompts, runId, undefined, extraParams, undefined, metadata)

    // For Anthropic, LangChain reports input_tokens as sum of all tokens
    // input_tokens=2000 includes 800 cache_read + 500 cache_creation, so uncached is 700
    const llmResult = {
      generations: [
        [
          {
            text: 'Response from Anthropic with both cache operations.',
            message: new AIMessage('Response from Anthropic with both cache operations.'),
          },
        ],
      ],
      llmOutput: {
        tokenUsage: {
          promptTokens: 2000, // Sum of uncached (700) + cache read (800) + cache creation (500)
          completionTokens: 50,
          totalTokens: 2050,
          prompt_tokens_details: {
            cached_tokens: 800, // 800 tokens read from cache
          },
          cache_creation_input_tokens: 500, // 500 tokens written to cache
        },
      },
    }

    handler.handleLLMEnd(llmResult, runId)

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls

    expect(captureCall[0].event).toBe('$ai_generation')
    // Input tokens should be reduced for Anthropic: 2000 - 800 - 500 = 700
    expect(captureCall[0].properties['$ai_input_tokens']).toBe(700)
    expect(captureCall[0].properties['$ai_output_tokens']).toBe(50)
    expect(captureCall[0].properties['$ai_cache_read_input_tokens']).toBe(800)
    expect(captureCall[0].properties['$ai_cache_creation_input_tokens']).toBe(500)
  })

  it('should preserve Anthropic cache creation TTLs from LangChain response metadata', async () => {
    const serialized = {
      lc: 1,
      type: 'constructor' as const,
      id: ['langchain', 'chat_models', 'anthropic', 'ChatAnthropic'],
      kwargs: {},
    }

    const runId = 'run_anthropic_cache_ttl_test'
    const metadata = { ls_model_name: 'claude-sonnet-4-6', ls_provider: 'anthropic' }
    handler.handleLLMStart(serialized, ['Use the cached context'], runId, undefined, {}, undefined, metadata)

    const llmResult = {
      generations: [
        [
          {
            text: 'Response from Anthropic with cache creation TTLs.',
            message: new AIMessage({
              content: 'Response from Anthropic with cache creation TTLs.',
              response_metadata: {
                usage: {
                  input_tokens: 18,
                  output_tokens: 50,
                  cache_creation_input_tokens: 300,
                  cache_read_input_tokens: 0,
                  cache_creation: {
                    ephemeral_5m_input_tokens: 100,
                    ephemeral_1h_input_tokens: 200,
                  },
                },
              },
              usage_metadata: {
                input_tokens: 318,
                output_tokens: 50,
                total_tokens: 368,
                input_token_details: {
                  cache_creation: 300,
                  cache_read: 0,
                },
              },
            }),
          },
        ],
      ],
    }

    handler.handleLLMEnd(llmResult, runId)

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls

    expect(captureCall[0].properties['$ai_input_tokens']).toBe(18)
    expect(captureCall[0].properties['$ai_output_tokens']).toBe(50)
    expect(captureCall[0].properties['$ai_cache_creation_input_tokens']).toBe(300)
    expect(captureCall[0].properties['$ai_cache_creation_5m_input_tokens']).toBe(100)
    expect(captureCall[0].properties['$ai_cache_creation_1h_input_tokens']).toBe(200)
  })

  it('should keep the Anthropic aggregate when the direct TTL breakdown does not match', async () => {
    const serialized = {
      lc: 1,
      type: 'constructor' as const,
      id: ['langchain', 'chat_models', 'anthropic', 'ChatAnthropic'],
      kwargs: {},
    }

    const runId = 'run_anthropic_cache_ttl_mismatch_test'
    const metadata = { ls_model_name: 'claude-sonnet-4-6', ls_provider: 'anthropic' }
    handler.handleLLMStart(serialized, ['Use the cached context'], runId, undefined, {}, undefined, metadata)

    const llmResult = {
      generations: [
        [
          {
            text: 'Response from Anthropic with mismatched cache creation TTLs.',
            message: new AIMessage({
              content: 'Response from Anthropic with mismatched cache creation TTLs.',
              response_metadata: {
                usage: {
                  input_tokens: 18,
                  output_tokens: 50,
                  cache_creation_input_tokens: 300,
                  cache_read_input_tokens: 0,
                  cache_creation: {
                    ephemeral_5m_input_tokens: 100,
                    ephemeral_1h_input_tokens: 100,
                  },
                },
              },
              usage_metadata: {
                input_tokens: 318,
                output_tokens: 50,
                total_tokens: 368,
                input_token_details: {
                  cache_creation: 300,
                  cache_read: 0,
                },
              },
            }),
          },
        ],
      ],
    }

    handler.handleLLMEnd(llmResult, runId)

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls

    expect(captureCall[0].properties['$ai_input_tokens']).toBe(18)
    expect(captureCall[0].properties['$ai_output_tokens']).toBe(50)
    expect(captureCall[0].properties['$ai_cache_creation_input_tokens']).toBe(300)
    expect(captureCall[0].properties['$ai_cache_creation_5m_input_tokens']).toBeUndefined()
    expect(captureCall[0].properties['$ai_cache_creation_1h_input_tokens']).toBeUndefined()
  })

  it('should not subtract cache creation twice from raw Anthropic usage', async () => {
    const serialized = {
      lc: 1,
      type: 'constructor' as const,
      id: ['langchain', 'chat_models', 'anthropic', 'ChatAnthropic'],
      kwargs: {},
    }

    const runId = 'run_anthropic_raw_cache_ttl_test'
    const metadata = { ls_model_name: 'claude-sonnet-4-6', ls_provider: 'anthropic' }
    handler.handleLLMStart(serialized, ['Use the cached context'], runId, undefined, {}, undefined, metadata)

    const rawUsage = {
      input_tokens: 18,
      output_tokens: 50,
      cache_creation_input_tokens: 300,
      cache_read_input_tokens: 0,
      cache_creation: {
        ephemeral_5m_input_tokens: 100,
        ephemeral_1h_input_tokens: 200,
      },
    }
    const llmResult = {
      generations: [
        [
          {
            text: 'Response from Anthropic with cache creation TTLs.',
            message: new AIMessage({
              content: 'Response from Anthropic with cache creation TTLs.',
              response_metadata: { usage: rawUsage },
              usage_metadata: {
                input_tokens: 318,
                output_tokens: 50,
                total_tokens: 368,
                input_token_details: {
                  cache_creation: 300,
                  cache_read: 0,
                },
              },
            }),
          },
        ],
      ],
      llmOutput: { usage: rawUsage },
    }

    handler.handleLLMEnd(llmResult, runId)

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls

    expect(captureCall[0].properties['$ai_input_tokens']).toBe(18)
    expect(captureCall[0].properties['$ai_output_tokens']).toBe(50)
    expect(captureCall[0].properties['$ai_cache_creation_input_tokens']).toBe(300)
    expect(captureCall[0].properties['$ai_cache_creation_5m_input_tokens']).toBe(100)
    expect(captureCall[0].properties['$ai_cache_creation_1h_input_tokens']).toBe(200)
  })

  it('should preserve Anthropic cache creation TTLs from Bedrock Converse response metadata', async () => {
    const serialized = {
      lc: 1,
      type: 'constructor' as const,
      id: ['langchain', 'chat_models', 'bedrock', 'ChatBedrockConverse'],
      kwargs: {},
    }

    const runId = 'run_bedrock_converse_cache_ttl_test'
    const metadata = {
      ls_model_name: 'us.anthropic.claude-sonnet-4-6-v1:0',
      ls_provider: 'amazon_bedrock',
    }
    handler.handleLLMStart(serialized, ['Use the cached context'], runId, undefined, {}, undefined, metadata)

    const llmResult = {
      generations: [
        [
          {
            text: 'Response from Bedrock Converse with cache creation TTLs.',
            message: new AIMessage({
              content: 'Response from Bedrock Converse with cache creation TTLs.',
              response_metadata: {
                usage: {
                  inputTokens: 18,
                  outputTokens: 50,
                  cacheWriteInputTokens: 300,
                  cacheReadInputTokens: 0,
                  cacheDetails: [
                    { ttl: '5m', inputTokens: 100 },
                    { ttl: '1h', inputTokens: 200 },
                  ],
                },
              },
              usage_metadata: {
                input_tokens: 318,
                output_tokens: 50,
                total_tokens: 368,
                input_token_details: {
                  cache_creation: 300,
                  cache_read: 0,
                },
              },
            }),
          },
        ],
      ],
    }

    handler.handleLLMEnd(llmResult, runId)

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls

    expect(captureCall[0].properties['$ai_input_tokens']).toBe(18)
    expect(captureCall[0].properties['$ai_output_tokens']).toBe(50)
    expect(captureCall[0].properties['$ai_cache_creation_input_tokens']).toBe(300)
    expect(captureCall[0].properties['$ai_cache_creation_5m_input_tokens']).toBe(100)
    expect(captureCall[0].properties['$ai_cache_creation_1h_input_tokens']).toBe(200)
  })

  it('should preserve Anthropic cache creation TTLs from aggregated Bedrock Converse stream metadata', async () => {
    const serialized = {
      lc: 1,
      type: 'constructor' as const,
      id: ['langchain', 'chat_models', 'bedrock', 'ChatBedrockConverse'],
      kwargs: {},
    }

    const runId = 'run_bedrock_converse_stream_cache_ttl_test'
    const metadata = {
      ls_model_name: 'us.anthropic.claude-sonnet-4-6-v1:0',
      ls_provider: 'amazon_bedrock',
    }
    handler.handleLLMStart(serialized, ['Use the cached context'], runId, undefined, {}, undefined, metadata)

    const llmResult = {
      generations: [
        [
          {
            text: 'Streamed response from Bedrock Converse with cache creation TTLs.',
            message: new AIMessage({
              content: 'Streamed response from Bedrock Converse with cache creation TTLs.',
              response_metadata: {
                metadata: {
                  usage: {
                    inputTokens: 18,
                    outputTokens: 50,
                    cacheWriteInputTokens: 300,
                    cacheReadInputTokens: 0,
                    cacheDetails: [
                      { ttl: '5m', inputTokens: 100 },
                      { ttl: '1h', inputTokens: 200 },
                    ],
                  },
                },
              },
              usage_metadata: {
                input_tokens: 318,
                output_tokens: 50,
                total_tokens: 368,
                input_token_details: {
                  cache_creation: 300,
                  cache_read: 0,
                },
              },
            }),
          },
        ],
      ],
    }

    handler.handleLLMEnd(llmResult, runId)

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls

    expect(captureCall[0].properties['$ai_input_tokens']).toBe(18)
    expect(captureCall[0].properties['$ai_output_tokens']).toBe(50)
    expect(captureCall[0].properties['$ai_cache_creation_input_tokens']).toBe(300)
    expect(captureCall[0].properties['$ai_cache_creation_5m_input_tokens']).toBe(100)
    expect(captureCall[0].properties['$ai_cache_creation_1h_input_tokens']).toBe(200)
  })

  describe('Bedrock usage source selection', () => {
    const captureBedrockUsage = (generations: ChatGeneration[][], runId: string): Record<string, unknown> => {
      handler.handleLLMStart(
        {
          lc: 1,
          type: 'constructor' as const,
          id: ['langchain', 'chat_models', 'bedrock', 'ChatBedrockConverse'],
          kwargs: {},
        },
        ['Test Bedrock usage'],
        runId,
        undefined,
        {},
        undefined,
        {
          ls_model_name: 'us.anthropic.claude-sonnet-4-6-v1:0',
          ls_provider: 'amazon_bedrock',
        }
      )

      handler.handleLLMEnd({ generations }, runId)

      expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
      return (mockPostHogClient.capture as jest.Mock).mock.calls[0][0].properties
    }

    it('falls back to Bedrock invocation metrics when raw usage is empty', () => {
      const properties = captureBedrockUsage(
        [
          [
            {
              text: 'Response from Bedrock.',
              message: new AIMessage({
                content: 'Response from Bedrock.',
                response_metadata: {
                  usage: {},
                  'amazon-bedrock-invocationMetrics': {
                    inputTokenCount: 21,
                    outputTokenCount: 9,
                  },
                },
              }),
            },
          ],
        ],
        'run_bedrock_empty_raw_usage'
      )

      expect(properties['$ai_input_tokens']).toBe(21)
      expect(properties['$ai_output_tokens']).toBe(9)
    })

    it('uses later valid metadata when an earlier source in the same generation is empty', () => {
      const properties = captureBedrockUsage(
        [
          [
            {
              text: 'Response from Bedrock.',
              message: new AIMessage({
                content: 'Response from Bedrock.',
                response_metadata: {
                  usage: {},
                  metadata: {
                    usage: {
                      inputTokenCount: 34,
                      outputTokenCount: 12,
                    },
                  },
                },
              }),
            },
          ],
        ],
        'run_bedrock_later_metadata_usage'
      )

      expect(properties['$ai_input_tokens']).toBe(34)
      expect(properties['$ai_output_tokens']).toBe(12)
    })

    it('uses generation metadata when message usage metadata is empty', () => {
      const properties = captureBedrockUsage(
        [
          [
            {
              text: 'Response from Bedrock.',
              generationInfo: {
                usage_metadata: {
                  input_tokens: 321,
                  output_tokens: 8,
                  total_tokens: 329,
                  input_token_details: {
                    cache_creation: 300,
                    cache_read: 0,
                  },
                },
                response_metadata: {
                  usage: {
                    cache_creation_input_tokens: 300,
                    cache_creation: {
                      ephemeral_5m_input_tokens: 100,
                      ephemeral_1h_input_tokens: 200,
                    },
                  },
                },
              },
              message: new AIMessage({
                content: 'Response from Bedrock.',
                usage_metadata: {} as NonNullable<AIMessage['usage_metadata']>,
              }),
            },
          ],
        ],
        'run_bedrock_generation_usage_metadata'
      )

      expect(properties['$ai_input_tokens']).toBe(21)
      expect(properties['$ai_output_tokens']).toBe(8)
      expect(properties['$ai_cache_creation_input_tokens']).toBe(300)
      expect(properties['$ai_cache_creation_5m_input_tokens']).toBe(100)
      expect(properties['$ai_cache_creation_1h_input_tokens']).toBe(200)
    })

    it('uses valid usage from a later generation when an earlier generation is empty', () => {
      const properties = captureBedrockUsage(
        [
          [
            {
              text: 'Partial response from Bedrock.',
              message: new AIMessage({
                content: 'Partial response from Bedrock.',
                response_metadata: { usage: {} },
              }),
            },
          ],
          [
            {
              text: 'Final response from Bedrock.',
              message: new AIMessage({
                content: 'Final response from Bedrock.',
                response_metadata: {
                  usage: {
                    inputTokenCount: 55,
                    outputTokenCount: 17,
                  },
                },
              }),
            },
          ],
        ],
        'run_bedrock_later_generation_usage'
      )

      expect(properties['$ai_input_tokens']).toBe(55)
      expect(properties['$ai_output_tokens']).toBe(17)
    })

    it('uses valid Bedrock invocation metrics after an empty earlier fallback', () => {
      const properties = captureBedrockUsage(
        [
          [
            {
              text: 'Partial response from Bedrock.',
              message: new AIMessage({
                content: 'Partial response from Bedrock.',
                response_metadata: {
                  'amazon-bedrock-invocationMetrics': {},
                },
              }),
            },
          ],
          [
            {
              text: 'Final response from Bedrock.',
              message: new AIMessage({
                content: 'Final response from Bedrock.',
                response_metadata: {
                  'amazon-bedrock-invocationMetrics': {
                    inputTokenCount: 89,
                    outputTokenCount: 23,
                  },
                },
              }),
            },
          ],
        ],
        'run_bedrock_later_invocation_metrics'
      )

      expect(properties['$ai_input_tokens']).toBe(89)
      expect(properties['$ai_output_tokens']).toBe(23)
    })

    it('keeps explicit zero-valued usage ahead of lower-priority fallback metrics', () => {
      const properties = captureBedrockUsage(
        [
          [
            {
              text: 'Response from Bedrock.',
              message: new AIMessage({
                content: 'Response from Bedrock.',
                response_metadata: {
                  usage: {
                    inputTokenCount: 0,
                    outputTokenCount: 0,
                  },
                  'amazon-bedrock-invocationMetrics': {
                    inputTokenCount: 21,
                    outputTokenCount: 9,
                  },
                },
              }),
            },
          ],
        ],
        'run_bedrock_explicit_zero_usage'
      )

      expect(properties['$ai_input_tokens']).toBe(0)
      expect(properties['$ai_output_tokens']).toBe(0)
    })
  })

  it.each([
    {
      name: 'sums repeated buckets and accepts AWS SDK enum values',
      aggregate: 300,
      cacheDetails: [
        { ttl: 'T5M', inputTokens: 40 },
        { ttl: 't5m', inputTokens: 60 },
        { ttl: 'T1H', inputTokens: 200 },
      ],
      expected5m: 100,
      expected1h: 200,
    },
    {
      name: 'fills the missing bucket when one TTL is reported',
      aggregate: 200,
      cacheDetails: [{ ttl: '1h', inputTokens: 200 }],
      expected5m: 0,
      expected1h: 200,
    },
    {
      name: 'keeps aggregate-only fallback when valid details do not match it',
      aggregate: 300,
      cacheDetails: [
        { ttl: '5m', inputTokens: 100 },
        { ttl: '1h', inputTokens: 100 },
        { ttl: 'unknown', inputTokens: 100 },
        { ttl: '5m', inputTokens: -1 },
        { ttl: '1h', inputTokens: Number.NaN },
      ],
      expected5m: undefined,
      expected1h: undefined,
    },
  ])('$name', async ({ aggregate, cacheDetails, expected5m, expected1h }) => {
    const serialized = {
      lc: 1,
      type: 'constructor' as const,
      id: ['langchain', 'chat_models', 'bedrock', 'ChatBedrockConverse'],
      kwargs: {},
    }
    const runId = `run_bedrock_cache_details_${aggregate}_${expected5m ?? 'fallback'}`
    handler.handleLLMStart(serialized, ['Use the cached context'], runId, undefined, {}, undefined, {
      ls_model_name: 'us.anthropic.claude-sonnet-4-6-v1:0',
      ls_provider: 'amazon_bedrock',
    })

    const generation = {
      text: 'Response from Bedrock Converse.',
      message: new AIMessage({
        content: 'Response from Bedrock Converse.',
        response_metadata: {
          usage: {
            inputTokens: 18,
            outputTokens: 50,
            cacheWriteInputTokens: aggregate,
            cacheDetails,
          },
        },
        usage_metadata: {
          input_tokens: 18 + aggregate,
          output_tokens: 50,
          total_tokens: 68 + aggregate,
          input_token_details: { cache_creation: aggregate },
        },
      }),
    } satisfies ChatGeneration

    handler.handleLLMEnd(
      {
        generations: [[generation]],
      },
      runId
    )

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls
    expect(captureCall[0].properties['$ai_input_tokens']).toBe(18)
    expect(captureCall[0].properties['$ai_cache_creation_input_tokens']).toBe(aggregate)
    expect(captureCall[0].properties['$ai_cache_creation_5m_input_tokens']).toBe(expected5m)
    expect(captureCall[0].properties['$ai_cache_creation_1h_input_tokens']).toBe(expected1h)
  })

  it('should not subtract cache_creation_input_tokens for non-Anthropic providers', async () => {
    const serialized = {
      lc: 1,
      type: 'constructor' as const,
      id: ['langchain', 'chat_models', 'openai', 'ChatOpenAI'],
      kwargs: {},
    }

    const prompts = ['Test with OpenAI cache write']
    const runId = 'run_openai_cache_write_test'
    const metadata = { ls_model_name: 'gpt-4', ls_provider: 'openai' }
    const extraParams = {
      invocation_params: {
        temperature: 0.7,
      },
    }

    handler.handleLLMStart(serialized, prompts, runId, undefined, extraParams, undefined, metadata)

    // For OpenAI, input_tokens is already separate from cache tokens
    const llmResult = {
      generations: [
        [
          {
            text: 'Response from OpenAI with cache creation.',
            message: new AIMessage('Response from OpenAI with cache creation.'),
          },
        ],
      ],
      llmOutput: {
        tokenUsage: {
          promptTokens: 200, // Just the uncached tokens
          completionTokens: 50,
          totalTokens: 250,
          input_token_details: {
            cache_creation: 800, // OpenAI format for cache write
          },
        },
      },
    }

    handler.handleLLMEnd(llmResult, runId)

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls

    expect(captureCall[0].event).toBe('$ai_generation')
    // Input tokens should NOT be reduced for OpenAI
    expect(captureCall[0].properties['$ai_input_tokens']).toBe(200)
    expect(captureCall[0].properties['$ai_output_tokens']).toBe(50)
    expect(captureCall[0].properties['$ai_cache_creation_input_tokens']).toBe(800)
  })
})

describe('LangChainCallbackHandler span naming', () => {
  it('names a tool span from runName rather than the serialized class', () => {
    const handler = new LangChainCallbackHandler({ client: mockPostHogClient })
    jest.clearAllMocks()

    const serialized = {
      lc: 1,
      type: 'constructor' as const,
      id: ['langchain', 'tools', 'DynamicStructuredTool'],
      kwargs: {},
    }
    const runId = 'run_tool_name'

    // LangChain calls this with (tool, input, runId, parentRunId, tags, metadata, runName)
    handler.handleToolStart(serialized, '{"city":"Paris"}', runId, 'parent_run', [], {}, 'get_weather')
    handler.handleToolEnd('sunny', runId, 'parent_run')

    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls
    expect(captureCall[0].event).toBe('$ai_span')
    expect(captureCall[0].properties['$ai_span_name']).toBe('get_weather')
  })
})

describe('LangChainCallbackHandler trace/span state sanitization', () => {
  it('redacts base64 data URLs from $ai_input_state and $ai_output_state', () => {
    const handler = new LangChainCallbackHandler({ client: mockPostHogClient })
    jest.clearAllMocks()

    const dataUrl = 'data:image/jpeg;base64,' + 'A'.repeat(2000)
    const serialized = {
      lc: 1,
      type: 'constructor' as const,
      id: ['langchain', 'schema', 'runnable', 'RunnableSequence'],
      kwargs: {},
    }
    const runId = 'run_chain_redact'

    handler.handleChainStart(
      serialized,
      {
        messages: [
          {
            content: [
              { type: 'text', text: 'describe this image' },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      } as any,
      runId
    )
    handler.handleChainEnd({ echoed: dataUrl, parsed: { title: 'ok' } }, runId)

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls
    expect(captureCall[0].event).toBe('$ai_trace')

    const inputState = JSON.stringify(captureCall[0].properties['$ai_input_state'])
    expect(inputState).toContain('describe this image')
    expect(inputState).toContain('[base64 image/jpeg redacted]')
    expect(inputState).not.toContain('AAAAAAAA')

    const outputState = JSON.stringify(captureCall[0].properties['$ai_output_state'])
    expect(outputState).toContain('ok')
    expect(outputState).toContain('[base64 image/jpeg redacted]')
    expect(outputState).not.toContain('AAAAAAAA')
  })

  it('preserves base64 data URLs in a $ai_span input/output state when full AI capture is enabled', () => {
    const fullCaptureClient = {
      capture: jest.fn(),
      enableFullAiCapture: true,
    } as unknown as PostHog
    const handler = new LangChainCallbackHandler({ client: fullCaptureClient })

    const dataUrl = 'data:image/jpeg;base64,' + 'A'.repeat(2000)
    const serialized = {
      lc: 1,
      type: 'constructor' as const,
      id: ['langchain', 'schema', 'runnable', 'RunnableSequence'],
      kwargs: {},
    }
    const runId = 'run_span_full_capture'
    const parentRunId = 'parent_run_full_capture'

    handler.handleChainStart(
      serialized,
      {
        messages: [
          {
            content: [
              { type: 'text', text: 'describe this image' },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      } as any,
      runId,
      parentRunId
    )
    handler.handleChainEnd({ echoed: dataUrl, parsed: { title: 'ok' } }, runId, parentRunId)

    expect(fullCaptureClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (fullCaptureClient.capture as jest.Mock).mock.calls
    expect(captureCall[0].event).toBe('$ai_span')

    const inputState = JSON.stringify(captureCall[0].properties['$ai_input_state'])
    expect(inputState).toContain(dataUrl)
    expect(inputState).not.toContain('redacted')

    const outputState = JSON.stringify(captureCall[0].properties['$ai_output_state'])
    expect(outputState).toContain(dataUrl)
    expect(outputState).not.toContain('redacted')
  })
})

describe('LangChainCallbackHandler LangGraph interrupts', () => {
  const serializedChain = {
    lc: 1,
    type: 'constructor' as const,
    id: ['langgraph', 'pregel', 'CompiledStateGraph'],
    kwargs: {},
  }
  const serializedTool = {
    lc: 1,
    type: 'constructor' as const,
    id: ['langchain', 'tools', 'DynamicStructuredTool'],
    kwargs: {},
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  // Mirror LangGraph's error hierarchy: control-flow exceptions expose `is_bubble_up` as a
  // prototype getter (class getters compile to the prototype), and GraphInterrupt carries the
  // pending interrupts as an own property.
  class FakeGraphBubbleUp extends Error {
    constructor(name: string) {
      super('LangGraph control flow')
      this.name = name
    }
    get is_bubble_up(): boolean {
      return true
    }
  }

  class FakeGraphInterrupt extends FakeGraphBubbleUp {
    interrupts: { value: unknown; id: string }[]
    constructor(name: 'GraphInterrupt' | 'NodeInterrupt') {
      super(name)
      this.interrupts = [{ value: 'Approve the plan?', id: 'interrupt-1' }]
    }
  }

  it('captures a GraphInterrupt chain without error properties, keeping the interrupt payload', () => {
    const handler = new LangChainCallbackHandler({ client: mockPostHogClient })
    const runId = 'graph-interrupt-chain'
    const interrupt = new FakeGraphInterrupt('GraphInterrupt')

    handler.handleChainStart(serializedChain, { messages: [] }, runId)
    handler.handleChainError(interrupt, runId)

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls
    expect(captureCall[0]).toMatchObject({
      event: '$ai_trace',
      properties: {
        $ai_span_id: runId,
      },
    })
    expect(captureCall[0].properties).not.toHaveProperty('$ai_error')
    expect(captureCall[0].properties).not.toHaveProperty('$ai_is_error')
    expect(captureCall[0].properties['$ai_output_state']).toEqual({ __interrupt__: interrupt.interrupts })
    expect(captureCall[0].properties['$ai_input_state']).toEqual({ messages: [] })
    expect(captureCall[0].properties['$ai_span_name']).toBe('CompiledStateGraph')
    expect(captureCall[0].properties['$ai_latency']).toBeGreaterThanOrEqual(0)
  })

  it('captures a GraphInterrupt tool without error properties, keeping the interrupt payload', () => {
    const handler = new LangChainCallbackHandler({ client: mockPostHogClient })
    const runId = 'graph-interrupt-tool'
    const interrupt = new FakeGraphInterrupt('GraphInterrupt')

    handler.handleToolStart(serializedTool, '{"action":"approve"}', runId, 'parent-run')
    handler.handleToolError(interrupt, runId, 'parent-run')

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls
    expect(captureCall[0]).toMatchObject({
      event: '$ai_span',
      properties: {
        $ai_span_id: runId,
      },
    })
    expect(captureCall[0].properties).not.toHaveProperty('$ai_error')
    expect(captureCall[0].properties).not.toHaveProperty('$ai_is_error')
    expect(captureCall[0].properties['$ai_output_state']).toEqual({ __interrupt__: interrupt.interrupts })
    expect(captureCall[0].properties['$ai_input_state']).toEqual('{"action":"approve"}')
    expect(captureCall[0].properties['$ai_span_name']).toBe('DynamicStructuredTool')
    expect(captureCall[0].properties['$ai_latency']).toBeGreaterThanOrEqual(0)
  })

  it('captures a legacy NodeInterrupt without error properties', () => {
    const handler = new LangChainCallbackHandler({ client: mockPostHogClient })
    const runId = 'node-interrupt-chain'

    handler.handleChainStart(serializedChain, { messages: [] }, runId)
    handler.handleChainError(new FakeGraphInterrupt('NodeInterrupt'), runId)

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls
    expect(captureCall[0].properties).not.toHaveProperty('$ai_error')
    expect(captureCall[0].properties).not.toHaveProperty('$ai_is_error')
  })

  it('captures other bubble-up control flow (e.g. ParentCommand) without error properties', () => {
    const handler = new LangChainCallbackHandler({ client: mockPostHogClient })
    const runId = 'parent-command-chain'

    handler.handleChainStart(serializedChain, { messages: [] }, runId)
    handler.handleChainError(new FakeGraphBubbleUp('ParentCommand'), runId)

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls
    expect(captureCall[0].properties).not.toHaveProperty('$ai_error')
    expect(captureCall[0].properties).not.toHaveProperty('$ai_is_error')
    expect(captureCall[0].properties).not.toHaveProperty('$ai_output_state')
  })

  it('preserves ordinary chain errors', () => {
    const handler = new LangChainCallbackHandler({ client: mockPostHogClient })
    const runId = 'failed-chain'

    handler.handleChainStart(serializedChain, { messages: [] }, runId)
    handler.handleChainError(new Error('model invocation failed'), runId)

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureCall] = (mockPostHogClient.capture as jest.Mock).mock.calls
    expect(captureCall[0].properties['$ai_is_error']).toBe(true)
    expect(captureCall[0].properties['$ai_error']).toContain('model invocation failed')
    expect(captureCall[0].properties).not.toHaveProperty('$ai_output_state')
  })
})
