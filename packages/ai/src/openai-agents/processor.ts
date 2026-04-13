import type { PostHog, EventMessage } from 'posthog-node'
import type {
  TracingProcessor,
  Trace,
  Span,
  SpanData,
  SpanError,
  AgentSpanData,
  FunctionSpanData,
  GenerationSpanData,
  ResponseSpanData,
  HandoffSpanData,
  CustomSpanData,
  GuardrailSpanData,
  TranscriptionSpanData,
  SpeechSpanData,
  SpeechGroupSpanData,
  MCPListToolsSpanData,
} from '@openai/agents-core'

/**
 * Normalize OpenAI Responses API input items to include a `role` field.
 * Items like `function_call` and `function_call_result` don't have a role,
 * causing PostHog's trace viewer to default them to "user".
 */
function normalizeInputRoles(input: unknown): unknown {
  if (!Array.isArray(input)) {
    return input
  }
  return input.map((item) => {
    if (item && typeof item === 'object' && !('role' in item) && 'type' in item) {
      if (item.type === 'function_call') {
        return { ...item, role: 'assistant' }
      }
      if (item.type === 'function_call_result') {
        return { ...item, role: 'tool' }
      }
    }
    return item
  })
}

function ensureSerializable(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj
  }
  try {
    JSON.stringify(obj)
    return obj
  } catch {
    return String(obj)
  }
}

function parseIsoTimestamp(isoStr: string | null | undefined): number | null {
  if (!isoStr) {
    return null
  }
  try {
    const ts = new Date(isoStr).getTime()
    return isNaN(ts) ? null : ts / 1000
  } catch {
    return null
  }
}

interface TraceMetadata {
  name: string
  groupId: string | null
  metadata: Record<string, any> | undefined
  distinctId: string | undefined
  startTime: number
}

export type DistinctIdResolver = string | ((trace: Trace) => string | null | undefined)

export interface PostHogTracingProcessorOptions {
  client: PostHog
  distinctId?: DistinctIdResolver
  privacyMode?: boolean
  groups?: Record<string, any>
  properties?: Record<string, any>
}

/**
 * A tracing processor that sends OpenAI Agents SDK traces to PostHog.
 *
 * Implements the TracingProcessor interface from the OpenAI Agents SDK
 * and maps agent traces, spans, and generations to PostHog's LLM analytics events.
 *
 * @example
 * ```typescript
 * import { PostHogTracingProcessor } from '@posthog/ai/openai-agents'
 * import { addTraceProcessor } from '@openai/agents'
 *
 * const processor = new PostHogTracingProcessor({
 *   client: posthog,
 *   distinctId: 'user@example.com',
 * })
 * addTraceProcessor(processor)
 * ```
 */
export class PostHogTracingProcessor implements TracingProcessor {
  private _client: PostHog
  private _distinctId: DistinctIdResolver | undefined
  private _privacyMode: boolean
  private _groups: Record<string, any>
  private _properties: Record<string, any>

  private _spanStartTimes: Map<string, number> = new Map()
  private _traceMetadata: Map<string, TraceMetadata> = new Map()
  private _maxTrackedEntries = 10000

  constructor(options: PostHogTracingProcessorOptions) {
    this._client = options.client
    this._distinctId = options.distinctId
    this._privacyMode = options.privacyMode ?? false
    this._groups = options.groups ?? {}
    this._properties = options.properties ?? {}
  }

  private _getDistinctId(trace: Trace | null): string | undefined {
    if (typeof this._distinctId === 'function') {
      if (trace) {
        const result = this._distinctId(trace)
        if (result) {
          return String(result)
        }
      }
      return undefined
    } else if (this._distinctId) {
      return String(this._distinctId)
    }
    return undefined
  }

  private _withPrivacyMode(value: unknown): unknown {
    if (this._privacyMode || (this._client as any).privacy_mode) {
      return null
    }
    return value
  }

  private _evictStaleEntries(): void {
    if (this._spanStartTimes.size > this._maxTrackedEntries) {
      const entries = [...this._spanStartTimes.entries()].sort((a, b) => a[1] - b[1])
      const toRemove = entries.slice(0, Math.floor(entries.length / 2))
      for (const [key] of toRemove) {
        this._spanStartTimes.delete(key)
      }
    }

    if (this._traceMetadata.size > this._maxTrackedEntries) {
      const keys = [...this._traceMetadata.keys()]
      const toRemove = keys.slice(0, Math.floor(keys.length / 2))
      for (const key of toRemove) {
        this._traceMetadata.delete(key)
      }
    }
  }

