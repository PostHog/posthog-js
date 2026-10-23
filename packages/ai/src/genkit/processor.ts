import type { PostHog } from 'posthog-node'
import { version } from '../../package.json'
import { captureAiEvent } from '../captureAiEvent'
import { captureAiGeneration } from '../captureAiGeneration'
import { stringifyError } from '../serializeError'
import { formatToolResult } from '../toolResult'
import type { FormattedMessage } from '../types'
import { MAX_OUTPUT_SIZE, isPrivacyModeEnabled } from '../utils'

// SpanStatusCode.ERROR from @opentelemetry/api.
const SPAN_STATUS_ERROR = 2

const MODEL_PARAMETER_KEYS = ['temperature', 'maxOutputTokens', 'topK', 'topP', 'stopSequences']

/**
 * The fields of an OpenTelemetry `ReadableSpan` that the processor reads. Genkit 1.x runs on
 * OpenTelemetry SDK 1.x, so the type is structural instead of imported from the 2.x SDK.
 */
interface GenkitSpan {
  name: string
  attributes: Record<string, unknown>
  duration: [number, number]
  status: { code: number; message?: string }
  events?: { name: string; attributes?: Record<string, unknown> }[]
  spanContext(): { traceId: string; spanId: string }
  /** OpenTelemetry SDK 1.x */
  parentSpanId?: string
  /** OpenTelemetry SDK 2.x */
  parentSpanContext?: { spanId: string }
}

interface GenkitPart {
  text?: string
  reasoning?: string
  toolRequest?: { name: string; ref?: string; input?: unknown }
  toolResponse?: { name: string; ref?: string; output?: unknown }
}

interface GenkitMessage {
  role: string
  content?: GenkitPart[]
}

interface GenkitModelRequest {
  messages?: GenkitMessage[]
  config?: Record<string, unknown>
  tools?: unknown[]
}

interface GenkitModelResponse {
  message?: GenkitMessage
  finishReason?: string
  /** Older response shape, still returned by some plugins such as `@genkit-ai/google-genai`. */
  candidates?: { message?: GenkitMessage; finishReason?: string }[]
  usage?: {
    inputTokens?: number
    outputTokens?: number
    thoughtsTokens?: number
    cachedContentTokens?: number
  }
}

export interface PostHogGenkitSpanProcessorOptions {
  /** The PostHog client used to capture events. */
  client: PostHog
  /**
   * Distinct ID for the captured events. When omitted, the distinct ID from `client.withContext()` is used
   * if there is one. Otherwise events are captured anonymously (personless) keyed by the trace ID.
   */
  distinctId?: string
  /** Leaves out inputs and outputs when true. Defaults to false. */
  privacyMode?: boolean
  /** Group analytics mapping (group type -> group id) attached to every event. */
  groups?: Record<string, string | number>
  /** Extra properties merged into every captured event. */
  properties?: Record<string, unknown>
  /** Invoked when the processor fails to capture an event. Never throws into the Genkit flow. */
  onError?: (error: unknown) => void
}

/**
 * An OpenTelemetry span processor that turns Genkit spans into PostHog AI events.
 *
 * - The root span of a Genkit trace (usually a flow) becomes an `$ai_trace`.
 * - Each model action becomes an `$ai_generation` with input, output, token usage, latency and tools.
 * - Every other Genkit span (tools, `generate` steps, retrievers, ...) becomes an `$ai_span`.
 *
 * Spans without Genkit attributes are ignored.
 *
 * @example
 * ```typescript
 * import { enableTelemetry } from 'genkit/tracing'
 * import { PostHogGenkitSpanProcessor } from '@posthog/ai/genkit'
 * import { PostHog } from 'posthog-node'
 *
 * const phClient = new PostHog('<POSTHOG_API_KEY>')
 *
 * await enableTelemetry({
 *   spanProcessors: [new PostHogGenkitSpanProcessor({ client: phClient })],
 * })
 * ```
 *
 * In serverless functions, call `await flushTracing()` from `genkit/tracing` before the function
 * returns. It calls {@link PostHogGenkitSpanProcessor.forceFlush}, which flushes the PostHog client.
 */
export class PostHogGenkitSpanProcessor {
  private readonly _client: PostHog
  private readonly _distinctId?: string
  private readonly _privacyMode: boolean
  private readonly _groups?: Record<string, string | number>
  private readonly _properties: Record<string, unknown>
  private readonly _onError?: (error: unknown) => void

  constructor(options: PostHogGenkitSpanProcessorOptions) {
    this._client = options.client
    this._distinctId = options.distinctId
    this._privacyMode = options.privacyMode ?? false
    this._groups = options.groups
    this._properties = options.properties ?? {}
    this._onError = options.onError
  }

  onStart(): void {}

  onEnd(span: GenkitSpan): void {
    try {
      if (typeof span.attributes['genkit:type'] !== 'string') {
        return
      }
      if (span.attributes['genkit:metadata:subtype'] === 'model') {
        this._captureGeneration(span)
      } else {
        this._captureSpan(span)
      }
    } catch (error) {
      this._handleError(error)
    }
  }

  async forceFlush(): Promise<void> {
    try {
      await this._client.flush()
    } catch (error) {
      this._handleError(error)
    }
  }

  async shutdown(): Promise<void> {
    await this.forceFlush()
  }

