import OpenAIOrignal, { AzureOpenAI } from 'openai'
import { PostHog } from 'posthog-node'
import { AIEvent, formatResponseOpenAI, MonitoringParams, sendEventToPosthog, withPrivacyMode } from '../utils'
import type { APIPromise } from 'openai'
import type { Stream } from 'openai/streaming'
import type { ParsedResponse } from 'openai/resources/responses/responses'
import type { ZodTypeAny } from 'zod'
import type { FormattedMessage, FormattedContent, FormattedFunctionCall } from '../types'
import { extractPosthogParams } from './utils'

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

interface MonitoringOpenAIConfig {
  apiKey: string
  posthog: PostHog
  baseURL?: string
}

type RequestOptions = Record<string, any>

// Local helper to avoid importing Zod's `infer` symbol in d.ts output
type InferZodSchema<SchemaT extends ZodTypeAny> = SchemaT['_output']

export class PostHogAzureOpenAI extends AzureOpenAI {
  private readonly phClient: PostHog
  public chat: WrappedChat
  public embeddings: WrappedEmbeddings

  constructor(config: MonitoringOpenAIConfig) {
    const { posthog, ...openAIConfig } = config
    super(openAIConfig)
    this.phClient = posthog
    this.chat = new WrappedChat(this, this.phClient)
    this.embeddings = new WrappedEmbeddings(this, this.phClient)
  }
}

export class WrappedChat extends AzureOpenAI.Chat {
  constructor(parentClient: PostHogAzureOpenAI, phClient: PostHog) {
    super(parentClient)
    this.completions = new WrappedCompletions(parentClient, phClient)
  }

  public completions: WrappedCompletions
}

export class WrappedCompletions extends AzureOpenAI.Chat.Completions {
  private readonly phClient: PostHog
  private readonly baseURL: string

  constructor(client: AzureOpenAI, phClient: PostHog) {
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
    const { openAIParams, posthogParams } = extractPosthogParams(body)
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
              await sendEventToPosthog({
                client: this.phClient,
                ...posthogParams,
                model: openAIParams.model,
                provider: 'azure',
                input: openAIParams.messages,
                output: formattedOutput,
                latency,
                baseURL: this.baseURL,
                params: body,
                httpStatus: 200,
                usage,
              })
            } catch (error: unknown) {
              const httpStatus =
                error && typeof error === 'object' && 'status' in error
                  ? ((error as { status?: number }).status ?? 500)
                  : 500

              await sendEventToPosthog({
                client: this.phClient,
                ...posthogParams,
                model: openAIParams.model,
                provider: 'azure',
                input: openAIParams.messages,
                output: [],
                latency: 0,
                baseURL: this.baseURL,
                params: body,
                httpStatus,
                usage: { inputTokens: 0, outputTokens: 0 },
                isError: true,
                error: JSON.stringify(error),
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
            await sendEventToPosthog({
              client: this.phClient,
              ...posthogParams,
              model: openAIParams.model,
              provider: 'azure',
              input: openAIParams.messages,
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
            ...posthogParams,
            model: openAIParams.model,
            provider: 'azure',
            input: openAIParams.messages,
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
          })
          throw error
        }
      ) as APIPromise<ChatCompletion>

      return wrappedPromise
    }
  }
}

export class WrappedResponses extends AzureOpenAI.Responses {
  private readonly phClient: PostHog
  private readonly baseURL: string

  constructor(client: AzureOpenAI, phClient: PostHog) {
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
    const { openAIParams, posthogParams } = extractPosthogParams(body)
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
                if ('usage' in chunk && chunk.usage) {
                  usage = {
                    inputTokens: chunk.usage.input_tokens ?? 0,
                    outputTokens: chunk.usage.output_tokens ?? 0,
                    reasoningTokens: chunk.usage.output_tokens_details?.reasoning_tokens ?? 0,
                    cacheReadInputTokens: chunk.usage.input_tokens_details?.cached_tokens ?? 0,
                  }
                }
              }