  private _captureEvent(event: string, properties: Record<string, any>, distinctId?: string): void {
    try {
      if (!this._client?.capture) {
        return
      }

      const finalProperties = {
        ...properties,
        ...this._properties,
      }

      const eventMessage: EventMessage = {
        distinctId: distinctId || 'unknown',
        event,
        properties: finalProperties,
        groups: Object.keys(this._groups).length > 0 ? this._groups : undefined,
      }

      this._client.capture(eventMessage)
    } catch {
      // Silently ignore capture errors
    }
  }

  private _baseProperties(
    traceId: string,
    spanId: string,
    parentId: string | null,
    latency: number,
    groupId: string | null,
    errorProperties: Record<string, any>
  ): Record<string, any> {
    const properties: Record<string, any> = {
      $ai_trace_id: traceId,
      $ai_span_id: spanId,
      $ai_parent_id: parentId,
      $ai_provider: 'openai',
      $ai_framework: 'openai-agents',
      $ai_latency: latency,
      ...errorProperties,
    }
    if (groupId) {
      properties.$ai_group_id = groupId
    }
    return properties
  }

  private _getErrorProperties(error: SpanError | null): Record<string, any> {
    if (!error) {
      return {}
    }

    const errorMessage = error.message || String(error)

    let errorType = 'unknown'
    if (errorMessage.includes('ModelBehaviorError')) {
      errorType = 'model_behavior_error'
    } else if (errorMessage.includes('UserError')) {
      errorType = 'user_error'
    } else if (errorMessage.includes('InputGuardrailTripwireTriggered')) {
      errorType = 'input_guardrail_triggered'
    } else if (errorMessage.includes('OutputGuardrailTripwireTriggered')) {
      errorType = 'output_guardrail_triggered'
    } else if (errorMessage.includes('MaxTurnsExceeded')) {
      errorType = 'max_turns_exceeded'
    }

    return {
      $ai_is_error: true,
      $ai_error: errorMessage,
      $ai_error_type: errorType,
    }
  }

  // --- TracingProcessor interface ---

  async onTraceStart(trace: Trace): Promise<void> {
    try {
      this._evictStaleEntries()

      const traceId = trace.traceId
      const traceName = trace.name
      const groupId = trace.groupId ?? null
      const metadata = trace.metadata

      const distinctId = this._getDistinctId(trace)

      this._traceMetadata.set(traceId, {
        name: traceName,
        groupId,
        metadata,
        distinctId,
        startTime: Date.now() / 1000,
      })
    } catch {
      // Silently ignore errors
    }
  }

  async onTraceEnd(trace: Trace): Promise<void> {
    try {
      const traceId = trace.traceId

      const traceInfo = this._traceMetadata.get(traceId)
      this._traceMetadata.delete(traceId)

      const traceName = traceInfo?.name ?? trace.name
      const groupId = traceInfo?.groupId ?? trace.groupId ?? null
      const metadata = traceInfo?.metadata ?? trace.metadata
      const distinctId = traceInfo?.distinctId ?? this._getDistinctId(trace)

      const startTime = traceInfo?.startTime
      const latency = startTime != null ? Date.now() / 1000 - startTime : undefined

      const properties: Record<string, any> = {
        $ai_trace_id: traceId,
        $ai_trace_name: traceName,
        $ai_provider: 'openai',
        $ai_framework: 'openai-agents',
      }

      if (latency != null) {
        properties.$ai_latency = latency
      }

      if (groupId) {
        properties.$ai_group_id = groupId
      }

      if (metadata && Object.keys(metadata).length > 0) {
        properties.$ai_trace_metadata = ensureSerializable(metadata)
      }

      if (distinctId == null) {
        properties.$process_person_profile = false
      }

      this._captureEvent('$ai_trace', properties, distinctId ?? traceId)
    } catch {
      // Silently ignore errors
    }
  }

  async onSpanStart(span: Span<SpanData>): Promise<void> {
    try {
      this._evictStaleEntries()
      this._spanStartTimes.set(span.spanId, Date.now() / 1000)
    } catch {
      // Silently ignore errors
    }
  }

