import { BasePlugin } from '@google/adk'
import type { BaseAgent, BaseTool, Context, InvocationContext, LlmRequest, LlmResponse } from '@google/adk'
import type { Content } from '@google/genai'
import type { EventMessage, PostHog } from 'posthog-node'
import { v4 as uuidv4 } from 'uuid'
import { version } from '../../package.json'
import { formatInlineDataBlock, formatResponseGemini, toContentString, withPrivacyMode } from '../utils'
import { sanitizeGemini } from '../sanitization'
import { captureAiGeneration } from '../captureAiGeneration'
import { captureAiEvent, captureAiEventImmediate } from '../captureAiEvent'
import { stringifyError } from '../serializeError'
import type { FormattedContent, FormattedMessage } from '../types'
import { mapGeminiUsage } from '../gemini/usage'

/**
 * Resolver for the PostHog distinct ID. Either a static string, or a function
 * that derives it from the ADK model callback context (e.g. from
 * `context.userId`). Return `null`/`undefined` to fall back to the ADK
 * `userId`, and finally to anonymous (personless) capture keyed by trace ID.
 */
export type DistinctIdResolver = string | ((context: Context) => string | null | undefined)

export interface PostHogADKPluginOptions {
  /** The PostHog client used to capture events. */
  client: PostHog
  /**
   * Distinct ID for the captured events. When omitted, the ADK
   * `callbackContext.userId` is used if present, otherwise events are captured
   * anonymously (personless) keyed by the trace ID.
   */
  distinctId?: DistinctIdResolver
  /**
   * Provider label recorded on `$ai_provider`. Defaults to `'gemini'` since ADK
   * defaults to Gemini models. Set this when routing ADK to another provider so
   * PostHog attributes cost to the right model catalog.
   */
  provider?: string
  /** Redacts captured input/output content when true. Defaults to false. */
  privacyMode?: boolean
  /** Group analytics mapping (group type -> group id) attached to every event. */
  groups?: Record<string, string | number>
  /** Extra properties merged into every captured AI event. */
  properties?: Record<string, unknown>
  /** Awaits event delivery instead of batching. Useful in serverless environments. */
  captureImmediate?: boolean
  /** Invoked when the plugin fails to capture an event. Never throws into the model flow. */
  onError?: (error: unknown) => void
}

interface PendingModelCall {
  startTime: number
  spanId: string
  input: FormattedMessage[]
  model?: string
  modelParameters: Record<string, unknown>
  tools?: unknown[] | null
  streamedOutput: FormattedMessage[]
}

interface PendingTrace {
  startTime: number
  spanId: string
  name: string
  input?: Content
  distinctId?: string
  sessionId?: string
}

interface PendingToolCall {
  startTime: number
  spanId: string
  name: string
  input: Record<string, unknown>
}

interface PendingAgentCall {
  startTime: number
  spanId: string
  name: string
  input?: Content
}

/** Calls older than this are treated as abandoned rather than evicting live calls by count. */
const MAX_PENDING_AGE_MS = 60 * 60 * 1000

/**
 * A Google ADK (`@google/adk`) `BasePlugin` that captures PostHog AI traces,
 * agent and tool spans, and a full `$ai_generation` event for every model call.
 *
 * Run, agent, and tool callbacks build the trace hierarchy. Model callbacks
 * record input, output, model, token usage, latency, and finish reason through
 * the shared {@link captureAiGeneration} primitive so PostHog derives cost from
 * the model and tokens (never hardcoded here).
 *
 * ADK already emits OpenTelemetry `gen_ai.*` spans; this plugin is the
 * complement for users who capture LLM analytics through the PostHog SDK rather
 * than an OTEL exporter.
 *
 * @example
 * ```typescript
 * import { PostHogADKPlugin } from '@posthog/ai/adk'
 * import { Runner } from '@google/adk'
 * import { PostHog } from 'posthog-node'
 *
 * const phClient = new PostHog('<POSTHOG_API_KEY>')
 *
 * const runner = new Runner({
 *   appName: 'my-app',
 *   agent,
 *   sessionService,
 *   plugins: [new PostHogADKPlugin({ client: phClient, distinctId: 'user@example.com' })],
 * })
 * ```
 */
