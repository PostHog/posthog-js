import { OpenAI as OpenAIOrignal, ClientOptions } from 'openai'
import { PostHog } from 'posthog-node'
import {
  formatResponseOpenAI,
  MonitoringParams,
  extractAvailableToolCalls,
  withPrivacyMode,
  AIEvent,
  formatOpenAIResponsesInput,
  calculateWebSearchCount,
  getModelParams,
} from '../utils'
import { captureAiGeneration } from './capture'
import type { APIPromise } from 'openai'
import { Stream } from 'openai/streaming'
import type {
  ParsedResponse,
  ResponseRetrieveParamsBase,
  ResponseRetrieveParamsNonStreaming,
  ResponseRetrieveParamsStreaming,
} from 'openai/resources/responses/responses'
import type { ResponseCreateParamsWithTools, ExtractParsedContentFromParams } from 'openai/lib/ResponsesParser'
import type { FormattedMessage, FormattedContent } from '../types'
import { sanitizeOpenAI, sanitizeOpenAIResponse } from '../sanitization'
import { extractPosthogParams } from '../utils'
import {
  isResponseTokenChunk,
  extractRequestId,
  buildProviderMetadata,
  extractCacheWriteTokens,
  isTerminalResponse,
  getResponseFailure,
} from './utils'
import type { MonitoringEventPropertiesWithDefaults } from '../utils'
import {
  BackgroundResponseTracker,
  getBackgroundResponseLatency,
  isPendingBackgroundResponse,
  wrapBackgroundResponseStream,
} from './background-responses'
import { callWithOriginalCreate, preserveProviderPromise } from '../providerPromise'
import { monitoredStreamTee } from '../stream'

const Chat = OpenAIOrignal.Chat
const Completions = Chat.Completions
const Responses = OpenAIOrignal.Responses
const Embeddings = OpenAIOrignal.Embeddings
const Audio = OpenAIOrignal.Audio
const Transcriptions = OpenAIOrignal.Audio.Transcriptions

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

interface BackgroundResponseState {
  openAIParams: ResponsesCreateParamsBase
  posthogParams: MonitoringEventPropertiesWithDefaults
}

interface MonitoringOpenAIConfig extends ClientOptions {
  apiKey: string
  posthog: PostHog
  baseURL?: string
}

type RequestOptions = Record<string, unknown>

function captureAiGenerationInBackground(...args: Parameters<typeof captureAiGeneration>): void {
  void captureAiGeneration(...args).catch(() => undefined)
}

async function captureAiGenerationAfterSuccess(...args: Parameters<typeof captureAiGeneration>): Promise<void> {
  const [, options] = args

  if (options.captureImmediate) {
    await captureAiGeneration(...args)
  } else {
    captureAiGenerationInBackground(...args)
  }
}

export class PostHogOpenAI extends OpenAIOrignal {
  private readonly phClient: PostHog
  public chat: WrappedChat
  public responses: WrappedResponses
  public embeddings: WrappedEmbeddings
  public audio: WrappedAudio