  async onSpanEnd(span: Span<SpanData>): Promise<void> {
    try {
      const spanId = span.spanId
      const traceId = span.traceId
      const parentId = span.parentId
      const spanData = span.spanData

      // Calculate latency
      const startTime = this._spanStartTimes.get(spanId)
      this._spanStartTimes.delete(spanId)
      let latency: number
      if (startTime != null) {
        latency = Date.now() / 1000 - startTime
      } else {
        const started = parseIsoTimestamp(span.startedAt)
        const ended = parseIsoTimestamp(span.endedAt)
        latency = started != null && ended != null ? ended - started : 0
      }

      // Get distinct ID from trace metadata
      const traceInfo = this._traceMetadata.get(traceId)
      const userDistinctId = traceInfo?.distinctId ?? this._getDistinctId(null)

      // Get group_id from trace metadata
      const groupId = traceInfo?.groupId ?? null

      // Get error properties
      const errorProperties = this._getErrorProperties(span.error)

      // Personless mode: no user-provided distinct_id, fallback to trace_id
      if (userDistinctId == null) {
        errorProperties.$process_person_profile = false
      }
      const distinctId: string = userDistinctId ?? traceId

      // Dispatch based on span data type
      switch (spanData.type) {
        case 'generation':
          this._handleGenerationSpan(spanData, traceId, spanId, parentId, latency, distinctId, groupId, errorProperties)
          break
        case 'response':
          this._handleResponseSpan(spanData, traceId, spanId, parentId, latency, distinctId, groupId, errorProperties)
          break
        case 'function':
          this._handleFunctionSpan(spanData, traceId, spanId, parentId, latency, distinctId, groupId, errorProperties)
          break
        case 'agent':
          this._handleAgentSpan(spanData, traceId, spanId, parentId, latency, distinctId, groupId, errorProperties)
          break
        case 'handoff':
          this._handleHandoffSpan(spanData, traceId, spanId, parentId, latency, distinctId, groupId, errorProperties)
          break
        case 'guardrail':
          this._handleGuardrailSpan(spanData, traceId, spanId, parentId, latency, distinctId, groupId, errorProperties)
          break
        case 'custom':
          this._handleCustomSpan(spanData, traceId, spanId, parentId, latency, distinctId, groupId, errorProperties)
          break
        case 'transcription':
        case 'speech':
        case 'speech_group':
          this._handleAudioSpan(spanData, traceId, spanId, parentId, latency, distinctId, groupId, errorProperties)
          break
        case 'mcp_tools':
          this._handleMcpSpan(spanData, traceId, spanId, parentId, latency, distinctId, groupId, errorProperties)
          break
        default:
          this._handleGenericSpan(spanData, traceId, spanId, parentId, latency, distinctId, groupId, errorProperties)
          break
      }
    } catch {
      // Silently ignore errors
    }
  }

  async shutdown(): Promise<void> {
    try {
      this._spanStartTimes.clear()
      this._traceMetadata.clear()

      if (typeof this._client?.flush === 'function') {
        await this._client.flush()
      }
    } catch {
      // Silently ignore errors
    }
  }

  async forceFlush(): Promise<void> {
    try {
      if (typeof this._client?.flush === 'function') {
        await this._client.flush()
      }
    } catch {
      // Silently ignore errors
    }
  }

  // --- Span handlers ---

  private _handleGenerationSpan(
    spanData: GenerationSpanData,
    traceId: string,
    spanId: string,
    parentId: string | null,
    latency: number,
    distinctId: string,
    groupId: string | null,
    errorProperties: Record<string, any>
  ): void {
    const usage = spanData.usage ?? {}
    const inputTokens =
      (usage.input_tokens as number) || (usage as any).prompt_tokens || 0
    const outputTokens =
      (usage.output_tokens as number) || (usage as any).completion_tokens || 0

    const modelConfig = spanData.model_config ?? {}
    const modelParams: Record<string, any> = {}
    for (const param of ['temperature', 'max_tokens', 'top_p', 'frequency_penalty', 'presence_penalty']) {
      if (param in modelConfig) {
        modelParams[param] = modelConfig[param]
      }
    }

    const properties: Record<string, any> = {
      ...this._baseProperties(traceId, spanId, parentId, latency, groupId, errorProperties),
      $ai_model: spanData.model,
      $ai_model_parameters: Object.keys(modelParams).length > 0 ? modelParams : null,
      $ai_input: this._withPrivacyMode(ensureSerializable(normalizeInputRoles(spanData.input))),
      $ai_output_choices: this._withPrivacyMode(ensureSerializable(spanData.output)),
      $ai_input_tokens: inputTokens,
      $ai_output_tokens: outputTokens,
      $ai_total_tokens: (inputTokens || 0) + (outputTokens || 0),
    }

    if (usage.details) {
      const details = usage.details as Record<string, unknown>
      if (details.reasoning_tokens) {
        properties.$ai_reasoning_tokens = details.reasoning_tokens
      }
      if (details.cache_read_input_tokens) {
        properties.$ai_cache_read_input_tokens = details.cache_read_input_tokens
      }
      if (details.cache_creation_input_tokens) {
        properties.$ai_cache_creation_input_tokens = details.cache_creation_input_tokens
      }
    }

    // Also check top-level usage for reasoning/cache tokens (flexible schema)
    if ((usage as any).reasoning_tokens) {
      properties.$ai_reasoning_tokens = (usage as any).reasoning_tokens
    }
    if ((usage as any).cache_read_input_tokens) {
      properties.$ai_cache_read_input_tokens = (usage as any).cache_read_input_tokens
    }
    if ((usage as any).cache_creation_input_tokens) {
      properties.$ai_cache_creation_input_tokens = (usage as any).cache_creation_input_tokens
    }

    this._captureEvent('$ai_generation', properties, distinctId)
  }

