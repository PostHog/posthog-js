import OpenAIOrignal, { AzureOpenAI } from 'openai'
import type { AzureClientOptions } from 'openai/azure'
import { PostHog } from 'posthog-node'
import { formatResponseOpenAI, MonitoringParams } from '../utils'
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
import { extractPosthogParams } from '../utils'
import { isTerminalResponse } from './utils'
import type { MonitoringEventPropertiesWithDefaults } from '../utils'
import {
  BackgroundResponseTracker,
  isPendingBackgroundResponse,
  wrapBackgroundResponseStream,
} from './background-responses'
import { callWithOriginalCreate, preserveProviderPromise } from '../providerPromise'
import { monitoredStreamTee } from '../stream'
import { OpenAIChatStreamAccumulator, OpenAIResponsesStreamAccumulator } from './stream-accumulators'
import {
  buildBackgroundResponseOptions,
  buildChatErrorOptions,
  buildChatSuccessOptions,
  buildChatUsage,
  buildEmbeddingErrorOptions,
  buildEmbeddingSuccessOptions,
  buildResponsesErrorOptions,
  buildResponsesSuccessOptions,
  captureAiGenerationAfterSuccess,
} from './telemetry'

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

interface MonitoringOpenAIConfig extends AzureClientOptions {
  apiKey: string
  posthog: PostHog
}

type RequestOptions = Record<string, any>

export class PostHogAzureOpenAI extends AzureOpenAI {
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
            const accumulator = new OpenAIChatStreamAccumulator()
            try {
              for await (const chunk of stream1) {
                accumulator.consume(chunk)
              }
              const accumulated = accumulator.result()
              await captureAiGeneration(
                this.phClient,
                buildChatSuccessOptions(
                  {
                    client: this.phClient,
                    provider: 'azure',
                    baseURL: this.baseURL,
                    params: openAIParams,
                    monitoring: posthogParams,
                    modelParametersSource: body,
                  },
                  {
                    ...accumulated,
                    latency: (Date.now() - startTime) / 1000,
                    timeToFirstToken:
                      accumulated.firstTokenTime === undefined
                        ? undefined
                        : (accumulated.firstTokenTime - startTime) / 1000,
                  }
                )
              )
            } catch (error: unknown) {
              const accumulated = accumulator.result()
              await captureAiGeneration(
                this.phClient,
                buildChatErrorOptions(
                  {
                    client: this.phClient,
                    provider: 'azure',
                    baseURL: this.baseURL,
                    params: openAIParams,
                    monitoring: posthogParams,
                    modelParametersSource: body,
                  },
                  error,
                  {
                    completionId: accumulated.completionId,
                    systemFingerprint: accumulated.systemFingerprint,
                    usage: accumulated.usage,
                    latency: (Date.now() - startTime) / 1000,
                  }
                )
              )
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
            await captureAiGenerationAfterSuccess(
              this.phClient,
              buildChatSuccessOptions(
                {
                  client: this.phClient,
                  provider: 'azure',
                  baseURL: this.baseURL,
                  params: openAIParams,
                  monitoring: posthogParams,
                  modelParametersSource: body,
                },
                {
                  output: formatResponseOpenAI(result),
                  model: result.model,
                  serviceTier: result.service_tier ?? undefined,
                  latency: (Date.now() - startTime) / 1000,
                  usage: buildChatUsage(result.usage, result),
                  stopReason: result.choices[0]?.finish_reason ?? undefined,
                  completionId: result.id,
                  systemFingerprint: result.system_fingerprint,
                  requestId: (result as { _request_id?: string })._request_id,
                }
              )
            )
          }
          return result
        },
        async (error: unknown) => {
          await captureAiGeneration(
            this.phClient,
            buildChatErrorOptions(
              {
                client: this.phClient,
                provider: 'azure',
                baseURL: this.baseURL,
                params: openAIParams,
                monitoring: posthogParams,
                modelParametersSource: body,
              },
              error,
              { latency: (Date.now() - startTime) / 1000 }
            )
          )
          throw error
        }
      )

      return preserveProviderPromise(parentPromise, wrappedPromise)
    }
  }
}

export class WrappedResponses extends AzureOpenAI.Responses {
  private readonly phClient: PostHog
  private readonly baseURL: string
  private readonly backgroundResponses = new BackgroundResponseTracker<BackgroundResponseState>()

  constructor(client: AzureOpenAI, phClient: PostHog) {
    super(client)
    this.phClient = phClient
    this.baseURL = client.baseURL
  }

