import { BasePlugin } from '@google/adk'
import type { Context, LlmRequest, LlmResponse } from '@google/adk'
import type { Content, GenerateContentResponseUsageMetadata } from '@google/genai'
import type { PostHog } from 'posthog-node'
import { buildInlineDataBlock, formatResponseGemini } from '../utils'
import { sanitizeGemini } from '../sanitization'
import { captureAiGeneration } from '../captureAiGeneration'
import type { FormattedContent, FormattedMessage } from '../types'

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
  /** Extra properties merged into every captured `$ai_generation` event. */
  properties?: Record<string, unknown>
  /** Awaits event delivery instead of batching. Useful in serverless environments. */
  captureImmediate?: boolean
  /** Invoked when the plugin fails to capture an event. Never throws into the model flow. */
  onError?: (error: unknown) => void
}

interface PendingModelCall {
  startTime: number
  input: FormattedMessage[]
  model?: string
  modelParameters: Record<string, unknown>
  tools?: unknown[] | null
  streamedOutput: FormattedMessage[]
}

/** Cap on in-flight model calls tracked per plugin, guarding against leaks. */
const MAX_PENDING_INVOCATIONS = 10000

/**
 * A Google ADK (`@google/adk`) `BasePlugin` that captures a full standard
 * PostHog `$ai_generation` event for every model call an ADK agent makes.
 *
 * It hooks `beforeModelCallback` to record the input messages and start time,
 * and `afterModelCallback` / `onModelErrorCallback` to record the output, model,
 * token usage, latency and finish reason, funnelling everything through the
 * shared {@link captureAiGeneration} primitive so PostHog derives cost from the
 * model and tokens (never hardcoded here).
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

  override async beforeModelCallback({
    callbackContext,
    llmRequest,
  }: {
    callbackContext: Context
    llmRequest: LlmRequest
  }): Promise<LlmResponse | undefined> {
    try {
      this._evictStalePending()
      const pending: PendingModelCall = {
        startTime: Date.now(),
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

  private async _capture(
    callbackContext: Context,
    args: {
      pending?: PendingModelCall
      output: unknown
      model?: string
      usage?: GenerateContentResponseUsageMetadata
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
      usage: {
        inputTokens: usage?.promptTokenCount ?? 0,
        outputTokens: usage?.candidatesTokenCount ?? 0,
        reasoningTokens: usage?.thoughtsTokenCount ?? 0,
        cacheReadInputTokens: usage?.cachedContentTokenCount ?? 0,
        // ADK/Gemini count cachedContentTokenCount inside promptTokenCount, so
        // declare the accounting model rather than letting ingestion infer it.
        ...(usage?.cachedContentTokenCount ? { cacheReportingExclusive: false } : {}),
        rawUsage: usage,
      },
      stopReason,
      tools: pending?.tools,
      groups: this._groups,
      privacyMode: this._privacyMode,
      captureImmediate: this._captureImmediate,
      onError: this._onError,
      properties: {
        $ai_framework: 'google-adk',
        ...(callbackContext.sessionId ? { $ai_session_id: callbackContext.sessionId } : {}),
        ...(callbackContext.agentName ? { $ai_agent_name: callbackContext.agentName } : {}),
        ...this._properties,
      },
      error,
    })
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

  private _pendingKey(context: Context): string {
    return [context.invocationId, context.invocationContext.branch ?? '', context.agentName].join('\0')
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
    if (this._pending.size <= MAX_PENDING_INVOCATIONS) {
      return
    }
    const keys = [...this._pending.keys()]
    for (const key of keys.slice(0, Math.floor(keys.length / 2))) {
      this._pending.delete(key)
    }
  }

  private _formatInput(llmRequest: LlmRequest): FormattedMessage[] {
    const contents = (sanitizeGemini(llmRequest.contents, this._client) as Content[]) ?? []
    const messages = Array.isArray(contents) ? contents.map((content) => formatContent(content)) : []

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

function formatContent(content: Content): FormattedMessage {
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
      blocks.push({ type: 'text', text: safeStringify(part.functionResponse.response ?? part.functionResponse) })
    } else if (part.inlineData) {
      const mimeType = part.inlineData.mimeType || part.inlineData.mime_type || 'application/octet-stream'
      blocks.push(buildInlineDataBlock(mimeType, part.inlineData.data))
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
  for (const part of parts as unknown[]) {
    if (typeof part === 'string') {
      return part
    }
    if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
      return (part as { text: string }).text
    }
  }
  return null
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

function safeStringify(value: unknown): string {
  try {
    return typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value))
  } catch {
    return String(value)
  }
}