export class PostHogADKPlugin extends BasePlugin {
  private readonly _client: PostHog
  private readonly _distinctId?: DistinctIdResolver
  private readonly _provider: string
  private readonly _privacyMode: boolean
  private readonly _groups?: Record<string, string | number>
  private readonly _properties: Record<string, unknown>
  private readonly _captureImmediate: boolean
  private readonly _onError?: (error: unknown) => void

  /** FIFO of in-flight model calls for each invocation branch and agent. */
  private readonly _pending: Map<string, PendingModelCall[]> = new Map()
  private readonly _traces: Map<string, PendingTrace> = new Map()
  private readonly _pendingAgents: Map<string, PendingAgentCall[]> = new Map()
  private readonly _pendingTools: Map<string, PendingToolCall[]> = new Map()

  constructor(options: PostHogADKPluginOptions) {
    super('posthog')
    this._client = options.client
    this._distinctId = options.distinctId
    this._provider = options.provider ?? 'gemini'
    this._privacyMode = options.privacyMode ?? false
    this._groups = options.groups
    this._properties = options.properties ?? {}
    this._captureImmediate = options.captureImmediate ?? false
    this._onError = options.onError
  }

  override async beforeRunCallback({
    invocationContext,
  }: {
    invocationContext: InvocationContext
  }): Promise<Content | undefined> {
    try {
      this._evictStalePending()
      this._traces.set(invocationContext.invocationId, {
        startTime: Date.now(),
        spanId: invocationContext.invocationId,
        name: invocationContext.agent?.name ?? 'ADK invocation',
        input: invocationContext.userContent,
        distinctId: this._resolveInvocationDistinctId(invocationContext),
        sessionId: invocationContext.session?.id,
      })
    } catch (error) {
      this._handleError(error)
    }
    return undefined
  }

  override async afterRunCallback({ invocationContext }: { invocationContext: InvocationContext }): Promise<void> {
    try {
      const trace = this._traces.get(invocationContext.invocationId)
      this._traces.delete(invocationContext.invocationId)
      this._clearPendingInvocation(invocationContext.invocationId)
      if (!trace) {
        return
      }

      await this._captureLifecycleEvent('$ai_trace', trace.distinctId, {
        $ai_trace_id: invocationContext.invocationId,
        $ai_span_id: trace.spanId,
        $ai_span_name: trace.name,
        $ai_input_state: withPrivacyMode(this._client, this._privacyMode, trace.input),
        $ai_latency: (Date.now() - trace.startTime) / 1000,
        ...(trace.sessionId ? { $ai_session_id: trace.sessionId } : {}),
      })
    } catch (error) {
      this._handleError(error)
    }
  }

  override async beforeAgentCallback({
    agent,
    callbackContext,
  }: {
    agent: BaseAgent
    callbackContext: Context
  }): Promise<Content | undefined> {
    try {
      this._evictStalePending()
      this._rememberContext(callbackContext)
      const key = this._pendingKey(callbackContext)
      const pending: PendingAgentCall = {
        startTime: Date.now(),
        spanId: uuidv4(),
        name: agent.name,
        input: callbackContext.userContent,
      }
      const queue = this._pendingAgents.get(key)
      if (queue) {
        queue.push(pending)
      } else {
        this._pendingAgents.set(key, [pending])
      }
    } catch (error) {
      this._handleError(error)
    }
    return undefined
  }

  override async afterAgentCallback({
    callbackContext,
  }: {
    agent: BaseAgent
    callbackContext: Context
  }): Promise<Content | undefined> {
    try {
      const pending = this._takePendingAgent(this._pendingKey(callbackContext))
      if (pending) {
        await this._captureLifecycleEvent('$ai_span', this._resolveDistinctId(callbackContext), {
          $ai_trace_id: callbackContext.invocationId,
          $ai_span_id: pending.spanId,
          ...(this._traces.get(callbackContext.invocationId)?.spanId
            ? { $ai_parent_id: this._traces.get(callbackContext.invocationId)?.spanId }
            : {}),
          $ai_span_name: pending.name,
          $ai_input_state: withPrivacyMode(this._client, this._privacyMode, pending.input),
          $ai_latency: (Date.now() - pending.startTime) / 1000,
          ...(callbackContext.sessionId ? { $ai_session_id: callbackContext.sessionId } : {}),
          ...(callbackContext.agentName ? { $ai_agent_name: callbackContext.agentName } : {}),
        })
      }
    } catch (error) {
      this._handleError(error)
    }
    return undefined
  }