  private async captureBackgroundResponse(
    result: OpenAIOrignal.Responses.Response,
    context: BackgroundResponseState
  ): Promise<void> {
    const { openAIParams, posthogParams } = context
    await captureAiGenerationAfterSuccess(
      this.phClient,
      buildBackgroundResponseOptions(
        {
          client: this.phClient,
          provider: 'azure',
          baseURL: this.baseURL,
          params: openAIParams,
          monitoring: posthogParams,
          modelParametersSource: openAIParams,
        },
        result
      )
    )
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
            const accumulator = new OpenAIResponsesStreamAccumulator()
            try {
              for await (const chunk of stream1) {
                accumulator.consume(chunk)
                if (
                  openAIParams.background === true &&
                  'response' in chunk &&
                  chunk.response &&
                  !this.backgroundResponses.get(chunk.response.id)
                ) {
                  this.backgroundResponses.set(chunk.response.id, { openAIParams, posthogParams })
                }
              }

              const accumulated = accumulator.result()
              if (openAIParams.background === true) {
                if (accumulated.terminalResponse) {
                  const context = this.backgroundResponses.take(accumulated.terminalResponse.id)
                  if (context) {
                    await this.captureBackgroundResponse(accumulated.terminalResponse, context).catch(() => undefined)
                  }
                }
                return
              }

              const response: Parameters<typeof buildResponsesSuccessOptions>[1]['response'] =
                accumulated.terminalResponse ?? {
                  id: accumulated.completionId ?? '',
                  model: accumulated.model ?? openAIParams.model,
                  status: accumulated.stopReason as OpenAIOrignal.Responses.Response['status'],
                  service_tier: accumulated.serviceTier,
                }
              await captureAiGeneration(
                this.phClient,
                buildResponsesSuccessOptions(
                  {
                    client: this.phClient,
                    provider: 'azure',
                    baseURL: this.baseURL,
                    params: openAIParams,
                    monitoring: posthogParams,
                    modelParametersSource: body,
                  },
                  {
                    response,
                    output: accumulated.output,
                    latency: (Date.now() - startTime) / 1000,
                    timeToFirstToken:
                      accumulated.firstTokenTime === undefined
                        ? undefined
                        : (accumulated.firstTokenTime - startTime) / 1000,
                    usage: accumulated.usage,
                    includeTools: true,
                  }
                )
              )
            } catch (error: unknown) {
              const accumulated = accumulator.result()
              if (
                openAIParams.background === true &&
                accumulated.completionId &&
                this.backgroundResponses.get(accumulated.completionId)
              ) {
                throw error
              }

              await captureAiGeneration(
                this.phClient,
                buildResponsesErrorOptions(
                  {
                    client: this.phClient,
                    provider: 'azure',
                    baseURL: this.baseURL,
                    params: openAIParams,
                    monitoring: posthogParams,
                    modelParametersSource: body,
                  },
                  error,
                  {
                    completionId: accumulated.completionId,
                    usage: accumulated.usage,
                    latency: (Date.now() - startTime) / 1000,
                  }
                )
              )
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

            await captureAiGenerationAfterSuccess(
              this.phClient,
              buildResponsesSuccessOptions(
                {
                  client: this.phClient,
                  provider: 'azure',
                  baseURL: this.baseURL,
                  params: openAIParams,
                  monitoring: posthogParams,
                  modelParametersSource: body,
                },
                {
                  response: result,
                  output: formatResponseOpenAI({ output: result.output }),
                  latency: (Date.now() - startTime) / 1000,
                  includeTools: true,
                  includeRequestId: true,
                }
              )
            )
          }
          return result
        },
        async (error: unknown) => {
          await captureAiGeneration(
            this.phClient,
            buildResponsesErrorOptions(
              {
                client: this.phClient,
                provider: 'azure',
                baseURL: this.baseURL,
                params: openAIParams,
                monitoring: posthogParams,
                modelParametersSource: body,
              },
              error,
              { latency: (Date.now() - startTime) / 1000 }
            )
          )
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

        await captureAiGeneration(
          this.phClient,
          buildResponsesSuccessOptions(
            {
              client: this.phClient,
              provider: 'azure',
              baseURL: this.baseURL,
              params: openAIParams,
              monitoring: posthogParams,
              modelParametersSource: body,
            },
            {
              response: result,
              output: result.output,
              latency: (Date.now() - startTime) / 1000,
              includeRequestId: true,
            }
          )
        )
        return result
      },
      async (error: any) => {
        await captureAiGeneration(
          this.phClient,
          buildResponsesErrorOptions(
            {
              client: this.phClient,
              provider: 'azure',
              baseURL: this.baseURL,
              params: openAIParams,
              monitoring: posthogParams,
              modelParametersSource: body,
            },
            error,
            { latency: (Date.now() - startTime) / 1000 }
          )
        )
        throw error
      }
    )

    return preserveProviderPromise(parentPromise, wrappedPromise)
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
    const { providerParams: openAIParams, posthogParams } = extractPosthogParams(body)
    const startTime = Date.now()

    const parentPromise = super.create(openAIParams, options)
    const wrappedPromise = parentPromise.then(
      async (result) => {
        await captureAiGeneration(
          this.phClient,
          buildEmbeddingSuccessOptions(
            {
              client: this.phClient,
              provider: 'azure',
              baseURL: this.baseURL,
              params: openAIParams,
              monitoring: posthogParams,
              modelParametersSource: body,
            },
            result.usage,
            (Date.now() - startTime) / 1000
          )
        )
        return result
      },
      async (error: unknown) => {
        await captureAiGeneration(
          this.phClient,
          buildEmbeddingErrorOptions(
            {
              client: this.phClient,
              provider: 'azure',
              baseURL: this.baseURL,
              params: openAIParams,
              monitoring: posthogParams,
              modelParametersSource: body,
            },
            error,
            (Date.now() - startTime) / 1000
          )
        )
        throw error
      }
    )

    return preserveProviderPromise(parentPromise, wrappedPromise)
  }
}

export default PostHogAzureOpenAI

export { PostHogAzureOpenAI as OpenAI }
