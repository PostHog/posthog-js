import { OpenAI as OpenAIOrignal, ClientOptions } from 'openai'
import { PostHog } from 'posthog-node'
import { v4 as uuidv4 } from 'uuid'
import {
  formatResponseOpenAI,
  MonitoringParams,
  sendEventToPosthog,
  extractAvailableToolCalls,
  withPrivacyMode,
} from '../utils'
import type { APIPromise } from 'openai'
import type { Stream } from 'openai/streaming'
import type { ParsedResponse } from 'openai/resources/responses/responses'
import type { FormattedMessage, FormattedContent, FormattedFunctionCall } from '../types'
import { sanitizeOpenAI, sanitizeOpenAIResponse } from '../sanitization'

const Chat = OpenAIOrignal.Chat
const Completions = Chat.Completions
const Responses = OpenAIOrignal.Responses
const Embeddings = OpenAIOrignal.Embeddings

type ChatCompletion = OpenAIOrignal.ChatCompletion
type ChatCompletionChunk = OpenAIOrignal.ChatCompletionChunk
type ChatCompletionCreateParamsBase = OpenAIOrignal.Chat.Completions.ChatCompletionCreateParams
type ChatCompletionCreateParamsNonStreaming = OpenAIOrignal.Chat.Completions.ChatCompletionCreateParamsNonStreaming
type ChatCompletionCreateParamsStreaming = OpenAIOrignal.Chat.Completions.ChatCompletionCreateParamsStreaming
type ResponsesCreateParamsBase = OpenAIOrignal.Responses.ResponseCreateParams
type ResponsesCreateParamsNonStreaming = OpenAIOrignal.Responses.ResponseCreateParamsNonStreaming
type ResponsesCreateParamsStreaming = OpenAIOrignal.Responses.ResponseCreateParamsStreaming
type CreateEmbeddingResponse = OpenAIOrignal.CreateEmbeddingResponse
type EmbeddingCreateParams = OpenAIOrignal.EmbeddingCreateParams

interface MonitoringOpenAIConfig extends ClientOptions {
  apiKey: string
  posthog: PostHog
  baseURL?: string
}

type RequestOptions = Record<string, any>

export class PostHogOpenAI extends OpenAIOrignal {
  private readonly phClient: PostHog
  public chat: WrappedChat
  public responses: WrappedResponses
  public embeddings: WrappedEmbeddings

  constructor(config: MonitoringOpenAIConfig) {
    const { posthog, ...openAIConfig } = config
    super(openAIConfig)
    this.phClient = posthog
    this.chat = new WrappedChat(this, this.phClient)
    this.responses = new WrappedResponses(this, this.phClient)
    this.embeddings = new WrappedEmbeddings(this, this.phClient)
  }
}

export class WrappedChat extends Chat {
  constructor(parentClient: PostHogOpenAI, phClient: PostHog) {
    super(parentClient)
    this.completions = new WrappedCompletions(parentClient, phClient)
  }

  public completions: WrappedCompletions
}

export class WrappedCompletions extends Completions {
  private readonly phClient: PostHog
  private readonly baseURL: string

  constructor(client: OpenAIOrignal, phClient: PostHog) {
    super(client)
    this.phClient = phClient
    this.baseURL = client.baseURL
  }

  // --- Overload #1: Non-streaming
  public create(
    body: ChatCompletionCreateParamsNonStreaming & MonitoringParams,
    options?: RequestOptions
  ): APIPromise<ChatCompletion>

  // --- Overload #2: Streaming
  public create(
    body: ChatCompletionCreateParamsStreaming & MonitoringParams,
    options?: RequestOptions
  ): APIPromise<Stream<ChatCompletionChunk>>

  // --- Overload #3: Generic base
  public create(
    body: ChatCompletionCreateParamsBase & MonitoringParams,
    options?: RequestOptions
  ): APIPromise<ChatCompletion | Stream<ChatCompletionChunk>>

