import type { PostHog } from 'posthog-node'
import { version } from '../../package.json'
import { captureAiEvent } from '../captureAiEvent'
import { captureAiGeneration } from '../captureAiGeneration'
import { formatAiError } from '../serializeError'
import { formatToolResult } from '../toolResult'
import { isObject } from '../typeGuards'
import type { FormattedMessage } from '../types'
import { AIEvent, MAX_OUTPUT_SIZE, formatInlineDataBlock, isPrivacyModeEnabled } from '../utils'

// SpanStatusCode.ERROR from @opentelemetry/api.
const SPAN_STATUS_ERROR = 2

const MODEL_PARAMETER_KEYS = ['temperature', 'maxOutputTokens', 'topK', 'topP', 'stopSequences']

// Plugin config is part of the span input and output, so `config.apiKey` would otherwise be captured.
// Keys are compared in lower case without `-` and `_`.
const CREDENTIAL_KEYS = new Set([
  'apikey',
  'accesstoken',
  'authorization',
  'clientsecret',
  'headers',
  'password',
  'secret',
  'token',
])

// Genkit plugin names that differ from the provider names the other integrations send.
const PROVIDER_NAMES = new Map([
  ['googleai', 'gemini'],
  ['vertexai', 'vertex'],
])

const STACK_ERROR_NAME = /^([A-Za-z_$][\w$]*)(?=:|\n|$)/

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
  media?: { url: string; contentType?: string }
}

interface GenkitMessage {
  role: string
  content?: GenkitPart[]
}

interface GenkitEmbedRequest {
  input?: { content?: GenkitPart[] }[]
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
   * Distinct ID for the captured events. When omitted, the distinct ID from `client.withContext()` at
   * span start is used if there is one. Otherwise events are captured anonymously (personless) keyed by the trace ID.
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
 * - Each embedder action becomes an `$ai_embedding`.
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
  private readonly _spanDistinctIds = new WeakMap<object, string>()

  constructor(options: PostHogGenkitSpanProcessorOptions) {
    this._client = options.client
    this._distinctId = options.distinctId
    this._privacyMode = options.privacyMode ?? false
    this._groups = options.groups
    this._properties = options.properties ?? {}
    this._onError = options.onError
  }

  onStart(span: Pick<GenkitSpan, 'spanContext'>): void {
    try {
      const distinctId = this._distinctId ?? this._client.getContext?.()?.distinctId
      if (distinctId !== undefined) {
        this._spanDistinctIds.set(span, distinctId)
      }
    } catch (error) {
      this._handleError(error)
    }
  }

