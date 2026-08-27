import type OpenAI from 'openai'
import type { PostHog } from 'posthog-node'
import type { CaptureAiGenerationOptions } from '../captureAiGeneration'
import type { TokenUsage } from '../types'
import {
  AIEvent,
  calculateWebSearchCount,
  extractAvailableToolCalls,
  formatOpenAIResponsesInput,
  formatResponseOpenAI,
  getModelParams,
  type MonitoringEventPropertiesWithDefaults,
  withPrivacyMode,
} from '../utils'
import { sanitizeOpenAI, sanitizeOpenAIResponse } from '../sanitization'
import { captureAiGeneration } from './capture'
import { getBackgroundResponseLatency } from './background-responses'
import { buildProviderMetadata, extractCacheWriteTokens, extractRequestId, getResponseFailure } from './utils'

export type OpenAICompatibleProvider = 'openai' | 'azure'
type ChatParams = OpenAI.Chat.Completions.ChatCompletionCreateParams
type ResponsesParams = OpenAI.Responses.ResponseCreateParams
type OpenAIResponseTelemetry = {
  id: string
  model?: string
  service_tier?: string | null
  status?: OpenAI.Responses.Response['status']
  usage?: OpenAI.Responses.ResponseUsage | null
  incomplete_details?: OpenAI.Responses.Response['incomplete_details']
  error?: OpenAI.Responses.Response['error']
}

type CommonContext<Params> = {
  client: PostHog
  provider: OpenAICompatibleProvider
  baseURL: string
  params: Params
  monitoring: MonitoringEventPropertiesWithDefaults
  modelParametersSource: Parameters<typeof getModelParams>[0]
}

export function captureAiGenerationInBackground(...args: Parameters<typeof captureAiGeneration>): void {
  void captureAiGeneration(...args).catch(() => undefined)
}

/** Preserve immediate delivery while isolating normal telemetry from provider latency/failures. */
export async function captureAiGenerationAfterSuccess(...args: Parameters<typeof captureAiGeneration>): Promise<void> {
  if (args[1].captureImmediate) {
    await captureAiGeneration(...args)
  } else {
    captureAiGenerationInBackground(...args)
  }
}

export function buildChatUsage(
  usage: OpenAI.CompletionUsage | null | undefined,
  webSearchSource?: unknown
): TokenUsage {
  return {
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
    reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
    cacheReadInputTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
    cacheCreationInputTokens: extractCacheWriteTokens(usage?.prompt_tokens_details),
    webSearchCount: calculateWebSearchCount(webSearchSource),
    rawUsage: usage,
  }
}

export function buildResponsesUsage(
  usage: OpenAI.Responses.ResponseUsage | null | undefined,
  webSearchSource?: unknown
): TokenUsage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    reasoningTokens: usage?.output_tokens_details?.reasoning_tokens ?? 0,
    cacheReadInputTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
    cacheCreationInputTokens: extractCacheWriteTokens(usage?.input_tokens_details),
    webSearchCount: calculateWebSearchCount(webSearchSource),
    rawUsage: usage,
  }
}

export function buildChatSuccessOptions(
  context: CommonContext<ChatParams>,
  result: {
    output: unknown
    model?: string
    serviceTier?: string
    latency?: number
    timeToFirstToken?: number
    usage: TokenUsage
    stopReason?: string
    completionId?: string
    systemFingerprint?: string | null
    requestId?: string
  }
): CaptureAiGenerationOptions {
  return {
    ...context.monitoring,
    model: context.params.model ?? result.model,
    provider: context.provider,
    input: sanitizeOpenAI(context.params.messages, context.client),
    output: sanitizeOpenAIResponse(result.output, context.client),
    latency: result.latency,
    timeToFirstToken: result.timeToFirstToken,
    baseURL: context.baseURL,
    modelParameters: getModelParams(context.modelParametersSource, result.serviceTier),
    httpStatus: 200,
    usage: result.usage,
    stopReason: result.stopReason,
    tools: extractAvailableToolCalls('openai', context.params),
    completionId: result.completionId,
    providerMetadata: buildProviderMetadata({
      systemFingerprint: result.systemFingerprint,
      requestId: result.requestId,
    }),
  }
}