              const latency = (Date.now() - startTime) / 1000
              await sendEventToPosthog({
                client: this.phClient,
                ...posthogParams,
                //@ts-expect-error
                model: openAIParams.model,
                provider: 'azure',
                input: openAIParams.input,
                output: finalContent,
                latency,
                baseURL: this.baseURL,
                params: body,
                httpStatus: 200,
                usage,
              })
            } catch (error: unknown) {
              const httpStatus =
                error && typeof error === 'object' && 'status' in error
                  ? ((error as { status?: number }).status ?? 500)
                  : 500

              await sendEventToPosthog({
                client: this.phClient,
                ...posthogParams,
                //@ts-expect-error
                model: openAIParams.model,
                provider: 'azure',
                input: openAIParams.input,
                output: [],
                latency: 0,
                baseURL: this.baseURL,
                params: body,
                httpStatus,
                usage: { inputTokens: 0, outputTokens: 0 },
                isError: true,
                error: JSON.stringify(error),
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
            await sendEventToPosthog({
              client: this.phClient,
              ...posthogParams,
              //@ts-expect-error
              model: openAIParams.model,
              provider: 'azure',
              input: openAIParams.input,
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
            ...posthogParams,
            //@ts-expect-error
            model: openAIParams.model,
            provider: 'azure',
            input: openAIParams.input,
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
          })
          throw error
        }
      ) as APIPromise<OpenAIOrignal.Responses.Response>

      return wrappedPromise
    }
  }

  public parse<
    Schema extends ZodTypeAny,
    Params extends OpenAIOrignal.Responses.ResponseCreateParams & { text?: { format?: Schema } }
  >(
    body: Params & MonitoringParams,
    options?: RequestOptions
  ): APIPromise<ParsedResponse<Schema extends { _output: infer O } ? O : any>>

  public parse<Params extends OpenAIOrignal.Responses.ResponseCreateParams, ParsedT = any>(
    body: Params & MonitoringParams,
    options?: RequestOptions
  ): APIPromise<ParsedResponse<ParsedT>>

  public parse<Params extends OpenAIOrignal.Responses.ResponseCreateParams>(
    body: Params & MonitoringParams,
    options?: RequestOptions
  ): APIPromise<ParsedResponse<any>>

  public parse<Params extends OpenAIOrignal.Responses.ResponseCreateParams>(
    body: Params & MonitoringParams,
    options?: RequestOptions
  ): APIPromise<ParsedResponse<any>> {
    const { openAIParams, posthogParams } = extractPosthogParams(body)
    const startTime = Date.now()

    const parentPromise = super.parse(openAIParams, options)

    const wrappedPromise = parentPromise.then(
      async (result) => {
        const latency = (Date.now() - startTime) / 1000
        await sendEventToPosthog({
          client: this.phClient,
          ...posthogParams,
          //@ts-expect-error
          model: openAIParams.model,
          provider: 'azure',
          input: openAIParams.input,
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
        })
        return result
      },
      async (error: any) => {
        await sendEventToPosthog({
          client: this.phClient,
          ...posthogParams,
          //@ts-expect-error
          model: openAIParams.model,
          provider: 'azure',
          input: openAIParams.input,
          output: [],
          latency: 0,
          baseURL: this.baseURL,
          params: body,
          httpStatus: error?.status ? error.status : 500,
          usage: {
            inputTokens: 0,
            outputTokens: 0,
          },
          isError: true,
          error: JSON.stringify(error),
        })
        throw error
      }
    )

    return wrappedPromise as APIPromise<ParsedResponse<any>>
  }
}

export class WrappedEmbeddings extends AzureOpenAI.Embeddings {
  private readonly phClient: PostHog
  private readonly baseURL: string

  constructor(client: AzureOpenAI, phClient: PostHog) {
    super(client)
    this.phClient = phClient
    this.baseURL = client.baseURL
  }

  public create(
    body: EmbeddingCreateParams & MonitoringParams,
    options?: RequestOptions
  ): APIPromise<CreateEmbeddingResponse> {
    const { openAIParams, posthogParams } = extractPosthogParams(body)
    const startTime = Date.now()

    const parentPromise = super.create(openAIParams, options)
    const wrappedPromise = parentPromise.then(
      async (result) => {
        const latency = (Date.now() - startTime) / 1000
        await sendEventToPosthog({
          client: this.phClient,
          eventType: AIEvent.Embedding,
          ...posthogParams,
          model: openAIParams.model,
          provider: 'azure',
          input: withPrivacyMode(this.phClient, posthogParams.privacyMode, openAIParams.input),
          output: null, // Embeddings don't have output content
          latency,
          baseURL: this.baseURL,
          params: body,
          httpStatus: 200,
          usage: {
            inputTokens: result.usage?.prompt_tokens ?? 0,
          },
        })
        return result
      },
      async (error: unknown) => {
        const httpStatus =
          error && typeof error === 'object' && 'status' in error ? ((error as { status?: number }).status ?? 500) : 500

        await sendEventToPosthog({
          client: this.phClient,
          eventType: AIEvent.Embedding,
          ...posthogParams,
          model: openAIParams.model,
          provider: 'azure',
          input: withPrivacyMode(this.phClient, posthogParams.privacyMode, openAIParams.input),
          output: null,
          latency: 0,
          baseURL: this.baseURL,
          params: body,
          httpStatus,
          usage: {
            inputTokens: 0,
          },
          isError: true,
          error: JSON.stringify(error),
        })
        throw error
      }
    ) as APIPromise<CreateEmbeddingResponse>

    return wrappedPromise
  }
}

export default PostHogAzureOpenAI

export { PostHogAzureOpenAI as OpenAI }