  constructor(config: MonitoringOpenAIConfig) {
    const { posthog, ...openAIConfig } = config
    super(openAIConfig)
    this.phClient = posthog
    this.chat = new WrappedChat(this, this.phClient)
    this.responses = new WrappedResponses(this, this.phClient)
    this.embeddings = new WrappedEmbeddings(this, this.phClient)
    this.audio = new WrappedAudio(this, this.phClient)
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
    const { providerParams: openAIParams, posthogParams } = extractPosthogParams(body)
    const startTime = Date.now()

    const parentPromise = super.create(openAIParams, options)

    if (openAIParams.stream) {
      const wrappedPromise = parentPromise.then((value) => {
        if (Symbol.asyncIterator in value) {
          const [stream1, stream2] = monitoredStreamTee<ChatCompletionChunk, Stream<ChatCompletionChunk>>(
            value as Stream<ChatCompletionChunk>,
            (iterator, controller) => new Stream(iterator, controller)
          )
          ;(async () => {
            // Hoisted so the catch block can surface whatever was accumulated
            // from the streamed chunks before the failure.
            let completionIdFromResponse: string | undefined
            let systemFingerprintFromResponse: string | undefined
            try {
              const contentBlocks: FormattedContent = []
              let accumulatedContent = ''
              let modelFromResponse: string | undefined
              let serviceTierFromResponse: string | undefined
              let firstTokenTime: number | undefined
              let stopReason: string | undefined
              let usage: {
                inputTokens?: number
                outputTokens?: number
                reasoningTokens?: number
                cacheReadInputTokens?: number
                cacheCreationInputTokens?: number
                webSearchCount?: number
              } = {
                inputTokens: 0,
                outputTokens: 0,
                webSearchCount: 0,
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
              let rawUsageData: unknown

              for await (const chunk of stream1) {
                // Extract model and completion metadata from chunk (Chat Completions chunks carry these fields)
                if (!modelFromResponse && chunk.model) {
                  modelFromResponse = chunk.model
                }
                if (!completionIdFromResponse && chunk.id) {
                  completionIdFromResponse = chunk.id
                }
                if (!systemFingerprintFromResponse && chunk.system_fingerprint) {
                  systemFingerprintFromResponse = chunk.system_fingerprint
                }
                if (chunk.service_tier != null) {
                  serviceTierFromResponse = chunk.service_tier
                }

                const choice = chunk?.choices?.[0]

                if (choice?.finish_reason) {
                  stopReason = choice.finish_reason
                }

                const chunkWebSearchCount = calculateWebSearchCount(chunk)
                if (chunkWebSearchCount > 0 && chunkWebSearchCount > (usage.webSearchCount ?? 0)) {
                  usage.webSearchCount = chunkWebSearchCount
                }

                // Handle text content
                const deltaContent = choice?.delta?.content
                if (deltaContent) {
                  if (firstTokenTime === undefined) {
                    firstTokenTime = Date.now()
                  }
                  accumulatedContent += deltaContent
                }

                // Handle tool calls
                const deltaToolCalls = choice?.delta?.tool_calls
                if (deltaToolCalls && Array.isArray(deltaToolCalls)) {
                  if (firstTokenTime === undefined) {
                    firstTokenTime = Date.now()
                  }
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
                  rawUsageData = chunk.usage
                  usage = {
                    ...usage,
                    inputTokens: chunk.usage.prompt_tokens ?? 0,
                    outputTokens: chunk.usage.completion_tokens ?? 0,
                    reasoningTokens: chunk.usage.completion_tokens_details?.reasoning_tokens ?? 0,
                    cacheReadInputTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
                    cacheCreationInputTokens: extractCacheWriteTokens(chunk.usage.prompt_tokens_details),
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
                  })
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
              const timeToFirstToken = firstTokenTime !== undefined ? (firstTokenTime - startTime) / 1000 : undefined
              const availableTools = extractAvailableToolCalls('openai', openAIParams)
              await captureAiGeneration(this.phClient, {
                ...posthogParams,
                model: openAIParams.model ?? modelFromResponse,
                provider: 'openai',
                input: sanitizeOpenAI(openAIParams.messages, this.phClient),
                output: sanitizeOpenAIResponse(formattedOutput, this.phClient),
                latency,
                timeToFirstToken,
                baseURL: this.baseURL,
                modelParameters: getModelParams(body, serviceTierFromResponse),
                httpStatus: 200,
                usage: {
                  inputTokens: usage.inputTokens,
                  outputTokens: usage.outputTokens,
                  reasoningTokens: usage.reasoningTokens,
                  cacheReadInputTokens: usage.cacheReadInputTokens,
                  cacheCreationInputTokens: usage.cacheCreationInputTokens,
                  webSearchCount: usage.webSearchCount,
                  rawUsage: rawUsageData,
                },
                stopReason,
                tools: availableTools,
                completionId: completionIdFromResponse,
                providerMetadata: buildProviderMetadata({ systemFingerprint: systemFingerprintFromResponse }),
              })
            } catch (error: unknown) {
              await captureAiGeneration(this.phClient, {
                ...posthogParams,
                model: openAIParams.model,
                provider: 'openai',
                input: sanitizeOpenAI(openAIParams.messages, this.phClient),
                output: [],
                latency: 0,
                baseURL: this.baseURL,
                modelParameters: getModelParams(body),
                usage: { inputTokens: 0, outputTokens: 0 },
                // If the stream fails mid-flight, surface whatever completion
                // metadata the consumed chunks already provided so the error
                // event can still be correlated to OpenAI's Logs dashboard.
                completionId: completionIdFromResponse,
                providerMetadata: buildProviderMetadata({ systemFingerprint: systemFingerprintFromResponse }),
                error,
              })
              throw error
            }
          })().catch(() => {
            // Swallow: analytics must never crash the host process. The caller
            // already receives this error via their own tee of the stream.
          })

          // Return the other stream to the user
          return stream2
        }
        return value
      })

      return preserveProviderPromise(parentPromise, wrappedPromise)
    } else {
      const wrappedPromise = parentPromise.then(
        async (result) => {
          if ('choices' in result) {
            const latency = (Date.now() - startTime) / 1000
            const availableTools = extractAvailableToolCalls('openai', openAIParams)
            const formattedOutput = formatResponseOpenAI(result)
            await captureAiGenerationAfterSuccess(this.phClient, {
              ...posthogParams,
              model: openAIParams.model ?? result.model,
              provider: 'openai',
              input: sanitizeOpenAI(openAIParams.messages, this.phClient),
              output: sanitizeOpenAIResponse(formattedOutput, this.phClient),
              latency,
              baseURL: this.baseURL,
              modelParameters: getModelParams(body, result.service_tier),
              httpStatus: 200,
              usage: {
                inputTokens: result.usage?.prompt_tokens ?? 0,
                outputTokens: result.usage?.completion_tokens ?? 0,
                reasoningTokens: result.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
                cacheReadInputTokens: result.usage?.prompt_tokens_details?.cached_tokens ?? 0,
                cacheCreationInputTokens: extractCacheWriteTokens(result.usage?.prompt_tokens_details),
                webSearchCount: calculateWebSearchCount(result),
                rawUsage: result.usage,
              },
              stopReason: result.choices[0]?.finish_reason ?? undefined,
              tools: availableTools,
              completionId: result.id,
              providerMetadata: buildProviderMetadata({
                systemFingerprint: result.system_fingerprint,
                requestId: extractRequestId(result),
              }),
            })
          }
          return result
        },
        async (error: unknown) => {
          const httpStatus =
            error && typeof error === 'object' && 'status' in error
              ? ((error as { status?: number }).status ?? 500)
              : 500

          await captureAiGeneration(this.phClient, {
            ...posthogParams,
            model: openAIParams.model,
            provider: 'openai',
            input: sanitizeOpenAI(openAIParams.messages, this.phClient),
            output: [],
            latency: 0,
            baseURL: this.baseURL,
            modelParameters: getModelParams(body),
            httpStatus,
            usage: {
              inputTokens: 0,
              outputTokens: 0,
            },
            error,
          })
          throw error
        }
      )

      return preserveProviderPromise(parentPromise, wrappedPromise)
    }
  }
}

export class WrappedResponses extends Responses {
  private readonly phClient: PostHog
  private readonly baseURL: string
  private readonly backgroundResponses = new BackgroundResponseTracker<BackgroundResponseState>()

  constructor(client: OpenAIOrignal, phClient: PostHog) {
    super(client)
    this.phClient = phClient
    this.baseURL = client.baseURL
  }

  private async captureBackgroundResponse(
    result: OpenAIOrignal.Responses.Response,
    context: BackgroundResponseState
  ): Promise<void> {
    const { openAIParams, posthogParams } = context
    await captureAiGenerationAfterSuccess(this.phClient, {
      ...posthogParams,
      model: openAIParams.model ?? result.model,
      provider: 'openai',
      input: formatOpenAIResponsesInput(sanitizeOpenAIResponse(openAIParams.input), openAIParams.instructions),
      output: formatResponseOpenAI({ output: result.output }),
      latency: getBackgroundResponseLatency(result),
      baseURL: this.baseURL,
      modelParameters: getModelParams(openAIParams, result.service_tier),
      httpStatus: 200,
      usage: {
        inputTokens: result.usage?.input_tokens ?? 0,
        outputTokens: result.usage?.output_tokens ?? 0,
        reasoningTokens: result.usage?.output_tokens_details?.reasoning_tokens ?? 0,
        cacheReadInputTokens: result.usage?.input_tokens_details?.cached_tokens ?? 0,
        cacheCreationInputTokens: extractCacheWriteTokens(result.usage?.input_tokens_details),
        webSearchCount: calculateWebSearchCount(result),
        rawUsage: result.usage,
      },
      stopReason: result.status ?? undefined,
      tools: extractAvailableToolCalls('openai', openAIParams),
      completionId: result.id,
      providerMetadata: buildProviderMetadata({
        requestId: extractRequestId(result),
        incompleteDetails: result.incomplete_details,
      }),
      error: getResponseFailure(result),
    })
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
    const { providerParams: openAIParams, posthogParams } = extractPosthogParams(body)
    const startTime = Date.now()

    const parentPromise = super.create(openAIParams, options)

    if (openAIParams.stream) {
      const wrappedPromise = parentPromise.then((value) => {
        if (Symbol.asyncIterator in value) {
          const [stream1, stream2] = monitoredStreamTee<
            OpenAIOrignal.Responses.ResponseStreamEvent,
            Stream<OpenAIOrignal.Responses.ResponseStreamEvent>
          >(
            value as Stream<OpenAIOrignal.Responses.ResponseStreamEvent>,
            (iterator, controller) => new Stream(iterator, controller)
          )
          ;(async () => {
            // Hoisted so the catch block can surface the completion ID that
            // was accumulated from the streamed chunks before the failure.
            let completionIdFromResponse: string | undefined
            try {
              let finalContent: unknown[] = []
              let modelFromResponse: string | undefined
              let serviceTierFromResponse: string | undefined
              let firstTokenTime: number | undefined
              let stopReason: string | undefined
              let usage: {
                inputTokens?: number
                outputTokens?: number
                reasoningTokens?: number
                cacheReadInputTokens?: number
                cacheCreationInputTokens?: number
                webSearchCount?: number
              } = {
                inputTokens: 0,
                outputTokens: 0,
                webSearchCount: 0,
              }
              let rawUsageData: unknown
              let terminalResponse: OpenAIOrignal.Responses.Response | undefined

              for await (const chunk of stream1) {
                // Track first token time on content delta events
                if (firstTokenTime === undefined && isResponseTokenChunk(chunk)) {
                  firstTokenTime = Date.now()
                }

                if ('response' in chunk && chunk.response) {
                  // Extract model and completion ID from the response object in the chunk (for stored prompts)
                  if (!modelFromResponse && chunk.response.model) {
                    modelFromResponse = chunk.response.model
                  }
                  if (!completionIdFromResponse && chunk.response.id) {
                    completionIdFromResponse = chunk.response.id
                  }
                  if (openAIParams.background === true && !this.backgroundResponses.get(chunk.response.id)) {
                    this.backgroundResponses.set(chunk.response.id, { openAIParams, posthogParams })
                  }
                  if (chunk.response.service_tier != null) {
                    serviceTierFromResponse = chunk.response.service_tier
                  }

                  const chunkWebSearchCount = calculateWebSearchCount(chunk.response)
                  if (chunkWebSearchCount > 0 && chunkWebSearchCount > (usage.webSearchCount ?? 0)) {
                    usage.webSearchCount = chunkWebSearchCount
                  }

                  if (isTerminalResponse(chunk.response)) {
                    terminalResponse = chunk.response
                    finalContent = chunk.response.output ?? []
                    stopReason = chunk.response.status
                  }
                }
                if ('response' in chunk && chunk.response?.usage) {
                  rawUsageData = chunk.response.usage
                  usage = {
                    ...usage,
                    inputTokens: chunk.response.usage.input_tokens ?? 0,
                    outputTokens: chunk.response.usage.output_tokens ?? 0,
                    reasoningTokens: chunk.response.usage.output_tokens_details?.reasoning_tokens ?? 0,
                    cacheReadInputTokens: chunk.response.usage.input_tokens_details?.cached_tokens ?? 0,
                    cacheCreationInputTokens: extractCacheWriteTokens(chunk.response.usage.input_tokens_details),
                  }
                }
              }

              if (openAIParams.background === true) {
                if (terminalResponse) {
                  const context = this.backgroundResponses.take(terminalResponse.id)
                  if (context) {
                    await this.captureBackgroundResponse(terminalResponse, context).catch(() => undefined)
                  }
                }
                return
              }

              const latency = (Date.now() - startTime) / 1000
              const timeToFirstToken = firstTokenTime !== undefined ? (firstTokenTime - startTime) / 1000 : undefined
              const availableTools = extractAvailableToolCalls('openai', openAIParams)
              await captureAiGeneration(this.phClient, {
                ...posthogParams,
                model: openAIParams.model ?? modelFromResponse,
                provider: 'openai',
                input: formatOpenAIResponsesInput(
                  sanitizeOpenAIResponse(openAIParams.input, this.phClient),
                  openAIParams.instructions
                ),
                output: sanitizeOpenAIResponse(finalContent),
                latency,
                timeToFirstToken,
                baseURL: this.baseURL,
                modelParameters: getModelParams(body, serviceTierFromResponse),
                httpStatus: 200,
                usage: {
                  inputTokens: usage.inputTokens,
                  outputTokens: usage.outputTokens,
                  reasoningTokens: usage.reasoningTokens,
                  cacheReadInputTokens: usage.cacheReadInputTokens,
                  cacheCreationInputTokens: usage.cacheCreationInputTokens,
                  webSearchCount: usage.webSearchCount,
                  rawUsage: rawUsageData,
                },
                stopReason,
                tools: availableTools,
                completionId: completionIdFromResponse,
                providerMetadata: buildProviderMetadata({
                  incompleteDetails: terminalResponse?.incomplete_details,
                }),
                error: getResponseFailure(terminalResponse),
              })
            } catch (error: unknown) {
              if (
                openAIParams.background === true &&
                completionIdFromResponse &&
                this.backgroundResponses.get(completionIdFromResponse)
              ) {
                throw error
              }

              await captureAiGeneration(this.phClient, {
                ...posthogParams,
                model: openAIParams.model,
                provider: 'openai',
                input: formatOpenAIResponsesInput(
                  sanitizeOpenAIResponse(openAIParams.input, this.phClient),
                  openAIParams.instructions
                ),
                output: [],
                latency: 0,
                baseURL: this.baseURL,
                modelParameters: getModelParams(body),
                usage: { inputTokens: 0, outputTokens: 0 },
                // Surface the completion ID from any chunks consumed before
                // the stream failed so the error event remains correlatable.
                completionId: completionIdFromResponse,
                error,
              })
              throw error
            }
          })().catch(() => {
            // Swallow: analytics must never crash the host process. The caller
            // already receives this error via their own tee of the stream.
          })

          return stream2
        }
        return value
      })

      return preserveProviderPromise(parentPromise, wrappedPromise)
    } else {
      const wrappedPromise = parentPromise.then(
        async (result) => {
          if ('output' in result) {
            if (isPendingBackgroundResponse(openAIParams, result)) {
              this.backgroundResponses.set(result.id, { openAIParams, posthogParams })
              return result
            }

            const latency = (Date.now() - startTime) / 1000
            const availableTools = extractAvailableToolCalls('openai', openAIParams)
            const formattedOutput = formatResponseOpenAI({ output: result.output })
            await captureAiGenerationAfterSuccess(this.phClient, {
              ...posthogParams,
              model: openAIParams.model ?? result.model,
              provider: 'openai',
              input: formatOpenAIResponsesInput(
                sanitizeOpenAIResponse(openAIParams.input, this.phClient),
                openAIParams.instructions
              ),
              output: sanitizeOpenAIResponse(formattedOutput, this.phClient),
              latency,
              baseURL: this.baseURL,
              modelParameters: getModelParams(body, result.service_tier),
              httpStatus: 200,
              usage: {
                inputTokens: result.usage?.input_tokens ?? 0,
                outputTokens: result.usage?.output_tokens ?? 0,
                reasoningTokens: result.usage?.output_tokens_details?.reasoning_tokens ?? 0,
                cacheReadInputTokens: result.usage?.input_tokens_details?.cached_tokens ?? 0,
                cacheCreationInputTokens: extractCacheWriteTokens(result.usage?.input_tokens_details),
                webSearchCount: calculateWebSearchCount(result),
                rawUsage: result.usage,
              },
              stopReason: result.status ?? undefined,
              tools: availableTools,
              completionId: result.id,
              providerMetadata: buildProviderMetadata({
                requestId: extractRequestId(result),
                incompleteDetails: result.incomplete_details,
              }),
              error: getResponseFailure(result),
            })
          }
          return result
        },
        async (error: unknown) => {
          const httpStatus =
            error && typeof error === 'object' && 'status' in error
              ? ((error as { status?: number }).status ?? 500)
              : 500

          await captureAiGeneration(this.phClient, {
            ...posthogParams,
            model: openAIParams.model,
            provider: 'openai',
            input: formatOpenAIResponsesInput(
              sanitizeOpenAIResponse(openAIParams.input, this.phClient),
              openAIParams.instructions
            ),
            output: [],
            latency: 0,
            baseURL: this.baseURL,
            modelParameters: getModelParams(body),
            httpStatus,
            usage: {
              inputTokens: 0,
              outputTokens: 0,
            },
            error,
          })
          throw error
        }
      )

      return preserveProviderPromise(parentPromise, wrappedPromise)
    }
  }

  public retrieve(
    responseID: string,
    query?: ResponseRetrieveParamsNonStreaming,
    options?: RequestOptions
  ): APIPromise<OpenAIOrignal.Responses.Response>

  public retrieve(
    responseID: string,
    query: ResponseRetrieveParamsStreaming,
    options?: RequestOptions
  ): APIPromise<Stream<OpenAIOrignal.Responses.ResponseStreamEvent>>

  public retrieve(
    responseID: string,
    query?: ResponseRetrieveParamsBase,
    options?: RequestOptions
  ): APIPromise<OpenAIOrignal.Responses.Response | Stream<OpenAIOrignal.Responses.ResponseStreamEvent>>

  public retrieve(
    responseID: string,
    query: ResponseRetrieveParamsBase = {},
    options?: RequestOptions
  ): APIPromise<OpenAIOrignal.Responses.Response | Stream<OpenAIOrignal.Responses.ResponseStreamEvent>> {
    const parentPromise = super.retrieve(responseID, query, options)

    // Preserve the upstream promise and stream unchanged for responses that
    // were not created through this client.
    if (!this.backgroundResponses.get(responseID)) {
      return parentPromise
    }

    if (query.stream) {
      return parentPromise._thenUnwrap((result) => {
        if ('controller' in result) {
          return wrapBackgroundResponseStream(result, responseID, this.backgroundResponses, (response, context) =>
            this.captureBackgroundResponse(response, context)
          )
        }
        return result
      })
    }

    return parentPromise._thenUnwrap(async (result) => {
      if (!('output' in result) || !isTerminalResponse(result)) {
        return result
      }

      // Removing the context before capture makes concurrent or repeated
      // terminal polls idempotent.
      const context = this.backgroundResponses.take(responseID)
      if (context) {
        await this.captureBackgroundResponse(result, context).catch(() => undefined)
      }
      return result
    }) as unknown as APIPromise<OpenAIOrignal.Responses.Response>
  }

  public cancel(responseID: string, options?: RequestOptions): APIPromise<OpenAIOrignal.Responses.Response> {
    const parentPromise = super.cancel(responseID, options)

    // Avoid wrapping calls that do not belong to a background response created
    // through this client, preserving the upstream APIPromise unchanged.
    if (!this.backgroundResponses.get(responseID)) {
      return parentPromise
    }

    return parentPromise._thenUnwrap(async (result) => {
      if (!isTerminalResponse(result)) {
        return result
      }

      const context = this.backgroundResponses.take(responseID)
      if (context) {
        await this.captureBackgroundResponse(result, context).catch(() => undefined)
      }
      return result
    }) as unknown as APIPromise<OpenAIOrignal.Responses.Response>
  }

  public parse<Params extends ResponseCreateParamsWithTools, ParsedT = ExtractParsedContentFromParams<Params>>(
    body: Params & MonitoringParams,
    options?: RequestOptions
  ): APIPromise<ParsedResponse<ParsedT>> {
    const { providerParams: openAIParams, posthogParams } = extractPosthogParams(body)
    const startTime = Date.now()

    const parentPromise = callWithOriginalCreate(this, super.create.bind(this), () =>
      super.parse<Params, ParsedT>(openAIParams, options)
    )

    const wrappedPromise = parentPromise.then(
      async (result) => {
        if (isPendingBackgroundResponse(openAIParams, result)) {
          this.backgroundResponses.set(result.id, { openAIParams, posthogParams })
          return result
        }

        const latency = (Date.now() - startTime) / 1000
        await captureAiGeneration(this.phClient, {
          ...posthogParams,
          model: openAIParams.model ?? result.model,
          provider: 'openai',
          input: formatOpenAIResponsesInput(
            sanitizeOpenAIResponse(openAIParams.input, this.phClient),
            openAIParams.instructions
          ),
          output: sanitizeOpenAIResponse(result.output, this.phClient),
          latency,
          baseURL: this.baseURL,
          modelParameters: getModelParams(body, result.service_tier),
          httpStatus: 200,
          usage: {
            inputTokens: result.usage?.input_tokens ?? 0,
            outputTokens: result.usage?.output_tokens ?? 0,
            reasoningTokens: result.usage?.output_tokens_details?.reasoning_tokens ?? 0,
            cacheReadInputTokens: result.usage?.input_tokens_details?.cached_tokens ?? 0,
            cacheCreationInputTokens: extractCacheWriteTokens(result.usage?.input_tokens_details),
            rawUsage: result.usage,
          },
          stopReason: result.status ?? undefined,
          completionId: result.id,
          providerMetadata: buildProviderMetadata({
            requestId: extractRequestId(result),
            incompleteDetails: result.incomplete_details,
          }),
          error: getResponseFailure(result),
        })
        return result
      },
      async (error: Error) => {
        await captureAiGeneration(this.phClient, {
          ...posthogParams,
          model: openAIParams.model,
          provider: 'openai',
          input: formatOpenAIResponsesInput(
            sanitizeOpenAIResponse(openAIParams.input, this.phClient),
            openAIParams.instructions
          ),
          output: [],
          latency: 0,
          baseURL: this.baseURL,
          modelParameters: getModelParams(body),
          usage: {
            inputTokens: 0,
            outputTokens: 0,
          },
          error,
        })
        throw error
      }
    )

    return preserveProviderPromise(parentPromise, wrappedPromise)
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
    const { providerParams: openAIParams, posthogParams } = extractPosthogParams(body)
    const startTime = Date.now()

    const parentPromise = super.create(openAIParams, options)

    const wrappedPromise = parentPromise.then(
      async (result) => {
        const latency = (Date.now() - startTime) / 1000
        await captureAiGeneration(this.phClient, {
          ...posthogParams,
          eventType: AIEvent.Embedding,
          model: openAIParams.model,
          provider: 'openai',
          input: withPrivacyMode(this.phClient, posthogParams.privacyMode, openAIParams.input),
          output: null, // Embeddings don't have output content
          latency,
          baseURL: this.baseURL,
          modelParameters: getModelParams(body),
          httpStatus: 200,
          usage: {
            inputTokens: result.usage?.prompt_tokens ?? 0,
            rawUsage: result.usage,
          },
        })
        return result
      },
      async (error: unknown) => {
        const httpStatus =
          error && typeof error === 'object' && 'status' in error ? ((error as { status?: number }).status ?? 500) : 500

        await captureAiGeneration(this.phClient, {
          eventType: AIEvent.Embedding,
          ...posthogParams,
          model: openAIParams.model,
          provider: 'openai',
          input: withPrivacyMode(this.phClient, posthogParams.privacyMode, openAIParams.input),
          output: null, // Embeddings don't have output content
          latency: 0,
          baseURL: this.baseURL,
          modelParameters: getModelParams(body),
          httpStatus,
          usage: {
            inputTokens: 0,
          },
          error,
        })
        throw error
      }
    )

    return preserveProviderPromise(parentPromise, wrappedPromise)
  }
}

export class WrappedAudio extends Audio {
  constructor(parentClient: PostHogOpenAI, phClient: PostHog) {
    super(parentClient)
    this.transcriptions = new WrappedTranscriptions(parentClient, phClient)
  }

  public transcriptions: WrappedTranscriptions
}

export class WrappedTranscriptions extends Transcriptions {
  private readonly phClient: PostHog
  private readonly baseURL: string

  constructor(client: OpenAIOrignal, phClient: PostHog) {
    super(client)
    this.phClient = phClient
    this.baseURL = client.baseURL
  }

  // --- Overload #1: Non-streaming
  public create(
    body: OpenAIOrignal.Audio.Transcriptions.TranscriptionCreateParamsNonStreaming<'json' | undefined> &
      MonitoringParams,
    options?: RequestOptions
  ): APIPromise<OpenAIOrignal.Audio.Transcriptions.Transcription>

  // --- Overload #2: Non-streaming
  public create(
    body: OpenAIOrignal.Audio.Transcriptions.TranscriptionCreateParamsNonStreaming<'verbose_json'> & MonitoringParams,
    options?: RequestOptions
  ): APIPromise<OpenAIOrignal.Audio.Transcriptions.TranscriptionVerbose>

  // --- Overload #3: Non-streaming
  public create(
    body: OpenAIOrignal.Audio.Transcriptions.TranscriptionCreateParamsNonStreaming<'srt' | 'vtt' | 'text'> &
      MonitoringParams,
    options?: RequestOptions
  ): APIPromise<string>

  // --- Overload #4: Non-streaming
  public create(
    body: OpenAIOrignal.Audio.Transcriptions.TranscriptionCreateParamsNonStreaming,
    options?: RequestOptions
  ): APIPromise<OpenAIOrignal.Audio.Transcriptions.Transcription>

  // --- Overload #5: Streaming
  public create(
    body: OpenAIOrignal.Audio.Transcriptions.TranscriptionCreateParamsStreaming & MonitoringParams,
    options?: RequestOptions
  ): APIPromise<Stream<OpenAIOrignal.Audio.Transcriptions.TranscriptionStreamEvent>>

  // --- Overload #6: Streaming
  public create(
    body: OpenAIOrignal.Audio.Transcriptions.TranscriptionCreateParamsStreaming & MonitoringParams,
    options?: RequestOptions
  ): APIPromise<
    | OpenAIOrignal.Audio.Transcriptions.TranscriptionCreateResponse
    | string
    | Stream<OpenAIOrignal.Audio.Transcriptions.TranscriptionStreamEvent>
  >

  // --- Overload #7: Generic base
  public create(
    body: OpenAIOrignal.Audio.Transcriptions.TranscriptionCreateParams & MonitoringParams,
    options?: RequestOptions
  ): APIPromise<
    | OpenAIOrignal.Audio.Transcriptions.TranscriptionCreateResponse
    | string
    | Stream<OpenAIOrignal.Audio.Transcriptions.TranscriptionStreamEvent>
  >

  // --- Implementation Signature
  public create(
    body: OpenAIOrignal.Audio.Transcriptions.TranscriptionCreateParams & MonitoringParams,
    options?: RequestOptions
  ): APIPromise<
    | OpenAIOrignal.Audio.Transcriptions.TranscriptionCreateResponse
    | string
    | Stream<OpenAIOrignal.Audio.Transcriptions.TranscriptionStreamEvent>
  > {
    const { providerParams: openAIParams, posthogParams } =
      extractPosthogParams<OpenAIOrignal.Audio.Transcriptions.TranscriptionCreateParams>(body)
    const startTime = Date.now()

    const parentPromise = openAIParams.stream
      ? super.create(openAIParams, options)
      : super.create(openAIParams, options)

    if (openAIParams.stream) {
      const wrappedPromise = parentPromise.then((value) => {
        if (Symbol.asyncIterator in value) {
          const [stream1, stream2] = monitoredStreamTee<
            OpenAIOrignal.Audio.Transcriptions.TranscriptionStreamEvent,
            Stream<OpenAIOrignal.Audio.Transcriptions.TranscriptionStreamEvent>
          >(
            value as Stream<OpenAIOrignal.Audio.Transcriptions.TranscriptionStreamEvent>,
            (iterator, controller) => new Stream(iterator, controller)
          )
          ;(async () => {
            try {
              let finalContent: string = ''
              let firstTokenTime: number | undefined
              let usage: {
                inputTokens?: number
                outputTokens?: number
                rawUsage?: unknown
              } = {
                inputTokens: 0,
                outputTokens: 0,
              }

              const doneEvent: OpenAIOrignal.Audio.Transcriptions.TranscriptionTextDoneEvent['type'] =
                'transcript.text.done'
              for await (const chunk of stream1) {
                // Track first token on text delta events
                if (firstTokenTime === undefined && chunk.type === 'transcript.text.delta') {
                  firstTokenTime = Date.now()
                }

                if (chunk.type === doneEvent && 'text' in chunk && chunk.text && chunk.text.length > 0) {
                  finalContent = chunk.text
                }
                if ('usage' in chunk && chunk.usage) {
                  usage = {
                    inputTokens: chunk.usage?.type === 'tokens' ? (chunk.usage.input_tokens ?? 0) : 0,
                    outputTokens: chunk.usage?.type === 'tokens' ? (chunk.usage.output_tokens ?? 0) : 0,
                    rawUsage: chunk.usage,
                  }
                }
              }

              const latency = (Date.now() - startTime) / 1000
              const timeToFirstToken = firstTokenTime !== undefined ? (firstTokenTime - startTime) / 1000 : undefined
              const availableTools = extractAvailableToolCalls('openai', openAIParams)
              await captureAiGeneration(this.phClient, {
                ...posthogParams,
                model: openAIParams.model,
                provider: 'openai',
                input: openAIParams.prompt,
                output: sanitizeOpenAIResponse(finalContent),
                latency,
                timeToFirstToken,
                baseURL: this.baseURL,
                modelParameters: getModelParams(body),
                httpStatus: 200,
                usage,
                tools: availableTools,
              })
            } catch (error: unknown) {
              await captureAiGeneration(this.phClient, {
                ...posthogParams,
                model: openAIParams.model,
                provider: 'openai',
                input: openAIParams.prompt,
                output: [],
                latency: 0,
                baseURL: this.baseURL,
                modelParameters: getModelParams(body),
                usage: { inputTokens: 0, outputTokens: 0 },
                error,
              })
              throw error
            }
          })().catch(() => {
            // Swallow: analytics must never crash the host process. The caller
            // already receives this error via their own tee of the stream.
          })

          return stream2
        }
        return value
      })

      return preserveProviderPromise(
        parentPromise as APIPromise<Stream<OpenAIOrignal.Audio.Transcriptions.TranscriptionStreamEvent>>,
        wrappedPromise
      )
    } else {
      const wrappedPromise = parentPromise.then(
        async (result) => {
          if (result && typeof result === 'object' && 'text' in result) {
            const latency = (Date.now() - startTime) / 1000
            await captureAiGenerationAfterSuccess(this.phClient, {
              ...posthogParams,
              model: openAIParams.model,
              provider: 'openai',
              input: openAIParams.prompt,
              output: sanitizeOpenAIResponse(result.text),
              latency,
              baseURL: this.baseURL,
              modelParameters: getModelParams(body),
              httpStatus: 200,
              usage: {
                inputTokens: result.usage?.type === 'tokens' ? (result.usage.input_tokens ?? 0) : 0,
                outputTokens: result.usage?.type === 'tokens' ? (result.usage.output_tokens ?? 0) : 0,
                rawUsage: result.usage,
              },
            })
          }
          return result
        },
        async (error: unknown) => {
          await captureAiGeneration(this.phClient, {
            ...posthogParams,
            model: openAIParams.model,
            provider: 'openai',
            input: openAIParams.prompt,
            output: [],
            latency: 0,
            baseURL: this.baseURL,
            modelParameters: getModelParams(body),
            usage: {
              inputTokens: 0,
              outputTokens: 0,
            },
            error,
          })
          throw error
        }
      )

      return preserveProviderPromise(
        parentPromise as APIPromise<OpenAIOrignal.Audio.Transcriptions.TranscriptionCreateResponse>,
        wrappedPromise
      )
    }
  }
}

export default PostHogOpenAI

export { PostHogOpenAI as OpenAI }
export { default as AzureOpenAI } from './azure'