  override async beforeModelCallback({
    callbackContext,
    llmRequest,
  }: {
    callbackContext: Context
    llmRequest: LlmRequest
  }): Promise<LlmResponse | undefined> {
    try {
      this._evictStalePending()
      this._rememberContext(callbackContext)
      const pending: PendingModelCall = {
        startTime: Date.now(),
        spanId: uuidv4(),
        input: this._formatInput(llmRequest),
        model: llmRequest.model,
        modelParameters: extractModelParameters(llmRequest.config),
        tools: extractTools(llmRequest),
        streamedOutput: [],
      }
      const key = this._pendingKey(callbackContext)
      const queue = this._pending.get(key)
      if (queue) {
        queue.push(pending)
      } else {
        this._pending.set(key, [pending])
      }
    } catch (error) {
      this._handleError(error)
    }
    return undefined
  }

  override async afterModelCallback({
    callbackContext,
    llmResponse,
  }: {
    callbackContext: Context
    llmResponse: LlmResponse
  }): Promise<LlmResponse | undefined> {
    try {
      // Streaming delivers partial responses before the terminal one; the
      // terminal response carries the full content and usage, so only emit then.
      if (llmResponse.partial) {
        return undefined
      }

      const key = this._pendingKey(callbackContext)
      const pending = this._peekPending(key)
      if (this._isNonTerminalStreamResponse(llmResponse)) {
        if (pending) {
          pending.streamedOutput.push(...this._formatOutput(llmResponse))
        }
        return undefined
      }

      const completedPending = this._takePending(key)
      const error = llmResponse.errorCode
        ? new Error(llmResponse.errorMessage ?? String(llmResponse.errorCode))
        : undefined
      const output = error ? [] : this._formatOutput(llmResponse)

      await this._capture(callbackContext, {
        pending: completedPending,
        output:
          !error && output.length === 0 && completedPending?.streamedOutput.length
            ? completedPending.streamedOutput
            : output,
        model: llmResponse.modelVersion ?? completedPending?.model,
        usage: llmResponse.usageMetadata,
        stopReason: llmResponse.finishReason ? String(llmResponse.finishReason) : undefined,
        error,
      })
    } catch (error) {
      this._handleError(error)
    }
    return undefined
  }

  override async onModelErrorCallback({
    callbackContext,
    llmRequest,
    error,
  }: {
    callbackContext: Context
    llmRequest: LlmRequest
    error: Error
  }): Promise<LlmResponse | undefined> {
    try {
      const pending = this._takePending(this._pendingKey(callbackContext))
      await this._capture(callbackContext, {
        pending: pending ?? {
          startTime: Date.now(),
          spanId: uuidv4(),
          input: this._formatInput(llmRequest),
          model: llmRequest.model,
          modelParameters: extractModelParameters(llmRequest.config),
          tools: extractTools(llmRequest),
          streamedOutput: [],
        },
        output: [],
        model: llmRequest.model,
        usage: undefined,
        error,
      })
    } catch (captureError) {
      this._handleError(captureError)
    }
    return undefined
  }

  override async beforeToolCallback({
    tool,
    toolArgs,
    toolContext,
  }: {
    tool: BaseTool
    toolArgs: Record<string, unknown>
    toolContext: Context
  }): Promise<Record<string, unknown> | undefined> {
    try {
      this._evictStalePending()
      this._rememberContext(toolContext)
      const key = this._toolKey(toolContext, tool.name)
      const pending: PendingToolCall = {
        startTime: Date.now(),
        spanId: toolContext.functionCallId ?? uuidv4(),
        name: tool.name,
        input: toolArgs,
      }
      const queue = this._pendingTools.get(key)
      if (queue) {
        queue.push(pending)
      } else {
        this._pendingTools.set(key, [pending])
      }
    } catch (error) {
      this._handleError(error)
    }
    return undefined
  }

