import { EventMessage, PostHog } from 'posthog-node'
import type { ChatCompletionTool } from 'openai/resources/chat/completions'
import type { Tool as GeminiTool } from '@google/genai'
import AnthropicOriginal from '@anthropic-ai/sdk'
import { v4 as uuidv4 } from 'uuid'
import { uuidv7, ErrorTracking as CoreErrorTracking } from '@posthog/core'
import { version } from '../package.json'
import type { TokenUsage } from './types'
import { AIEvent, CostOverride, getTokensSource, sanitizeValues, withPrivacyMode } from './utils'

type AnthropicTool = AnthropicOriginal.Tool

/**
 * Options for `captureAiGeneration`. Mirrors the `$ai_generation` event shape
 * directly so that any caller — first-party SDK wrappers and external code
 * alike — produces an identical event.
 */
export interface CaptureAiGenerationOptions {
  distinctId?: string
  /** Auto-generated when omitted. */
  traceId?: string
  /** Defaults to `$ai_generation`. */
  eventType?: AIEvent

  /** Required for the event to be useful, but accepted as optional so SDK wrappers can pass through whatever they detect. */
  model?: string
  provider: string
  input: unknown
  output: unknown

  /** Maps to `$ai_model_parameters` (temperature, max_tokens, top_p, …). */
  modelParameters?: Record<string, unknown>

  baseURL?: string
  httpStatus?: number
  /** Wall-clock latency in seconds. */
  latency?: number
  /** Time from request start to the first streamed token, in seconds. */
  timeToFirstToken?: number

  usage?: TokenUsage

  /** Extra event properties merged into the captured event. */
  properties?: Record<string, unknown>
  /** Mapping of group type to group id, matching `EventMessage.groups`. */
  groups?: Record<string, string | number>
  privacyMode?: boolean

  /**
   * For SDK wrappers: overrides the auto-detected model. External callers
   * should pass `model` directly instead.
   */
  modelOverride?: string
  /**
   * For SDK wrappers: overrides the auto-detected provider. External callers
   * should pass `provider` directly instead.
   */
  providerOverride?: string
  costOverride?: CostOverride

  tools?: ChatCompletionTool[] | AnthropicTool[] | GeminiTool[] | null
  stopReason?: string
  /** When set, the event is captured as an error. */
  error?: unknown

  /** Awaits delivery instead of batching. Useful in serverless environments. */
  captureImmediate?: boolean
}

/**
 * Capture an `$ai_generation` (or `$ai_embedding`) event to PostHog.
 *
 * This is the canonical primitive that every `@posthog/ai` wrapper
 * (`withTracing`, `OpenAI`, `Anthropic`, `GoogleGenAI`, …) funnels through, so
 * external code can use it directly to instrument LLM calls made through
 * arbitrary clients (Cloudflare Workers AI, custom HTTP, etc.) and get the
 * same events the SDK wrappers produce.
 *
 * When `error` is set, the event is captured as an error. If the error is an
 * object, it is mutated in place to set `__posthog_previously_captured_error`
 * so callers can re-throw the original error reference safely.
 */
export const captureAiGeneration = async (client: PostHog, options: CaptureAiGenerationOptions): Promise<void> => {
  if (!client.capture) {
    return
  }

  const traceId = options.traceId ?? uuidv4()
  const eventType = options.eventType ?? AIEvent.Generation
  const privacyMode = options.privacyMode ?? false
  const usage = options.usage ?? {}

  const safeInput = sanitizeValues(options.input)
  const safeOutput = sanitizeValues(options.output)

  let httpStatus = options.httpStatus
  let errorData: Record<string, unknown> = {}
  if (options.error) {
    if (httpStatus === undefined) {
      if (typeof options.error === 'object' && 'status' in options.error && typeof options.error.status === 'number') {
        httpStatus = options.error.status
      } else {
        httpStatus = 500
      }
    }

    let exceptionId: string | undefined
    if (client.options?.enableExceptionAutocapture) {
      exceptionId = uuidv7()
      client.captureException(options.error, undefined, { $ai_trace_id: traceId }, exceptionId)
      if (typeof options.error === 'object') {
        ;(options.error as CoreErrorTracking.PreviouslyCapturedError).__posthog_previously_captured_error = true
      }
    }

    errorData = {
      $ai_is_error: true,
      $ai_error: sanitizeValues(JSON.stringify(options.error)),
      $exception_event_id: exceptionId,
    }
  }
  httpStatus = httpStatus ?? 200

  let costOverrideData: Record<string, number> = {}
  if (options.costOverride) {
    const inputCostUSD = (options.costOverride.inputCost ?? 0) * (usage.inputTokens ?? 0)
    const outputCostUSD = (options.costOverride.outputCost ?? 0) * (usage.outputTokens ?? 0)
    costOverrideData = {
      $ai_input_cost_usd: inputCostUSD,
      $ai_output_cost_usd: outputCostUSD,
      $ai_total_cost_usd: inputCostUSD + outputCostUSD,
    }
  }

  const additionalTokenValues = {
    ...(usage.reasoningTokens ? { $ai_reasoning_tokens: usage.reasoningTokens } : {}),
    ...(usage.cacheReadInputTokens ? { $ai_cache_read_input_tokens: usage.cacheReadInputTokens } : {}),
    ...(usage.cacheCreationInputTokens ? { $ai_cache_creation_input_tokens: usage.cacheCreationInputTokens } : {}),
    ...(usage.webSearchCount ? { $ai_web_search_count: usage.webSearchCount } : {}),
    ...(usage.rawUsage ? { $ai_usage: usage.rawUsage } : {}),
  }

  const properties: Record<string, unknown> = {
    $ai_lib: 'posthog-ai',
    $ai_lib_version: version,
    $ai_provider: options.providerOverride ?? options.provider,
    $ai_model: options.modelOverride ?? options.model,
    $ai_model_parameters: options.modelParameters ?? {},
    $ai_input: withPrivacyMode(client, privacyMode, safeInput),
    $ai_output_choices: withPrivacyMode(client, privacyMode, safeOutput),
    $ai_http_status: httpStatus,
    $ai_input_tokens: usage.inputTokens ?? 0,
    ...(usage.outputTokens !== undefined ? { $ai_output_tokens: usage.outputTokens } : {}),
    ...additionalTokenValues,
    $ai_latency: options.latency ?? 0,
    ...(options.timeToFirstToken !== undefined ? { $ai_time_to_first_token: options.timeToFirstToken } : {}),
    $ai_trace_id: traceId,
    $ai_base_url: options.baseURL ?? '',
    ...options.properties,
    $ai_tokens_source: getTokensSource(options.properties),
    ...(options.distinctId ? {} : { $process_person_profile: false }),
    ...(options.stopReason ? { $ai_stop_reason: options.stopReason } : {}),
    ...(options.tools ? { $ai_tools: options.tools } : {}),
    ...errorData,
    ...costOverrideData,
  }

  const event: EventMessage = {
    distinctId: options.distinctId ?? traceId,
    event: eventType,
    properties,
    groups: options.groups,
  }

  if (options.captureImmediate) {
    await client.captureImmediate(event)
  } else {
    client.capture(event)
  }
}
