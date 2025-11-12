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

  it('should subtract cache_read_tokens from input_tokens (standard case)', async () => {
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
    // input_tokens=150 includes 100 cache_read tokens, so actual input is 50
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
          promptTokens: 150, // Total includes cache reads
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
    // Input tokens should be reduced: 150 - 100 = 50
    expect(captureCall[0].properties['$ai_input_tokens']).toBe(50)
    expect(captureCall[0].properties['$ai_output_tokens']).toBe(40)
    expect(captureCall[0].properties['$ai_cache_read_tokens']).toBe(100)
  })

  it('should prevent negative input_tokens when cache_read_tokens >= input_tokens', async () => {
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
    // Input tokens should be 0, not negative: max(80 - 100, 0) = 0
    expect(captureCall[0].properties['$ai_input_tokens']).toBe(0)
    expect(captureCall[0].properties['$ai_output_tokens']).toBe(20)
    expect(captureCall[0].properties['$ai_cache_read_tokens']).toBe(100)
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
    expect(captureCall[0].properties['$ai_cache_read_tokens']).toBe(50)
  })
})
