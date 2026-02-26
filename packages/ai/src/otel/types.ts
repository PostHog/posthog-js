import type { CostOverride } from '../utils'
import type { AIEvent } from '../utils'
import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace-base'

export type UsageData = Record<string, unknown>

export interface PostHogSpanMapperContext {
  options: PostHogTelemetryOptions
}

export interface PostHogSpanMapperResult {
  distinctId?: string
  traceId?: string
  model?: string
  provider: string
  input: any
  output: any
  latency: number
  timeToFirstToken?: number
  baseURL?: string
  httpStatus?: number
  eventType?: AIEvent
  usage?: UsageData
  tools?: any[] | null
  modelParams?: Record<string, unknown>
  posthogProperties?: Record<string, unknown>
  error?: unknown
}

export interface PostHogSpanMapper {
  name: string
  canMap: (span: ReadableSpan) => boolean
  map: (span: ReadableSpan, context: PostHogSpanMapperContext) => PostHogSpanMapperResult | null
}

export type ShouldExportSpan = (params: { otelSpan: ReadableSpan }) => boolean

export interface PostHogTelemetryOptions {
  posthogDistinctId?: string
  posthogTraceId?: string
  posthogProperties?: Record<string, any>
  posthogPrivacyMode?: boolean
  posthogGroups?: Record<string, any>
  posthogModelOverride?: string
  posthogProviderOverride?: string
  posthogCostOverride?: CostOverride
  posthogCaptureImmediate?: boolean
  mappers?: PostHogSpanMapper[]
  shouldExportSpan?: ShouldExportSpan
}

export type PostHogReadableSpan = ReadableSpan
export type PostHogTelemetrySpanProcessor = SpanProcessor
