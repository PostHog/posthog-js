import { PostHog } from 'posthog-node'
import { v4 as uuidv4 } from 'uuid'
import { sendEventToPosthog, sendEventWithErrorToPosthog, AIEvent } from './utils'
import type { TokenUsage } from './types'
import type { MonitoringParams } from './utils'

export interface CaptureAiGenerationOptions {
  /** Distinct ID of the user */
  distinctId?: string
  /** Trace ID for the generation. Automatically generated if not provided */
  traceId?: string
  /** The AI provider (e.g. 'cloudflare-workers-ai', 'openai') */
  provider?: string
  /** The model used (e.g. '@cf/zai-org/glm-4.7-flash') */
  model?: string
  /** The input/prompt passed to the model */
  input?: any
  /** The output/response from the model */
  output?: any
  /** Token usage statistics */
  usage?: TokenUsage
  /** Request latency in seconds */
  latency?: number
  /** Time to first token in seconds (for streaming) */
  timeToFirstToken?: number
  /** The base URL of the API */
  baseURL?: string
  /** HTTP status code of the response. Ignored if an error is provided. */
  httpStatus?: number
  /** Any error that occurred during the generation */
  error?: unknown
  /** Reason why the generation stopped */
  stopReason?: string
  /** Tools available to the model */
  tools?: any[]
  /** Any additional PostHog properties to attach to the event */
  properties?: Record<string, unknown>
  /** Any PostHog groups to attach to the event */
  groups?: Record<string, string>
  /** Wait for the event to be sent immediately */
  captureImmediate?: boolean
  /** Whether to redact the input and output */
  privacyMode?: boolean
}

export const captureAiGeneration = async (
  client: PostHog,
  options: CaptureAiGenerationOptions
): Promise<void> => {
  const {
    distinctId,
    traceId = uuidv4(),
    provider = 'unknown',
    model,
    input,
    output,
    usage = {},
    latency = 0,
    timeToFirstToken,
    baseURL = '',
    httpStatus = 200,
    error,
    stopReason,
    tools,
    properties,
    groups,
    captureImmediate = false,
    privacyMode = false,
  } = options

  const params: MonitoringParams = {
    posthogProperties: properties,
    posthogGroups: groups,
    posthogPrivacyMode: privacyMode,
  }

  if (error) {
    await sendEventWithErrorToPosthog({
      client,
      distinctId,
      traceId,
      provider,
      model,
      input,
      output: output || [],
      usage,
      latency,
      timeToFirstToken,
      baseURL,
      stopReason,
      tools,
      params: params as any,
      captureImmediate,
      error,
    })
  } else {
    await sendEventToPosthog({
      client,
      eventType: AIEvent.Generation,
      distinctId,
      traceId,
      provider,
      model,
      input,
      output,
      usage,
      latency,
      timeToFirstToken,
      baseURL,
      httpStatus,
      stopReason,
      tools,
      params: params as any,
      captureImmediate,
    })
  }
}