  override async afterToolCallback({
    tool,
    toolContext,
    result,
  }: {
    tool: BaseTool
    toolArgs: Record<string, unknown>
    toolContext: Context
    result: Record<string, unknown>
  }): Promise<Record<string, unknown> | undefined> {
    try {
      const pending = this._takePendingTool(this._toolKey(toolContext, tool.name))
      if (pending) {
        await this._captureToolSpan(toolContext, pending, result)
      }
    } catch (error) {
      this._handleError(error)
    }
    return undefined
  }

  override async onToolErrorCallback({
    tool,
    toolContext,
    error,
  }: {
    tool: BaseTool
    toolArgs: Record<string, unknown>
    toolContext: Context
    error: Error
  }): Promise<Record<string, unknown> | undefined> {
    try {
      const pending = this._takePendingTool(this._toolKey(toolContext, tool.name))
      if (pending) {
        await this._captureToolSpan(toolContext, pending, undefined, error)
      }
    } catch (captureError) {
      this._handleError(captureError)
    }
    return undefined
  }

  private async _capture(
    callbackContext: Context,
    args: {
      pending?: PendingModelCall
      output: unknown
      model?: string
      usage?: LlmResponse['usageMetadata']
      stopReason?: string
      error?: unknown
    }
  ): Promise<void> {
    const { pending, output, model, usage, stopReason, error } = args
    const latency = pending ? (Date.now() - pending.startTime) / 1000 : undefined

    await captureAiGeneration(this._client, {
      distinctId: this._resolveDistinctId(callbackContext),
      traceId: callbackContext.invocationId,
      model,
      provider: this._provider,
      baseURL: null,
      input: pending?.input ?? [],
      output,
      latency,
      modelParameters: pending?.modelParameters,
      usage: mapGeminiUsage(usage),
      stopReason,
      tools: pending?.tools,
      groups: this._groups,
      privacyMode: this._privacyMode,
      captureImmediate: this._captureImmediate,
      onError: this._onError,
      properties: {
        $ai_framework: 'google-adk',
        $ai_span_id: pending?.spanId ?? uuidv4(),
        ...(this._parentSpanId(callbackContext) ? { $ai_parent_id: this._parentSpanId(callbackContext) } : {}),
        ...(callbackContext.sessionId ? { $ai_session_id: callbackContext.sessionId } : {}),
        ...(callbackContext.agentName
          ? { $ai_agent_name: callbackContext.agentName, $ai_span_name: callbackContext.agentName }
          : {}),
        ...this._properties,
      },
      error,
    })
  }

  private async _captureToolSpan(
    context: Context,
    pending: PendingToolCall,
    result?: Record<string, unknown>,
    error?: Error
  ): Promise<void> {
    await this._captureLifecycleEvent('$ai_span', this._resolveDistinctId(context), {
      $ai_trace_id: context.invocationId,
      $ai_span_id: pending.spanId,
      ...(this._parentSpanId(context) ? { $ai_parent_id: this._parentSpanId(context) } : {}),
      $ai_span_name: pending.name,
      $ai_input_state: withPrivacyMode(this._client, this._privacyMode, pending.input),
      ...(result !== undefined ? { $ai_output_state: withPrivacyMode(this._client, this._privacyMode, result) } : {}),
      $ai_latency: (Date.now() - pending.startTime) / 1000,
      ...(context.sessionId ? { $ai_session_id: context.sessionId } : {}),
      ...(context.agentName ? { $ai_agent_name: context.agentName } : {}),
      ...(error ? { $ai_is_error: true, $ai_error: stringifyError(error) } : {}),
    })
  }

  private async _captureLifecycleEvent(
    event: '$ai_trace' | '$ai_span',
    distinctId: string | undefined,
    properties: Record<string, unknown>
  ): Promise<void> {
    const message: EventMessage = {
      distinctId: distinctId ?? String(properties.$ai_trace_id),
      event,
      properties: {
        $ai_lib: 'posthog-ai',
        $ai_lib_version: version,
        $ai_framework: 'google-adk',
        ...properties,
        ...this._properties,
        ...(distinctId ? {} : { $process_person_profile: false }),
      },
      groups: this._groups,
    }

    if (this._captureImmediate) {
      await captureAiEventImmediate(this._client, message)
    } else {
      captureAiEvent(this._client, message)
    }
  }

