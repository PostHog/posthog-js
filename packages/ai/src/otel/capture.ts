import { v4 as uuidv4 } from 'uuid'
import { PostHog } from 'posthog-node'
import { sendEventToPosthog, sendEventWithErrorToPosthog } from '../utils'
import { defaultSpanMappers } from './mappers'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import type { PostHogTelemetryOptions, PostHogSpanMapper, UsageData } from './types'

function pickMapper(span: ReadableSpan, mappers: PostHogSpanMapper[]): PostHogSpanMapper | undefined {
  return mappers.find((mapper) => {
    try {
      return mapper.canMap(span)
    } catch {
      return false
    }
  })
}

function getTraceId(span: ReadableSpan, options: PostHogTelemetryOptions, mapperTraceId?: string): string {
  if (mapperTraceId) {
    return mapperTraceId
  }
  if (options.posthogTraceId) {
    return options.posthogTraceId
  }
  const spanTraceId = span.spanContext?.().traceId
  return spanTraceId || uuidv4()
}

function buildPosthogParams(
  options: PostHogTelemetryOptions,
  traceId: string,
  distinctId: string | undefined,
  modelParams: Record<string, unknown>,
  posthogProperties: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...modelParams,
    posthogDistinctId: distinctId,
    posthogTraceId: traceId,
    posthogProperties,
    posthogPrivacyMode: options.posthogPrivacyMode,
    posthogGroups: options.posthogGroups,
    posthogModelOverride: options.posthogModelOverride,
    posthogProviderOverride: options.posthogProviderOverride,
    posthogCostOverride: options.posthogCostOverride,
    posthogCaptureImmediate: options.posthogCaptureImmediate,
  }
}

export async function captureSpan(
  span: ReadableSpan,
  phClient: PostHog,
  options: PostHogTelemetryOptions = {}
): Promise<void> {
  if (options.shouldExportSpan && options.shouldExportSpan({ otelSpan: span }) === false) {
    return
  }

  const mappers = options.mappers ?? defaultSpanMappers
  const mapper = pickMapper(span, mappers)
  if (!mapper) {
    return
  }

  const mapped = mapper.map(span, { options })
  if (!mapped) {
    return
  }

  const traceId = getTraceId(span, options, mapped.traceId)
  const distinctId = mapped.distinctId ?? options.posthogDistinctId
  const posthogProperties = {
    ...options.posthogProperties,
    ...mapped.posthogProperties,
  }

  const params = buildPosthogParams(options, traceId, distinctId, mapped.modelParams ?? {}, posthogProperties)
  const baseURL = mapped.baseURL ?? ''
  const usage: UsageData = mapped.usage ?? {}

  if (mapped.error !== undefined) {
    await sendEventWithErrorToPosthog({
      eventType: mapped.eventType,
      client: phClient,
      distinctId,
      traceId,
      model: mapped.model,
      provider: mapped.provider,
      input: mapped.input,
      output: mapped.output,
      latency: mapped.latency,
      baseURL,
      params: params as any,
      usage,
      tools: mapped.tools,
      error: mapped.error,
      captureImmediate: options.posthogCaptureImmediate,
    })
    return
  }

  await sendEventToPosthog({
    eventType: mapped.eventType,
    client: phClient,
    distinctId,
    traceId,
    model: mapped.model,
    provider: mapped.provider,
    input: mapped.input,
    output: mapped.output,
    latency: mapped.latency,
    timeToFirstToken: mapped.timeToFirstToken,
    baseURL,
    params: params as any,
    httpStatus: mapped.httpStatus ?? 200,
    usage,
    tools: mapped.tools,
    captureImmediate: options.posthogCaptureImmediate,
  })
}