  // --- Implementation Signature
  public create(
    body: ChatCompletionCreateParamsBase & MonitoringParams,
    options?: RequestOptions
  ): APIPromise<ChatCompletion | Stream<ChatCompletionChunk>> {
    const {
      posthogDistinctId,
      posthogTraceId,
      posthogPrivacyMode = false,
      posthogCaptureImmediate,
      ...openAIParams
    } = body

    const traceId = posthogTraceId ?? uuidv4()
    const startTime = Date.now()

    const parentPromise = super.create(openAIParams, options)

    if (openAIParams.stream) {
      return parentPromise.then((value) => {
        if ('tee' in value) {
          const [stream1, stream2] = value.tee()
          ;(async () => {
            try {
              const contentBlocks: FormattedContent = []
              let accumulatedContent = ''
              let usage: {
                inputTokens?: number
                outputTokens?: number
                reasoningTokens?: number
                cacheReadInputTokens?: number
              } = {
                inputTokens: 0,
                outputTokens: 0,
              }

              // Map to track in-progress tool calls
              const toolCallsInProgress = new Map<
                number,
                {
                  id: string
                  name: string
                  arguments: string
                }
              >()

              for await (const chunk of stream1) {
                const choice = chunk?.choices?.[0]

                // Handle text content
                const deltaContent = choice?.delta?.content
                if (deltaContent) {
                  accumulatedContent += deltaContent
                }

                // Handle tool calls
                const deltaToolCalls = choice?.delta?.tool_calls
                if (deltaToolCalls && Array.isArray(deltaToolCalls)) {
                  for (const toolCall of deltaToolCalls) {
                    const index = toolCall.index

                    if (index !== undefined) {
                      if (!toolCallsInProgress.has(index)) {
                        // New tool call
                        toolCallsInProgress.set(index, {
                          id: toolCall.id || '',
                          name: toolCall.function?.name || '',
                          arguments: '',
                        })
                      }

                      const inProgressCall = toolCallsInProgress.get(index)
                      if (inProgressCall) {
                        // Update tool call data
                        if (toolCall.id) {
                          inProgressCall.id = toolCall.id
                        }
                        if (toolCall.function?.name) {
                          inProgressCall.name = toolCall.function.name
                        }
                        if (toolCall.function?.arguments) {
                          inProgressCall.arguments += toolCall.function.arguments
                        }
                      }
                    }
                  }
                }

                // Handle usage information
                if (chunk.usage) {
                  usage = {
                    inputTokens: chunk.usage.prompt_tokens ?? 0,
                    outputTokens: chunk.usage.completion_tokens ?? 0,
                    reasoningTokens: chunk.usage.completion_tokens_details?.reasoning_tokens ?? 0,
                    cacheReadInputTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
                  }
                }
              }

              // Build final content blocks
              if (accumulatedContent) {
                contentBlocks.push({ type: 'text', text: accumulatedContent })
              }

              // Add completed tool calls to content blocks
              for (const toolCall of toolCallsInProgress.values()) {
                if (toolCall.name) {
                  contentBlocks.push({
                    type: 'function',
                    id: toolCall.id,
                    function: {
                      name: toolCall.name,
                      arguments: toolCall.arguments,
                    },
                  } as FormattedFunctionCall)
                }
              }

              // Format output to match non-streaming version
              const formattedOutput: FormattedMessage[] =
                contentBlocks.length > 0
                  ? [
                      {
                        role: 'assistant',
                        content: contentBlocks,
                      },
                    ]
                  : [
                      {
                        role: 'assistant',
                        content: [{ type: 'text', text: '' }],
                      },
                    ]

              const latency = (Date.now() - startTime) / 1000
              const availableTools = extractAvailableToolCalls('openai', openAIParams)
              await sendEventToPosthog({
                client: this.phClient,
                distinctId: posthogDistinctId,
                traceId,
                model: openAIParams.model,
                provider: 'openai',
                input: sanitizeOpenAI(openAIParams.messages),
                output: formattedOutput,
                latency,
                baseURL: this.baseURL,
                params: body,
                httpStatus: 200,
                usage,
                tools: availableTools,
                captureImmediate: posthogCaptureImmediate,
              })
            } catch (error: unknown) {
              const httpStatus =
                error && typeof error === 'object' && 'status' in error
                  ? ((error as { status?: number }).status ?? 500)
                  : 500

              await sendEventToPosthog({
                client: this.phClient,
                distinctId: posthogDistinctId,
                traceId,
                model: openAIParams.model,
                provider: 'openai',
                input: sanitizeOpenAI(openAIParams.messages),
                output: [],
                latency: 0,
                baseURL: this.baseURL,
                params: body,
                httpStatus,
                usage: { inputTokens: 0, outputTokens: 0 },
                isError: true,
                error: JSON.stringify(error),
                captureImmediate: posthogCaptureImmediate,
              })
            }
          })()

          // Return the other stream to the user
          return stream2
        }
        return value
      }) as APIPromise<Stream<ChatCompletionChunk>>
    } else {
      const wrappedPromise = parentPromise.then(
        async (result) => {
          if ('choices' in result) {
            const latency = (Date.now() - startTime) / 1000
            const availableTools = extractAvailableToolCalls('openai', openAIParams)
            await sendEventToPosthog({
              client: this.phClient,
              distinctId: posthogDistinctId,
              traceId,
              model: openAIParams.model,
              provider: 'openai',
              input: sanitizeOpenAI(openAIParams.messages),
              output: formatResponseOpenAI(result),
              latency,
              baseURL: this.baseURL,
              params: body,
              httpStatus: 200,
              usage: {
                inputTokens: result.usage?.prompt_tokens ?? 0,
                outputTokens: result.usage?.completion_tokens ?? 0,
                reasoningTokens: result.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
                cacheReadInputTokens: result.usage?.prompt_tokens_details?.cached_tokens ?? 0,
              },
              tools: availableTools,
              captureImmediate: posthogCaptureImmediate,
            })
          }
          return result
        },
        async (error: unknown) => {
          const httpStatus =
            error && typeof error === 'object' && 'status' in error
              ? ((error as { status?: number }).status ?? 500)
              : 500

          await sendEventToPosthog({
            client: this.phClient,
            distinctId: posthogDistinctId,
            traceId,
            model: openAIParams.model,
            provider: 'openai',
            input: sanitizeOpenAI(openAIParams.messages),
            output: [],
            latency: 0,
            baseURL: this.baseURL,
            params: body,
            httpStatus,
            usage: {
              inputTokens: 0,
              outputTokens: 0,
            },
            isError: true,
            error: JSON.stringify(error),
            captureImmediate: posthogCaptureImmediate,
          })
          throw error
        }
      ) as APIPromise<ChatCompletion>

      return wrappedPromise
    }
  }
}