  private _resolveDistinctId(context: Context): string | undefined {
    if (typeof this._distinctId === 'function') {
      const resolved = this._distinctId(context)
      if (resolved) {
        return String(resolved)
      }
    } else if (this._distinctId) {
      return String(this._distinctId)
    }
    return context.userId ? String(context.userId) : undefined
  }

  private _resolveInvocationDistinctId(context: InvocationContext): string | undefined {
    if (typeof this._distinctId === 'string' && this._distinctId) {
      return String(this._distinctId)
    }
    return context.userId ? String(context.userId) : undefined
  }

  private _rememberContext(context: Context): void {
    const trace = this._traces.get(context.invocationId)
    if (trace) {
      trace.distinctId = this._resolveDistinctId(context)
      trace.sessionId = context.sessionId || trace.sessionId
    }
  }

  private _parentSpanId(context: Context): string | undefined {
    return (
      this._pendingAgents.get(this._pendingKey(context))?.[0]?.spanId ?? this._traces.get(context.invocationId)?.spanId
    )
  }

  private _pendingKey(context: Context): string {
    return [context.invocationId, context.invocationContext?.branch ?? '', context.agentName].join('\0')
  }

  private _toolKey(context: Context, toolName: string): string {
    return [this._pendingKey(context), context.functionCallId ?? '', toolName].join('\0')
  }

  private _peekPending(key: string): PendingModelCall | undefined {
    return this._pending.get(key)?.[0]
  }

  private _takePending(key: string): PendingModelCall | undefined {
    const queue = this._pending.get(key)
    if (!queue || queue.length === 0) {
      return undefined
    }
    const pending = queue.shift()
    if (queue.length === 0) {
      this._pending.delete(key)
    }
    return pending
  }

  private _takePendingAgent(key: string): PendingAgentCall | undefined {
    const queue = this._pendingAgents.get(key)
    if (!queue || queue.length === 0) {
      return undefined
    }
    const pending = queue.shift()
    if (queue.length === 0) {
      this._pendingAgents.delete(key)
    }
    return pending
  }

  private _takePendingTool(key: string): PendingToolCall | undefined {
    const queue = this._pendingTools.get(key)
    if (!queue || queue.length === 0) {
      return undefined
    }
    const pending = queue.shift()
    if (queue.length === 0) {
      this._pendingTools.delete(key)
    }
    return pending
  }

  private _isNonTerminalStreamResponse(llmResponse: LlmResponse): boolean {
    if (llmResponse.turnComplete === false) {
      return true
    }
    return (
      llmResponse.partial === false &&
      llmResponse.turnComplete !== true &&
      llmResponse.content !== undefined &&
      llmResponse.finishReason === undefined &&
      llmResponse.errorCode === undefined
    )
  }

  private _evictStalePending(): void {
    const cutoff = Date.now() - MAX_PENDING_AGE_MS
    this._evictStaleQueueEntries(this._pending, cutoff)
    this._evictStaleQueueEntries(this._pendingAgents, cutoff)
    this._evictStaleQueueEntries(this._pendingTools, cutoff)
    for (const [invocationId, trace] of this._traces) {
      if (trace.startTime < cutoff) {
        this._traces.delete(invocationId)
      }
    }
  }

  private _evictStaleQueueEntries<T extends { startTime: number }>(queues: Map<string, T[]>, cutoff: number): void {
    for (const [key, queue] of queues) {
      const active = queue.filter((entry) => entry.startTime >= cutoff)
      if (active.length > 0) {
        queues.set(key, active)
      } else {
        queues.delete(key)
      }
    }
  }

  private _clearPendingInvocation(invocationId: string): void {
    const prefix = `${invocationId}\0`
    for (const key of this._pending.keys()) {
      if (key.startsWith(prefix)) {
        this._pending.delete(key)
      }
    }
    for (const key of this._pendingAgents.keys()) {
      if (key.startsWith(prefix)) {
        this._pendingAgents.delete(key)
      }
    }
    for (const key of this._pendingTools.keys()) {
      if (key.startsWith(prefix)) {
        this._pendingTools.delete(key)
      }
    }
  }