  private _captureGeneration(span: GenkitSpan): void {
    const request = parseAttribute(span, 'genkit:input') as GenkitModelRequest | undefined
    const response = parseAttribute(span, 'genkit:output') as GenkitModelResponse | undefined
    const usage = response?.usage
    const message = response?.message ?? response?.candidates?.[0]?.message
    const finishReason = response?.finishReason ?? response?.candidates?.[0]?.finishReason
    // Genkit names models `<plugin>/<model>`, for example `vertexai/gemini-2.5-flash`.
    const slash = span.name.indexOf('/')
    const shouldRedact = isPrivacyModeEnabled(this._client, this._privacyMode)
    const { traceId, spanId, parentId } = spanIds(span)

    void captureAiGeneration(this._client, {
      distinctId: this._resolveDistinctId(),
      traceId,
      model: span.name.slice(slash + 1),
      provider: slash > 0 ? span.name.slice(0, slash) : '',
      baseURL: null,
      input: shouldRedact ? null : this._formatMessages(request?.messages ?? []),
      output: shouldRedact ? null : this._formatMessages(message ? [message] : []),
      latency: latencySeconds(span),
      modelParameters: pickModelParameters(request?.config),
      tools: request?.tools?.length ? request.tools : null,
      usage: usage && {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        reasoningTokens: usage.thoughtsTokens,
        cacheReadInputTokens: usage.cachedContentTokens,
        rawUsage: usage,
      },
      stopReason: finishReason,
      groups: this._groups,
      privacyMode: this._privacyMode,
      onError: this._onError,
      error: spanError(span),
      properties: {
        $ai_framework: 'genkit',
        $ai_span_id: spanId,
        $ai_parent_id: parentId,
        $ai_span_name: span.name,
        ...this._properties,
      },
    })
  }

  private _captureSpan(span: GenkitSpan): void {
    const isRoot = span.attributes['genkit:isRoot'] === true
    const { traceId, spanId, parentId } = spanIds(span)
    const distinctId = this._resolveDistinctId()
    const error = spanError(span)

    captureAiEvent(this._client, {
      distinctId: distinctId ?? traceId,
      event: isRoot ? '$ai_trace' : '$ai_span',
      properties: {
        $ai_lib: 'posthog-ai',
        $ai_lib_version: version,
        $ai_framework: 'genkit',
        $ai_trace_id: traceId,
        $ai_span_id: spanId,
        ...(!isRoot && parentId ? { $ai_parent_id: parentId } : {}),
        $ai_span_name: span.name,
        $ai_span_type: span.attributes['genkit:metadata:subtype'] ?? span.attributes['genkit:type'],
        $ai_input_state: this._formatState(span, 'genkit:input'),
        $ai_output_state: this._formatState(span, 'genkit:output'),
        $ai_latency: latencySeconds(span),
        ...(error ? { $ai_is_error: true, $ai_error: stringifyError(error) } : {}),
        ...this._properties,
        ...(distinctId ? {} : { $process_person_profile: false }),
      },
      groups: this._groups,
    })
  }

  private _resolveDistinctId(): string | undefined {
    // span.end() runs inside the Genkit action, so a posthog-node context entered around the call is still active.
    return this._distinctId ?? this._client.getContext?.()?.distinctId
  }

  private _handleError(error: unknown): void {
    try {
      this._onError?.(error)
    } catch {
      // span.end() runs inside the Genkit action, so the processor must never throw into it.
    }
  }

  private _formatState(span: GenkitSpan, key: string): unknown {
    if (isPrivacyModeEnabled(this._client, this._privacyMode)) {
      return null
    }
    return formatToolResult(parseAttribute(span, key), this._client, MAX_OUTPUT_SIZE)
  }

  private _formatMessages(messages: GenkitMessage[]): FormattedMessage[] {
    const formatted = messages.map((message) => ({
      role: message.role === 'model' ? 'assistant' : message.role,
      content: (message.content ?? []).map(formatPart),
    }))
    // Redacts base64 media and bounds long strings, the same way the Claude Agent SDK integration does.
    return formatToolResult(formatted, this._client, MAX_OUTPUT_SIZE) as FormattedMessage[]
  }
}

function formatPart(part: GenkitPart): unknown {
  if (typeof part.text === 'string') {
    return { type: 'text', text: part.text }
  }
  if (typeof part.reasoning === 'string') {
    return { type: 'reasoning', text: part.reasoning }
  }
  if (part.toolRequest) {
    return {
      type: 'function',
      id: part.toolRequest.ref,
      function: { name: part.toolRequest.name, arguments: part.toolRequest.input ?? {} },
    }
  }
  if (part.toolResponse) {
    return {
      type: 'tool_result',
      tool_use_id: part.toolResponse.ref,
      name: part.toolResponse.name,
      content: part.toolResponse.output,
    }
  }
  // Media, data and custom parts keep their Genkit shape.
  return part
}

/** Genkit stores span input and output as JSON strings. */
function parseAttribute(span: GenkitSpan, key: string): unknown {
  const value = span.attributes[key]
  if (typeof value !== 'string') {
    return undefined
  }
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function spanIds(span: GenkitSpan): { traceId: string; spanId: string; parentId?: string } {
  const { traceId, spanId } = span.spanContext()
  return { traceId, spanId, parentId: span.parentSpanContext?.spanId ?? span.parentSpanId }
}

function latencySeconds(span: GenkitSpan): number {
  return span.duration[0] + span.duration[1] / 1e9
}

function spanError(span: GenkitSpan): { name?: unknown; message?: string } | undefined {
  if (span.status.code !== SPAN_STATUS_ERROR) {
    return undefined
  }
  const exception = span.events?.find((event) => event.name === 'exception')?.attributes
  return { name: exception?.['exception.type'], message: span.status.message }
}

function pickModelParameters(config: Record<string, unknown> | undefined): Record<string, unknown> {
  // Only common sampling settings: plugin config can also hold values such as an API key.
  const parameters: Record<string, unknown> = {}
  for (const key of MODEL_PARAMETER_KEYS) {
    if (config?.[key] !== undefined) {
      parameters[key] = config[key]
    }
  }
  return parameters
}