  private _handleResponseSpan(
    spanData: ResponseSpanData,
    traceId: string,
    spanId: string,
    parentId: string | null,
    latency: number,
    distinctId: string,
    groupId: string | null,
    errorProperties: Record<string, any>
  ): void {
    const response = (spanData as any)._response
    const responseId = spanData.response_id ?? (response?.id as string | undefined)

    // Extract usage from response
    const usage = response?.usage ?? {}
    const inputTokens = usage?.input_tokens ?? 0
    const outputTokens = usage?.output_tokens ?? 0

    // Extract model from response
    const model = response?.model as string | undefined

    const properties: Record<string, any> = {
      ...this._baseProperties(traceId, spanId, parentId, latency, groupId, errorProperties),
      $ai_model: model,
      $ai_response_id: responseId,
      $ai_input: this._withPrivacyMode(ensureSerializable(normalizeInputRoles((spanData as any)._input))),
      $ai_input_tokens: inputTokens,
      $ai_output_tokens: outputTokens,
      $ai_total_tokens: inputTokens + outputTokens,
    }

    // Extract output from response
    if (response?.output) {
      properties.$ai_output_choices = this._withPrivacyMode(ensureSerializable(response.output))
    }

    this._captureEvent('$ai_generation', properties, distinctId)
  }

  private _handleFunctionSpan(
    spanData: FunctionSpanData,
    traceId: string,
    spanId: string,
    parentId: string | null,
    latency: number,
    distinctId: string,
    groupId: string | null,
    errorProperties: Record<string, any>
  ): void {
    const properties: Record<string, any> = {
      ...this._baseProperties(traceId, spanId, parentId, latency, groupId, errorProperties),
      $ai_span_name: spanData.name,
      $ai_span_type: 'tool',
      $ai_input_state: this._withPrivacyMode(ensureSerializable(spanData.input)),
      $ai_output_state: this._withPrivacyMode(ensureSerializable(spanData.output)),
    }

    if (spanData.mcp_data) {
      properties.$ai_mcp_data = ensureSerializable(spanData.mcp_data)
    }

    this._captureEvent('$ai_span', properties, distinctId)
  }

  private _handleAgentSpan(
    spanData: AgentSpanData,
    traceId: string,
    spanId: string,
    parentId: string | null,
    latency: number,
    distinctId: string,
    groupId: string | null,
    errorProperties: Record<string, any>
  ): void {
    const properties: Record<string, any> = {
      ...this._baseProperties(traceId, spanId, parentId, latency, groupId, errorProperties),
      $ai_span_name: spanData.name,
      $ai_span_type: 'agent',
    }

    if (spanData.handoffs) {
      properties.$ai_agent_handoffs = spanData.handoffs
    }
    if (spanData.tools) {
      properties.$ai_agent_tools = spanData.tools
    }
    if (spanData.output_type) {
      properties.$ai_agent_output_type = spanData.output_type
    }

    this._captureEvent('$ai_span', properties, distinctId)
  }