export class WrappedResponses extends Responses {
  private readonly phClient: PostHog
  private readonly baseURL: string

  constructor(client: OpenAIOrignal, phClient: PostHog) {
    super(client)
    this.phClient = phClient
    this.baseURL = client.baseURL
  }

  // --- Overload #1: Non-streaming
  public create(
    body: ResponsesCreateParamsNonStreaming & MonitoringParams,
    options?: RequestOptions
  ): APIPromise<OpenAIOrignal.Responses.Response>

  // --- Overload #2: Streaming
  public create(
    body: ResponsesCreateParamsStreaming & MonitoringParams,
    options?: RequestOptions
  ): APIPromise<Stream<OpenAIOrignal.Responses.ResponseStreamEvent>>

  // --- Overload #3: Generic base
  public create(
    body: ResponsesCreateParamsBase & MonitoringParams,
    options?: RequestOptions
  ): APIPromise<OpenAIOrignal.Responses.Response | Stream<OpenAIOrignal.Responses.ResponseStreamEvent>>

  // --- Implementation Signature
  public create(
    body: ResponsesCreateParamsBase & MonitoringParams,
    options?: RequestOptions
  ): APIPromise<OpenAIOrignal.Responses.Response | Stream<OpenAIOrignal.Responses.ResponseStreamEvent>> {
    const {
      posthogDistinctId,
      posthogTraceId,
      posthogPrivacyMode = false,
      posthogCaptureImmediate,
      ...openAIParams
    } = body

    const traceId = posthogTraceId ?? uuidv4()
    const startTime = Date.now()

    const parentPromise = super.create(openAIParams, options)

    if (openAIParams.stream) {
      return parentPromise.then((value) => {
        if ('tee' in value && typeof (value as any).tee === 'function') {
          const [stream1, stream2] = (value as any).tee()
          ;(async () => {
            try {
              let finalContent: any[] = []
              let usage: {
                inputTokens?: number
                outputTokens?: number
                reasoningTokens?: number
                cacheReadInputTokens?: number
              } = {
                inputTokens: 0,
                outputTokens: 0,
              }

              for await (const chunk of stream1) {
                if (
                  chunk.type === 'response.completed' &&
                  'response' in chunk &&
                  chunk.response?.output &&
                  chunk.response.output.length > 0
                ) {
                  finalContent = chunk.response.output
                }
                if ('response' in chunk && chunk.response?.usage) {
                  usage = {
                    inputTokens: chunk.response.usage.input_tokens ?? 0,
                    outputTokens: chunk.response.usage.output_tokens ?? 0,
                    reasoningTokens: chunk.response.usage.output_tokens_details?.reasoning_tokens ?? 0,
                    cacheReadInputTokens: chunk.response.usage.input_tokens_details?.cached_tokens ?? 0,
                  }
                }
              }

              const latency = (Date.now() - startTime) / 1000
              const availableTools = extractAvailableToolCalls('openai', openAIParams)
              await sendEventToPosthog({
                client: this.phClient,
                distinctId: posthogDistinctId,
                traceId,
                //@ts-expect-error
                model: openAIParams.model,
                provider: 'openai',
                input: sanitizeOpenAIResponse(openAIParams.input),
                output: finalContent,
                latency,
                baseURL: this.baseURL,
                params: body,
                httpStatus: 200,
                usage,
                tools: availableTools,
                captureImmediate: posthogCaptureImmediate,
              })
            } catch (error: unknown) {
              const httpStatus =
                error && typeof error === 'object' && 'status' in error
                  ? ((error as { status?: number }).status ?? 500)
                  : 500

              await sendEventToPosthog({
                client: this.phClient,
                distinctId: posthogDistinctId,
                traceId,
                //@ts-expect-error
                model: openAIParams.model,
                provider: 'openai',
                input: sanitizeOpenAIResponse(openAIParams.input),
                output: [],
                latency: 0,
                baseURL: this.baseURL,
                params: body,
                httpStatus,
                usage: { inputTokens: 0, outputTokens: 0 },
                isError: true,
                error: JSON.stringify(error),
                captureImmediate: posthogCaptureImmediate,
              })
            }
          })()

          return stream2
        }
        return value
      }) as APIPromise<Stream<OpenAIOrignal.Responses.ResponseStreamEvent>>
    } else {
      const wrappedPromise = parentPromise.then(
        async (result) => {
          if ('output' in result) {
            const latency = (Date.now() - startTime) / 1000
            const availableTools = extractAvailableToolCalls('openai', openAIParams)
            await sendEventToPosthog({
              client: this.phClient,
              distinctId: posthogDistinctId,
              traceId,
              //@ts-expect-error
              model: openAIParams.model,
              provider: 'openai',
              input: sanitizeOpenAIResponse(openAIParams.input),
              output: formatResponseOpenAI({ output: result.output }),
              latency,
              baseURL: this.baseURL,
              params: body,
              httpStatus: 200,
              usage: {
                inputTokens: result.usage?.input_tokens ?? 0,
                outputTokens: result.usage?.output_tokens ?? 0,
                reasoningTokens: result.usage?.output_tokens_details?.reasoning_tokens ?? 0,
                cacheReadInputTokens: result.usage?.input_tokens_details?.cached_tokens ?? 0,
              },
              tools: availableTools,
              captureImmediate: posthogCaptureImmediate,
            })
          }
          return result
        },
        async (error: unknown) => {
          const httpStatus =
            error && typeof error === 'object' && 'status' in error
              ? ((error as { status?: number }).status ?? 500)
              : 500

          await sendEventToPosthog({
            client: this.phClient,
            distinctId: posthogDistinctId,
            traceId,
            //@ts-expect-error
            model: openAIParams.model,
            provider: 'openai',
            input: sanitizeOpenAIResponse(openAIParams.input),
            output: [],
            latency: 0,
            baseURL: this.baseURL,
            params: body,
            httpStatus,
            usage: {
              inputTokens: 0,
              outputTokens: 0,
            },
            isError: true,
            error: JSON.stringify(error),
            captureImmediate: posthogCaptureImmediate,
          })
          throw error
        }
      ) as APIPromise<OpenAIOrignal.Responses.Response>

      return wrappedPromise
    }
  }

