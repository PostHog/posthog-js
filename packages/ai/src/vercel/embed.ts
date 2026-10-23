import { embed, embedMany } from 'ai'
import type { PostHog } from 'posthog-node'
import { captureAiGeneration, type CaptureAiGenerationOptions } from '../captureAiGeneration'
import { AIEvent, extractPosthogParams, withPrivacyMode, type MonitoringParams } from '../utils'
import { extractBaseURL, extractProvider } from './middleware'

type EmbedParams = Parameters<typeof embed>[0]
type EmbedManyParams = Parameters<typeof embedMany>[0]
type EmbeddingModel = EmbedParams['model']

export type EmbedWithTracingParams = EmbedParams & MonitoringParams & { posthog: PostHog }
export type EmbedManyWithTracingParams = EmbedManyParams & MonitoringParams & { posthog: PostHog }

// String model IDs resolve through the AI SDK global provider, which defaults to the Vercel AI Gateway.
const getModelInfo = (
  model: EmbeddingModel
): { modelId: string; provider: string; baseURL: string; frameworkVersion?: string } => {
  if (typeof model === 'string') {
    return { modelId: model, provider: 'gateway', baseURL: '' }
  }
  return {
    modelId: model.modelId,
    provider: extractProvider(model),
    baseURL: extractBaseURL(model),
    frameworkVersion: model.specificationVersion === 'v3' ? '6' : '5',
  }
}

const traceEmbedding = async <P extends { model: EmbeddingModel }, R extends { usage: { tokens: number } }>(
  { posthog, ...params }: P & MonitoringParams & { posthog: PostHog },
  input: unknown,
  call: (params: P) => Promise<R>
): Promise<R> => {
  const { providerParams, posthogParams } = extractPosthogParams(params as unknown as P & MonitoringParams)
  const { modelId, provider, baseURL, frameworkVersion } = getModelInfo(providerParams.model)
  const baseOptions: CaptureAiGenerationOptions = {
    ...posthogParams,
    eventType: AIEvent.Embedding,
    model: modelId,
    provider,
    input: withPrivacyMode(posthog, posthogParams.privacyMode, input),
    output: null,
    baseURL,
    properties: {
      ...posthogParams.properties,
      $ai_framework: 'vercel',
      ...(frameworkVersion ? { $ai_framework_version: frameworkVersion } : {}),
    },
  }
  const startTime = Date.now()

  try {
    const result = await call(providerParams)
    await captureAiGeneration(posthog, {
      ...baseOptions,
      latency: (Date.now() - startTime) / 1000,
      httpStatus: 200,
      usage: { inputTokens: result.usage.tokens, rawUsage: result.usage },
    })
    return result
  } catch (error: unknown) {
    await captureAiGeneration(posthog, {
      ...baseOptions,
      latency: (Date.now() - startTime) / 1000,
      usage: {},
      error,
    })
    throw error
  }
}

export const embedWithTracing = (params: EmbedWithTracingParams): ReturnType<typeof embed> =>
  traceEmbedding(params, params.value, embed)

export const embedManyWithTracing = (params: EmbedManyWithTracingParams): ReturnType<typeof embedMany> =>
  traceEmbedding(params, params.values, embedMany)