  onEnd(span: GenkitSpan): void {
    const distinctId = this._distinctId ?? this._spanDistinctIds.get(span)
    this._spanDistinctIds.delete(span)
    try {
      if (typeof span.attributes['genkit:type'] !== 'string') {
        return
      }
      const subtype = span.attributes['genkit:metadata:subtype']
      if (subtype === 'model') {
        this._captureGeneration(span, distinctId)
      } else if (subtype === 'embedder') {
        this._captureEmbedding(span, distinctId)
      } else {
        this._captureSpan(span, distinctId)
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

  private _captureGeneration(span: GenkitSpan, distinctId?: string): void {
    const request = parseAttribute(span, 'genkit:input') as GenkitModelRequest | undefined
    const response = parseAttribute(span, 'genkit:output') as GenkitModelResponse | undefined
    const usage = response?.usage
    const message = response?.message ?? response?.candidates?.[0]?.message
    const finishReason = response?.finishReason ?? response?.candidates?.[0]?.finishReason
    const shouldRedact = isPrivacyModeEnabled(this._client, this._privacyMode)
    const { traceId, spanId, parentId } = spanIds(span)

    void captureAiGeneration(this._client, {
      distinctId,
      traceId,
      ...modelAndProvider(span.name),
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

  private _captureEmbedding(span: GenkitSpan, distinctId?: string): void {
    const request = parseAttribute(span, 'genkit:input') as GenkitEmbedRequest | undefined
    const shouldRedact = isPrivacyModeEnabled(this._client, this._privacyMode)
    const { traceId, spanId, parentId } = spanIds(span)
    const input = (request?.input ?? []).map((document) => formatDocument(document.content ?? [], this._client))

    // Genkit embed responses carry only the vectors, so there is no output or token usage to capture.
    void captureAiGeneration(this._client, {
      eventType: AIEvent.Embedding,
      distinctId,
      traceId,
      ...modelAndProvider(span.name),
      baseURL: null,
      input: shouldRedact ? null : formatToolResult(input, this._client, MAX_OUTPUT_SIZE),
      output: null,
      latency: latencySeconds(span),
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

  private _captureSpan(span: GenkitSpan, distinctId?: string): void {
    const isRoot = span.attributes['genkit:isRoot'] === true
    const { traceId, spanId, parentId } = spanIds(span)
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
        ...(error
          ? {
              $ai_is_error: true,
              $ai_error: formatAiError(error, isPrivacyModeEnabled(this._client, this._privacyMode)),
            }
          : {}),
        ...this._properties,
        ...(distinctId ? {} : { $process_person_profile: false }),
      },
      groups: this._groups,
    })
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
    return formatToolResult(redactCredentials(parseAttribute(span, key)), this._client, MAX_OUTPUT_SIZE)
  }

  private _formatMessages(messages: GenkitMessage[]): FormattedMessage[] {
    const formatted = messages.map((message) => ({
      role: message.role === 'model' ? 'assistant' : message.role,
      content: (message.content ?? []).map((part) => formatPart(part, this._client)),
    }))
    // Redacts base64 media and bounds long strings, the same way the Claude Agent SDK integration does.
    return formatToolResult(formatted, this._client, MAX_OUTPUT_SIZE) as FormattedMessage[]
  }
}

function formatPart(part: GenkitPart, client: PostHog): unknown {
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
  if (part.media) {
    return formatMedia(part.media, client)
  }
  // Data and custom parts keep their Genkit shape.
  return part
}

function formatMedia(media: { url: string; contentType?: string }, client: PostHog): unknown {
  if (media.url.startsWith('data:')) {
    const comma = media.url.indexOf(',')
    const metadata = media.url.slice(5, comma)
    if (comma !== -1 && metadata.endsWith(';base64')) {
      return formatInlineDataBlock(
        { mimeType: media.contentType || metadata.split(';', 1)[0], data: media.url.slice(comma + 1) },
        client
      )
    }
  }
  if (!media.contentType || media.contentType.startsWith('image/')) {
    return { type: 'image', image: media.url }
  }
  // The shared audio and document blocks hold inline data only, so other URLs keep their Genkit shape.
  return { media }
}

/** A text-only document becomes one string, like the string input of the other embedding integrations. */
function formatDocument(content: GenkitPart[], client: PostHog): unknown {
  if (content.every((part) => typeof part.text === 'string')) {
    return content.map((part) => part.text).join('')
  }
  return content.map((part) => formatPart(part, client))
}

function redactCredentials(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactCredentials)
  }
  if (!isObject(value)) {
    return value
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      CREDENTIAL_KEYS.has(key.toLowerCase().replace(/[-_]/g, '')) ? '[REDACTED]' : redactCredentials(item),
    ])
  )
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

/** Rebuilds the error from the span's `exception` event, so error tracking gets a real `Error` with a stack. */
function spanError(span: GenkitSpan): Error | undefined {
  if (span.status.code !== SPAN_STATUS_ERROR) {
    return undefined
  }
  const exception = span.events?.find((event) => event.name === 'exception')?.attributes ?? {}
  const message = exception['exception.message']
  const stack = exception['exception.stacktrace']
  const error = new Error(typeof message === 'string' ? message : span.status.message)
  error.stack = typeof stack === 'string' ? stack : undefined
  // OpenTelemetry records `error.code` as `exception.type` when there is one, for example `500` for a
  // GenkitError. The stack starts with the class name, so read the name from the stack first.
  const name = STACK_ERROR_NAME.exec(error.stack ?? '')?.[1] ?? exception['exception.type']
  if (typeof name === 'string') {
    error.name = name
  }
  return error
}

/** Genkit names models and embedders `<plugin>/<name>`, for example `vertexai/gemini-2.5-flash`. */
function modelAndProvider(name: string): { model: string; provider: string } {
  const slash = name.indexOf('/')
  const plugin = slash > 0 ? name.slice(0, slash) : ''
  return { model: name.slice(slash + 1), provider: PROVIDER_NAMES.get(plugin) ?? plugin }
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
