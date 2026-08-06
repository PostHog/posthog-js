import { LangChainCallbackHandler } from '../src/langchain/callbacks'
import { PostHog } from 'posthog-node'
import { AIMessage } from '@langchain/core/messages'
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