  public parse<Params extends ResponsesCreateParamsBase, ParsedT = any>(
    body: Params & MonitoringParams,
    options?: RequestOptions
  ): APIPromise<ParsedResponse<ParsedT>> {
    const {
      posthogDistinctId,
      posthogTraceId,
      posthogPrivacyMode = false,
      posthogCaptureImmediate,
      ...openAIParams
    } = body

    const traceId = posthogTraceId ?? uuidv4()
    const startTime = Date.now()

    // Create a temporary instance that bypasses our wrapped create method
    const originalCreate = super.create.bind(this)
    const originalSelf = this as any
    const tempCreate = originalSelf.create
    originalSelf.create = originalCreate

    try {
      const parentPromise = super.parse(openAIParams, options)

      const wrappedPromise = parentPromise.then(
        async (result) => {
          const latency = (Date.now() - startTime) / 1000
          await sendEventToPosthog({
            client: this.phClient,
            distinctId: posthogDistinctId,
            traceId,
            //@ts-expect-error
            model: openAIParams.model,
            provider: 'openai',
            input: sanitizeOpenAIResponse(openAIParams.input),
            output: result.output,
            latency,
            baseURL: this.baseURL,
            params: body,
            httpStatus: 200,
            usage: {
              inputTokens: result.usage?.input_tokens ?? 0,
              outputTokens: result.usage?.output_tokens ?? 0,
              reasoningTokens: result.usage?.output_tokens_details?.reasoning_tokens ?? 0,
              cacheReadInputTokens: result.usage?.input_tokens_details?.cached_tokens ?? 0,
            },
            captureImmediate: posthogCaptureImmediate,
          })
          return result
        },
        async (error: unknown) => {
          const httpStatus =
            error && typeof error === 'object' && 'status' in error
              ? ((error as { status?: number }).status ?? 500)
              : 500

          await sendEventToPosthog({
            client: this.phClient,
            distinctId: posthogDistinctId,
            traceId,
            //@ts-expect-error
            model: openAIParams.model,
            provider: 'openai',
            input: sanitizeOpenAIResponse(openAIParams.input),
            output: [],
            latency: 0,
            baseURL: this.baseURL,
            params: body,
            httpStatus,
            usage: {
              inputTokens: 0,
              outputTokens: 0,
            },
            isError: true,
            error: JSON.stringify(error),
            captureImmediate: posthogCaptureImmediate,
          })
          throw error
        }
      )

      return wrappedPromise as APIPromise<ParsedResponse<ParsedT>>
    } finally {
      // Restore our wrapped create method
      originalSelf.create = tempCreate
    }
  }
}