  private _formatInput(llmRequest: LlmRequest): FormattedMessage[] {
    const contents = (sanitizeGemini(llmRequest.contents, this._client) as Content[]) ?? []
    const messages = Array.isArray(contents) ? contents.map((content) => formatContent(content, this._client)) : []

    const systemInstruction = extractSystemInstruction(llmRequest)
    if (systemInstruction && !messages.some((message) => message.role === 'system')) {
      return [{ role: 'system', content: systemInstruction }, ...messages]
    }
    return messages
  }

  private _formatOutput(llmResponse: LlmResponse): FormattedMessage[] {
    // Reuse the Gemini response formatter (text/functionCall/inlineData +
    // base64 redaction) by adapting the ADK response into a candidates shape.
    return formatResponseGemini(
      { candidates: llmResponse.content ? [{ content: llmResponse.content }] : [] },
      this._client
    )
  }

  private _handleError(error: unknown): void {
    try {
      this._onError?.(error)
    } catch {
      // The plugin must never throw into the ADK model flow.
    }
  }
}

/** Map a genai content role to PostHog's convention (`model` -> `assistant`). */
function mapRole(role: string | undefined): string {
  if (role === 'model') {
    return 'assistant'
  }
  return role ?? 'user'
}

function formatContent(content: Content, client: PostHog): FormattedMessage {
  const parts = Array.isArray(content?.parts) ? content.parts : []
  const blocks: FormattedContent = []

  for (const part of parts as Array<Record<string, any>>) {
    if (part == null) {
      continue
    }
    if (part.text) {
      blocks.push({ type: 'text', text: String(part.text) })
    } else if (part.functionCall) {
      blocks.push({
        type: 'function',
        id: part.functionCall.id,
        function: {
          name: part.functionCall.name,
          arguments: part.functionCall.args ?? {},
        },
      })
    } else if (part.functionResponse) {
      blocks.push({ type: 'text', text: toContentString(part.functionResponse.response ?? part.functionResponse) })
    } else if (part.inlineData) {
      blocks.push(formatInlineDataBlock(part.inlineData, client))
    }
  }

  return { role: mapRole(content?.role), content: blocks }
}

/** Extract the system instruction text from an LlmRequest's config, if any. */
function extractSystemInstruction(llmRequest: LlmRequest): string | null {
  const systemInstruction = (llmRequest.config as { systemInstruction?: unknown } | undefined)?.systemInstruction
  if (!systemInstruction) {
    return null
  }
  if (typeof systemInstruction === 'string') {
    return systemInstruction
  }
  const asObject = systemInstruction as { text?: unknown; parts?: unknown }
  if (typeof asObject.text === 'string') {
    return asObject.text
  }
  const parts = Array.isArray(asObject.parts)
    ? asObject.parts
    : Array.isArray(systemInstruction)
      ? systemInstruction
      : []
  const textParts = parts.flatMap((part: unknown) => {
    if (typeof part === 'string') {
      return [part]
    }
    if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
      return [(part as { text: string }).text]
    }
    return []
  })
  return textParts.length > 0 ? textParts.join('') : null
}

const MODEL_PARAM_KEYS = [
  'temperature',
  'topP',
  'topK',
  'maxOutputTokens',
  'candidateCount',
  'stopSequences',
  'presencePenalty',
  'frequencyPenalty',
  'seed',
] as const

function extractModelParameters(config: LlmRequest['config']): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  if (!config || typeof config !== 'object') {
    return params
  }
  const source = config as Record<string, unknown>
  for (const key of MODEL_PARAM_KEYS) {
    if (source[key] !== undefined) {
      params[key] = source[key]
    }
  }
  return params
}

function extractTools(llmRequest: LlmRequest): unknown[] | null {
  const tools = (llmRequest.config as { tools?: unknown } | undefined)?.tools
  return Array.isArray(tools) && tools.length > 0 ? tools : null
}