export function buildChatErrorOptions(
  context: CommonContext<ChatParams>,
  error: unknown,
  metadata: {
    completionId?: string
    systemFingerprint?: string
    usage?: TokenUsage
    latency?: number
  } = {}
): CaptureAiGenerationOptions {
  return {
    ...context.monitoring,
    model: context.params.model,
    provider: context.provider,
    input: sanitizeOpenAI(context.params.messages, context.client),
    output: [],
    latency: metadata.latency ?? 0,
    baseURL: context.baseURL,
    modelParameters: getModelParams(context.modelParametersSource),
    // A stream that fails partway has still consumed everything it read, so pass
    // on whatever the accumulator collected. Left empty when the caller has no
    // usage to give, which keeps the counts absent rather than reporting zero.
    usage: metadata.usage ?? {},
    completionId: metadata.completionId,
    providerMetadata: buildProviderMetadata({ systemFingerprint: metadata.systemFingerprint }),
    error,
  }
}

function buildSanitizedResponsesInput(context: CommonContext<ResponsesParams>): unknown {
  return formatOpenAIResponsesInput(
    sanitizeOpenAIResponse(context.params.input, context.client),
    sanitizeOpenAIResponse(context.params.instructions, context.client) as string | null | undefined
  )
}

export function buildResponsesSuccessOptions(
  context: CommonContext<ResponsesParams>,
  result: {
    response: OpenAIResponseTelemetry
    output: unknown
    latency?: number
    timeToFirstToken?: number
    usage?: TokenUsage
    includeTools?: boolean
    includeRequestId?: boolean
  }
): CaptureAiGenerationOptions {
  const response = result.response
  return {
    ...context.monitoring,
    model: context.params.model ?? response.model,
    provider: context.provider,
    input: buildSanitizedResponsesInput(context),
    output: sanitizeOpenAIResponse(result.output, context.client),
    latency: result.latency,
    timeToFirstToken: result.timeToFirstToken,
    baseURL: context.baseURL,
    modelParameters: getModelParams(context.modelParametersSource, response.service_tier),
    httpStatus: 200,
    usage: result.usage ?? buildResponsesUsage(response.usage, response),
    stopReason: response.status ?? undefined,
    tools: result.includeTools ? extractAvailableToolCalls('openai', context.params) : undefined,
    completionId: response.id,
    providerMetadata: buildProviderMetadata({
      requestId: result.includeRequestId ? extractRequestId(response) : undefined,
      incompleteDetails: response.incomplete_details,
    }),
    error: getResponseFailure({ id: response.id, status: response.status, error: response.error ?? null }),
  }
}

export function buildBackgroundResponseOptions(
  context: CommonContext<ResponsesParams>,
  response: OpenAI.Responses.Response
): CaptureAiGenerationOptions {
  return buildResponsesSuccessOptions(context, {
    response,
    output: formatResponseOpenAI({ output: response.output }),
    latency: getBackgroundResponseLatency(response),
    includeTools: true,
    includeRequestId: true,
  })
}

export function buildResponsesErrorOptions(
  context: CommonContext<ResponsesParams>,
  error: unknown,
  metadata: { completionId?: string; usage?: TokenUsage; latency?: number } = {}
): CaptureAiGenerationOptions {
  return {
    ...context.monitoring,
    model: context.params.model,
    provider: context.provider,
    input: buildSanitizedResponsesInput(context),
    output: [],
    latency: metadata.latency ?? 0,
    baseURL: context.baseURL,
    modelParameters: getModelParams(context.modelParametersSource),
    // Left empty when the caller has no usage to give, so the counts stay absent
    // rather than reporting that the call consumed nothing.
    usage: metadata.usage ?? {},
    completionId: metadata.completionId,
    error,
  }
}

export function buildEmbeddingSuccessOptions(
  context: CommonContext<OpenAI.EmbeddingCreateParams>,
  usage: OpenAI.CreateEmbeddingResponse.Usage | undefined,
  latency: number
): CaptureAiGenerationOptions {
  return {
    eventType: AIEvent.Embedding,
    ...context.monitoring,
    model: context.params.model,
    provider: context.provider,
    input: withPrivacyMode(context.client, context.monitoring.privacyMode, context.params.input),
    output: null,
    latency,
    baseURL: context.baseURL,
    modelParameters: getModelParams(context.modelParametersSource),
    httpStatus: 200,
    usage: { inputTokens: usage?.prompt_tokens ?? 0, rawUsage: usage },
  }
}

export function buildEmbeddingErrorOptions(
  context: CommonContext<OpenAI.EmbeddingCreateParams>,
  error: unknown
): CaptureAiGenerationOptions {
  return {
    eventType: AIEvent.Embedding,
    ...context.monitoring,
    model: context.params.model,
    provider: context.provider,
    input: withPrivacyMode(context.client, context.monitoring.privacyMode, context.params.input),
    output: null,
    latency: 0,
    baseURL: context.baseURL,
    modelParameters: getModelParams(context.modelParametersSource),
    // The call returned no usage, and a failure this side of a response can
    // still have consumed the input, so report no count rather than zero.
    usage: {},
    error,
  }
}