export class WrappedEmbeddings extends Embeddings {
  private readonly phClient: PostHog
  private readonly baseURL: string

  constructor(client: OpenAIOrignal, phClient: PostHog) {
    super(client)
    this.phClient = phClient
    this.baseURL = client.baseURL
  }

  public create(
    body: EmbeddingCreateParams & MonitoringParams,
    options?: RequestOptions
  ): APIPromise<CreateEmbeddingResponse> {
    const {
      posthogDistinctId,
      posthogTraceId,
      posthogPrivacyMode = false,
      posthogCaptureImmediate,
      ...openAIParams
    } = body

    const traceId = posthogTraceId ?? uuidv4()
    const startTime = Date.now()

    const parentPromise = super.create(openAIParams, options)

    const wrappedPromise = parentPromise.then(
      async (result) => {
        const latency = (Date.now() - startTime) / 1000
        await sendEventToPosthog({
          client: this.phClient,
          eventType: '$ai_embedding',
          distinctId: posthogDistinctId,
          traceId,
          model: openAIParams.model,
          provider: 'openai',
          input: withPrivacyMode(this.phClient, posthogPrivacyMode, openAIParams.input),
          output: null, // Embeddings don't have output content
          latency,
          baseURL: this.baseURL,
          params: body,
          httpStatus: 200,
          usage: {
            inputTokens: result.usage?.prompt_tokens ?? 0,
          },
          captureImmediate: posthogCaptureImmediate,
        })
        return result
      },
      async (error: unknown) => {
        const httpStatus =
          error && typeof error === 'object' && 'status' in error ? ((error as { status?: number }).status ?? 500) : 500

        await sendEventToPosthog({
          client: this.phClient,
          eventType: '$ai_embedding',
          distinctId: posthogDistinctId,
          traceId,
          model: openAIParams.model,
          provider: 'openai',
          input: withPrivacyMode(this.phClient, posthogPrivacyMode, openAIParams.input),
          output: null, // Embeddings don't have output content
          latency: 0,
          baseURL: this.baseURL,
          params: body,
          httpStatus,
          usage: {
            inputTokens: 0,
          },
          isError: true,
          error: JSON.stringify(error),
          captureImmediate: posthogCaptureImmediate,
        })
        throw error
      }
    ) as APIPromise<CreateEmbeddingResponse>

    return wrappedPromise
  }
}

export default PostHogOpenAI

export { PostHogOpenAI as OpenAI }