  private _handleHandoffSpan(
    spanData: HandoffSpanData,
    traceId: string,
    spanId: string,
    parentId: string | null,
    latency: number,
    distinctId: string,
    groupId: string | null,
    errorProperties: Record<string, any>
  ): void {
    const properties: Record<string, any> = {
      ...this._baseProperties(traceId, spanId, parentId, latency, groupId, errorProperties),
      $ai_span_name: `${spanData.from_agent} -> ${spanData.to_agent}`,
      $ai_span_type: 'handoff',
      $ai_handoff_from_agent: spanData.from_agent,
      $ai_handoff_to_agent: spanData.to_agent,
    }

    this._captureEvent('$ai_span', properties, distinctId)
  }

  private _handleGuardrailSpan(
    spanData: GuardrailSpanData,
    traceId: string,
    spanId: string,
    parentId: string | null,
    latency: number,
    distinctId: string,
    groupId: string | null,
    errorProperties: Record<string, any>
  ): void {
    const properties: Record<string, any> = {
      ...this._baseProperties(traceId, spanId, parentId, latency, groupId, errorProperties),
      $ai_span_name: spanData.name,
      $ai_span_type: 'guardrail',
      $ai_guardrail_triggered: spanData.triggered,
    }

    this._captureEvent('$ai_span', properties, distinctId)
  }

  private _handleCustomSpan(
    spanData: CustomSpanData,
    traceId: string,
    spanId: string,
    parentId: string | null,
    latency: number,
    distinctId: string,
    groupId: string | null,
    errorProperties: Record<string, any>
  ): void {
    const properties: Record<string, any> = {
      ...this._baseProperties(traceId, spanId, parentId, latency, groupId, errorProperties),
      $ai_span_name: spanData.name,
      $ai_span_type: 'custom',
      $ai_custom_data: this._withPrivacyMode(ensureSerializable(spanData.data)),
    }

    this._captureEvent('$ai_span', properties, distinctId)
  }

  private _handleAudioSpan(
    spanData: TranscriptionSpanData | SpeechSpanData | SpeechGroupSpanData,
    traceId: string,
    spanId: string,
    parentId: string | null,
    latency: number,
    distinctId: string,
    groupId: string | null,
    errorProperties: Record<string, any>
  ): void {
    const spanType = spanData.type

    const properties: Record<string, any> = {
      ...this._baseProperties(traceId, spanId, parentId, latency, groupId, errorProperties),
      $ai_span_name: spanType,
      $ai_span_type: spanType,
    }

    // Add model info if available
    if ('model' in spanData && spanData.model) {
      properties.$ai_model = spanData.model
    }

    // Add model config if available
    if ('model_config' in spanData && spanData.model_config) {
      properties.model_config = ensureSerializable(spanData.model_config)
    }

    // Add audio format info
    if (spanData.type === 'transcription') {
      const transcription = spanData as TranscriptionSpanData
      if (transcription.input?.format) {
        properties.audio_input_format = transcription.input.format
      }
      // Transcription output is text
      if (transcription.output) {
        properties.$ai_output_state = this._withPrivacyMode(transcription.output)
      }
    } else if (spanData.type === 'speech') {
      const speech = spanData as SpeechSpanData
      if (speech.output?.format) {
        properties.audio_output_format = speech.output.format
      }
      // Text input for TTS
      if (speech.input) {
        properties.$ai_input = this._withPrivacyMode(speech.input)
      }
    }

    this._captureEvent('$ai_span', properties, distinctId)
  }

  private _handleMcpSpan(
    spanData: MCPListToolsSpanData,
    traceId: string,
    spanId: string,
    parentId: string | null,
    latency: number,
    distinctId: string,
    groupId: string | null,
    errorProperties: Record<string, any>
  ): void {
    const properties: Record<string, any> = {
      ...this._baseProperties(traceId, spanId, parentId, latency, groupId, errorProperties),
      $ai_span_name: `mcp:${spanData.server}`,
      $ai_span_type: 'mcp_tools',
      $ai_mcp_server: spanData.server,
      $ai_mcp_tools: spanData.result,
    }

    this._captureEvent('$ai_span', properties, distinctId)
  }

  private _handleGenericSpan(
    spanData: SpanData,
    traceId: string,
    spanId: string,
    parentId: string | null,
    latency: number,
    distinctId: string,
    groupId: string | null,
    errorProperties: Record<string, any>
  ): void {
    const spanType = spanData.type || 'unknown'

    const properties: Record<string, any> = {
      ...this._baseProperties(traceId, spanId, parentId, latency, groupId, errorProperties),
      $ai_span_name: spanType,
      $ai_span_type: spanType,
    }

    this._captureEvent('$ai_span', properties, distinctId)
  }
}
