import { query as originalQuery } from '@anthropic-ai/claude-agent-sdk'
import type {
  Options,
  Query,
  SDKAssistantMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type { EventMessage, PostHog } from 'posthog-node'
import { v4 as uuidv4 } from 'uuid'
import { version } from '../../package.json'
import { captureAiEvent, captureAiEventImmediate } from '../captureAiEvent'
import { captureAiGeneration } from '../captureAiGeneration'
import type { CaptureAiGenerationOptions } from '../captureAiGeneration'
import { stringifyError } from '../serializeError'
import type { FormattedMessage, TokenUsage } from '../types'
import { withPrivacyMode } from '../utils'
import { extractSystemPrompt, formatAssistantBlocks, formatContent, formatUserContent } from './formatting'
import type { ClaudeAgentContentItem } from './formatting'

const FRAMEWORK = 'claude-agent-sdk'
const PROVIDER = 'anthropic'

/**
 * Resolver for the PostHog distinct ID. Either a static string, or a function
 * that derives it from the SDK result message. Return `null`/`undefined` to
 * capture anonymously (personless), keyed by the trace ID.
 */
export type DistinctIdResolver = string | ((result: SDKResultMessage) => string | null | undefined)

/** Per-query tracing options. Each one overrides the processor default. */
export interface ClaudeAgentTraceOptions {
  /** Distinct ID for the captured events. Defaults to anonymous (personless) capture. */
  distinctId?: DistinctIdResolver
  /**
   * Trace ID shared by every event of the query. Generated per turn when
   * omitted, so each turn of a streaming-input session is its own trace.
   */
  traceId?: string
  /** Redacts captured input/output content when true. Defaults to false. */
  privacyMode?: boolean
  /** Group analytics mapping (group type -> group id) attached to every event. */
  groups?: Record<string, string | number>
  /** Extra properties merged into every captured AI event. */
  properties?: Record<string, unknown>
}

export interface PostHogClaudeAgentProcessorOptions extends ClaudeAgentTraceOptions {
  /** The PostHog client used to capture events. */
  client: PostHog
  /** Awaits event delivery instead of batching. Useful in serverless environments. */
  captureImmediate?: boolean
  /** Invoked when the processor fails to capture an event. Never throws into the query. */
  onError?: (error: unknown) => void
}

export interface ClaudeAgentQueryParams {
  /** The prompt, exactly as `query()` from the Claude Agent SDK takes it. */
  prompt: string | AsyncIterable<SDKUserMessage>
  /** Claude Agent SDK options. `includePartialMessages` is enabled internally. */
  options?: Options
  /** Tracing options for this query, overriding the processor defaults. */
  posthog?: ClaudeAgentTraceOptions
}

type StreamEvent = SDKPartialAssistantMessage['event']

interface AnthropicUsage {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
  server_tool_use?: { web_search_requests?: number | null } | null
}

/** Metrics of a single model call, reconstructed from the streamed events. */
interface GenerationData {
  spanId: string
  error?: unknown
  input?: FormattedMessage[]
  startTime: number
  endTime?: number
  timeToFirstToken?: number
  model?: string
  usage: TokenUsage
  stopReason?: string
  streamedOutput?: ClaudeAgentContentItem[]
}

/**
 * Reconstructs per-generation metrics from the Anthropic streaming protocol the
 * Agent SDK relays: every `message_start` to `message_stop` cycle is one model
 * call.
 */
class GenerationTracker {
  private _current?: GenerationData
  private readonly _completed: GenerationData[] = []
  private _lastModel?: string
  private _sawStreamEvents = false
  private _pendingInput?: FormattedMessage[]

  /**
   * Queue the input of the next model call. The first call answers the prompt,
   * and every later one answers the tool results of the call before it.
   */
  setPendingInput(input: FormattedMessage[] | undefined): void {
    this._pendingInput = input
  }

  appendPendingInput(input: FormattedMessage[]): void {
    this._pendingInput = [...(this._pendingInput ?? []), ...input]
  }

  /** The queued input, still waiting for its model call. */
  get pendingInput(): FormattedMessage[] | undefined {
    return this._pendingInput
  }

  processStreamEvent(event: StreamEvent, client: PostHog, ttftMs?: number): void {
    this._sawStreamEvents = true

    if (event.type === 'message_start') {
      this.retryCurrent(new Error('Model stream restarted before completing'))
      const usage = event.message.usage as AnthropicUsage | undefined
      this._current = {
        spanId: uuidv4(),
        input: this._pendingInput,
        startTime: performance.now() - (ttftMs ?? 0),
        timeToFirstToken: ttftMs != null ? ttftMs / 1000 : undefined,
        model: event.message.model,
        usage: readUsage(usage),
        streamedOutput: [],
      }
      this._pendingInput = undefined
    } else if (event.type === 'content_block_start' && this._current?.streamedOutput) {
      this._current.streamedOutput[event.index] = formatAssistantBlocks([event.content_block], client)[0]
    } else if (event.type === 'content_block_delta') {
      const block = this._current?.streamedOutput?.[event.index]
      if (event.delta.type === 'text_delta' && block?.type === 'text') {
        block.text += event.delta.text
      } else if (event.delta.type === 'thinking_delta' && block?.type === 'reasoning') {
        block.text += event.delta.thinking
      } else if (event.delta.type === 'input_json_delta' && block?.type === 'function') {
        const previous = block.function.arguments
        block.function.arguments = (typeof previous === 'string' ? previous : '') + event.delta.partial_json
      }
    } else if (event.type === 'message_delta' && this._current) {
      const usage = event.usage as AnthropicUsage | undefined
      // `message_delta` reports the cumulative counts of the call so far.
      this._current.usage = {
        ...this._current.usage,
        ...readUsage(usage),
        rawUsage: { ...(this._current.usage.rawUsage as Record<string, unknown>), ...usage },
      }
      if (event.delta?.stop_reason != null) {
        this._current.stopReason = event.delta.stop_reason
      }
    } else if (event.type === 'message_stop') {
      this.finishCurrent()
    }
  }

  finishCurrent(): void {
    if (this._current) {
      this._current.endTime = performance.now()
      this._completed.push(this._current)
      this._lastModel = this._current.model
      this._current = undefined
    }
  }

  retryCurrent(error: unknown): void {
    if (this._current) {
      this._pendingInput = this._current.input
      this._current.error = error
      this.finishCurrent()
    }
  }

  setModel(model: string | undefined): void {
    if (model) {
      this._lastModel = model
    }
  }

  popCompleted(): GenerationData | undefined {
    return this._completed.shift()
  }

  /** Span ID of the generation in progress, before its `message_stop`. */
  get currentSpanId(): string | undefined {
    return this._current?.spanId
  }

  get lastModel(): string | undefined {
    return this._lastModel
  }

  get sawStreamEvents(): boolean {
    return this._sawStreamEvents
  }
}

/** Everything the instrumentation tracks for the turn in flight. */
interface QueryState {
  tracker: GenerationTracker
  systemPrompt?: string
  pendingCaptures: Array<(distinctId?: string) => Promise<void>>
  pendingTools: Map<string, { startTime: number; properties: Record<string, unknown> }>
  traceId: string
  turnStart: number
  // Subagent tool spans can arrive outside a main-agent generation.
  turnCaptured: boolean
  turnActive: boolean
  hasCapturedTrace: boolean
  pendingPrompts: SDKUserMessage[]
  userMessageUuid?: string
  failure?: unknown
  generationIndex: number
  lastGenerationSpanId?: string
  sessionId?: string
  totalCost: number
  turnCost?: number
  // One model call can deliver its blocks over several assistant messages, so
  // the content of a turn accumulates until the turn closes.
  pendingOutput: ClaudeAgentContentItem[]
}

/**
 * Wraps `query()` from `@anthropic-ai/claude-agent-sdk` to capture PostHog LLM
 * analytics.
 *
 * The Agent SDK runs Claude Code itself, so no request passes through an
 * Anthropic client the `@posthog/ai` Anthropic wrapper could patch. This
 * processor reads the SDK's own message stream instead and captures:
 *
 * - `$ai_generation` for each main-agent model call, reconstructed from the streamed
 *   Anthropic events;
 * - `$ai_span` for every tool use, parented to the generation that asked for it;
 * - `$ai_trace` for every turn, carrying its latency and reported cost.
 *
 * @example
 * ```typescript
 * import { PostHogClaudeAgentProcessor } from '@posthog/ai/claude-agent-sdk'
 * import { PostHog } from 'posthog-node'
 *
 * const phClient = new PostHog('<POSTHOG_API_KEY>')
 * const processor = new PostHogClaudeAgentProcessor({ client: phClient, distinctId: 'user@example.com' })
 *
 * for await (const message of processor.query({ prompt: 'Explain this repo' })) {
 *   console.log(message)
 * }
 * ```
 */
export class PostHogClaudeAgentProcessor {
  private readonly _client: PostHog
  private readonly _traceOptions: ClaudeAgentTraceOptions
  private readonly _captureImmediate: boolean
  private readonly _onError?: (error: unknown) => void

  constructor(options: PostHogClaudeAgentProcessorOptions) {
    this._client = options.client
    this._traceOptions = options
    this._captureImmediate = options.captureImmediate ?? false
    this._onError = options.onError
  }

  /**
   * Drop-in replacement for `query()` from the Claude Agent SDK. Hidden partial
   * messages pass their reply correlation to the first assistant message.
   * Other messages and the control methods (`interrupt`,
   * `setPermissionMode`, …) retain the SDK behavior.
   */
  query({ prompt, options, posthog }: ClaudeAgentQueryParams): Query {
    const trace: ClaudeAgentTraceOptions = {
      ...this._traceOptions,
      ...posthog,
      // A per-query setting can turn redaction on but never off, so a processor
      // configured for privacy stays private.
      privacyMode: this._traceOptions.privacyMode === true || posthog?.privacyMode === true,
      properties: { ...this._traceOptions.properties, ...posthog?.properties },
    }
    for (const key of ['$ai_trace_id', '$ai_span_id', '$ai_parent_id', '$ai_session_id']) {
      delete trace.properties?.[key]
    }

    // Partial messages carry the per-generation metrics, so they are always
    // requested. Callers who did not ask for them never see them.
    const forwardStreamEvents = options?.includePartialMessages === true
    const state = this._createState(prompt, options, trace)
    const inner = originalQuery({
      prompt: typeof prompt === 'string' ? prompt : this._observePrompt(prompt, state),
      options: { ...options, includePartialMessages: true },
    })

    const instrumented = this._instrument(inner, state, trace, forwardStreamEvents)
    // A `for await` loop reads `next` once per message, so the iteration
    // methods are bound once rather than on every read.
    const iteration: Record<string | symbol, unknown> = {
      next: instrumented.next.bind(instrumented),
      streamInput: (stream: AsyncIterable<SDKUserMessage>) => inner.streamInput(this._observePrompt(stream, state)),
      // The SDK starts its subprocess before the first next(), so cleanup must reach it directly.
      return: async (value?: void) => {
        try {
          return await inner.return(value)
        } finally {
          await instrumented.return()
        }
      },
      throw: async (error?: unknown) => {
        state.failure = error
        try {
          return await inner.throw(error)
        } finally {
          await instrumented.return()
        }
      },
      close: () => {
        try {
          inner.close()
        } finally {
          void instrumented.return().catch((error) => this._handleError(error))
        }
      },
      [Symbol.asyncDispose]: async () => {
        try {
          const dispose = Reflect.get(inner, Symbol.asyncDispose)
          if (typeof dispose === 'function') {
            await dispose.call(inner)
          } else {
            await inner.return()
          }
        } finally {
          await instrumented.return()
        }
      },
      [Symbol.asyncIterator]: () => wrapper,
    }

    // The SDK returns a generator that also carries control methods
    // (`interrupt`, `setPermissionMode`, …), so iteration goes to the wrapper
    // and every other read goes to the original object.
    const wrapper: Query = new Proxy(inner, {
      get(target, property) {
        if (Object.hasOwn(iteration, property)) {
          return iteration[property]
        }
        // boffin: SDK getters can read private fields on the original query.
        const value = Reflect.get(target, property, target)
        return typeof value === 'function' && property !== 'constructor' ? value.bind(target) : value
      },
    })
    return wrapper
  }

  private async *_instrument(
    inner: Query,
    state: QueryState,
    trace: ClaudeAgentTraceOptions,
    forwardStreamEvents: boolean
  ): AsyncGenerator<SDKMessage, void> {
    try {
      for await (const message of inner) {
        try {
          await this._handleMessage(message, state, trace)
        } catch (error) {
          this._handleError(error)
        }
        if (message.type !== 'stream_event' || forwardStreamEvents) {
          if (
            !forwardStreamEvents &&
            message.type === 'assistant' &&
            !message.parent_tool_use_id &&
            state.userMessageUuid
          ) {
            const userMessageUuid = state.userMessageUuid
            state.userMessageUuid = undefined
            yield { ...message, user_message_uuid: message.user_message_uuid ?? userMessageUuid }
          } else {
            yield message
          }
        }
      }
    } catch (error) {
      state.failure = error
      throw error
    } finally {
      const failure = state.failure
      // An aborted query, or a caller that stops iterating, never delivers a
      // result message. The turn is still closed so its generations and spans
      // have a trace.
      // The SDK can throw after an error result already closed the last turn.
      if (state.turnActive || state.turnCaptured || (failure !== undefined && !state.hasCapturedTrace)) {
        try {
          state.tracker.finishCurrent()
          await this._captureCompletedGenerations(state, trace, failure)
          if (!state.tracker.sawStreamEvents && state.pendingOutput.length > 0) {
            state.generationIndex += 1
            await this._captureGeneration(
              {
                spanId: uuidv4(),
                input: state.tracker.pendingInput,
                startTime: state.turnStart,
                endTime: performance.now(),
                usage: {},
                error: failure,
              },
              state,
              trace
            )
          }
        } catch (error) {
          this._handleError(error)
        }
        try {
          await this._captureTrace(state, trace, undefined, failure)
        } catch (error) {
          this._handleError(error)
        }
      }
    }
  }

  private _createState(
    prompt: string | AsyncIterable<SDKUserMessage>,
    options: Options | undefined,
    trace: ClaudeAgentTraceOptions
  ): QueryState {
    const initialInput: FormattedMessage[] = []
    const systemPrompt = extractSystemPrompt(options)
    if (systemPrompt) {
      initialInput.push({ role: 'system', content: systemPrompt })
    }

    const tracker = new GenerationTracker()
    tracker.setPendingInput(initialInput.length > 0 ? initialInput : undefined)

    return {
      tracker,
      systemPrompt,
      pendingCaptures: [],
      pendingTools: new Map(),
      traceId: trace.traceId ?? uuidv4(),
      turnStart: performance.now(),
      turnCaptured: false,
      turnActive: false,
      hasCapturedTrace: false,
      pendingPrompts:
        typeof prompt === 'string'
          ? [{ type: 'user', message: { role: 'user', content: prompt }, parent_tool_use_id: null }]
          : [],
      generationIndex: 0,
      pendingOutput: [],
      totalCost: 0,
    }
  }

  private async *_observePrompt(
    prompt: AsyncIterable<SDKUserMessage>,
    state: QueryState
  ): AsyncGenerator<SDKUserMessage> {
    for await (const message of prompt) {
      state.pendingPrompts.push(message)
      yield message
    }
  }

  private _beginTurn(state: QueryState, userMessageUuid?: string): void {
    if (state.turnActive) {
      return
    }
    state.turnActive = true

    // The SDK can read ahead or prioritize a later prompt before answering it.
    let end = userMessageUuid ? state.pendingPrompts.findIndex((message) => message.uuid === userMessageUuid) : -1
    if (end < 0) {
      const candidates = state.pendingPrompts.filter((message) => message.shouldQuery !== false)
      if (candidates.length !== 1 || (userMessageUuid && candidates[0].uuid)) {
        return
      }
      end = state.pendingPrompts.indexOf(candidates[0])
    }
    if (end < 0) {
      return
    }
    let start = end
    while (start > 0 && state.pendingPrompts[start - 1].shouldQuery === false) {
      start -= 1
    }
    for (const message of state.pendingPrompts.splice(start, end - start + 1)) {
      state.tracker.appendPendingInput([
        { role: 'user', content: formatUserContent(message.message.content, this._client) },
      ])
    }
  }

  private async _handleMessage(message: SDKMessage, state: QueryState, trace: ClaudeAgentTraceOptions): Promise<void> {
    if ('session_id' in message && message.session_id) {
      state.sessionId = message.session_id
    }

    if (message.type === 'conversation_reset') {
      state.totalCost = 0
    } else if (message.type === 'system' && message.subtype === 'api_retry') {
      state.tracker.retryCurrent(Object.assign(new Error(message.error), { status: message.error_status }))
      await this._captureCompletedGenerations(state, trace)
    } else if (message.type === 'stream_event') {
      if (message.parent_tool_use_id) {
        return
      }
      if (message.user_message_uuid) {
        state.userMessageUuid = message.user_message_uuid
      }
      if (message.event.type === 'message_start') {
        this._beginTurn(state, message.user_message_uuid)
      }
      state.tracker.processStreamEvent(message.event, this._client, message.ttft_ms)
      await this._captureCompletedGenerations(state, trace)
    } else if (message.type === 'assistant') {
      if (!message.parent_tool_use_id) {
        this._beginTurn(state, message.user_message_uuid)
      }
      this._handleAssistantMessage(message, state, trace)
    } else if (message.type === 'user') {
      if ('isReplay' in message && message.isReplay) {
        return
      }
      if (Array.isArray(message.message.content)) {
        for (const block of message.message.content) {
          if (block.type === 'tool_result') {
            await this._finishToolSpan(block.tool_use_id, state, trace, block)
          }
        }
      }
      if (message.parent_tool_use_id) {
        return
      }
      // A user message carries the tool results of the model call that asked
      // for them, so it becomes the input of the next model call.
      const content = formatUserContent(message.message?.content, this._client)
      if (typeof content === 'string' || (Array.isArray(content) && content.length > 0)) {
        state.tracker.appendPendingInput([{ role: 'user', content }])
      }
    } else if (message.type === 'result') {
      try {
        this._beginTurn(state, message.user_message_uuid)
        state.tracker.finishCurrent()
        await this._captureCompletedGenerations(state, trace, resultError(message), message)
        if (message.total_cost_usd != null) {
          // The SDK reports cumulative cost and can reset it when the session is cleared.
          state.turnCost = message.total_cost_usd - (message.total_cost_usd >= state.totalCost ? state.totalCost : 0)
          state.totalCost = message.total_cost_usd
        }
        // Without partial messages there is no per-call metric, so the result's
        // aggregate becomes one generation.
        if (!state.tracker.sawStreamEvents) {
          await this._captureGenerationFromResult(message, state, trace)
        }
      } finally {
        await this._captureTrace(state, trace, message)
      }
    }
  }

  private async _captureCompletedGenerations(
    state: QueryState,
    trace: ClaudeAgentTraceOptions,
    failure?: unknown,
    result?: SDKResultMessage
  ): Promise<void> {
    let generation = state.tracker.popCompleted()
    while (generation) {
      generation.error ??= failure
      state.generationIndex += 1
      state.lastGenerationSpanId = generation.spanId
      state.turnCaptured = true
      await this._captureGeneration(generation, state, trace, {}, result)
      state.pendingOutput = []
      generation = state.tracker.popCompleted()
    }
  }

  private _handleAssistantMessage(
    message: SDKAssistantMessage,
    state: QueryState,
    trace: ClaudeAgentTraceOptions
  ): void {
    if (!message.parent_tool_use_id) {
      state.tracker.setModel(message.message?.model)
    }

    // An assistant message arrives before its `message_stop`, so the generation
    // in progress is the parent of its tool calls.
    const parentSpanId = message.parent_tool_use_id ?? state.tracker.currentSpanId ?? state.lastGenerationSpanId
    const blocks = Array.isArray(message.message?.content)
      ? (message.message.content as Array<Record<string, any>>)
      : []
    for (const block of blocks) {
      if (block?.type === 'tool_use') {
        state.turnCaptured = true
        this._startToolSpan(block, state, trace, parentSpanId)
      }
    }

    if (!message.parent_tool_use_id) {
      state.pendingOutput.push(...formatAssistantBlocks(message.message?.content, this._client))
    }
  }

  private async _captureGeneration(
    generation: GenerationData,
    state: QueryState,
    trace: ClaudeAgentTraceOptions,
    extraProperties: Record<string, unknown> = {},
    result?: SDKResultMessage
  ): Promise<void> {
    const options: CaptureAiGenerationOptions = {
      traceId: state.traceId,
      model: generation.model ?? state.tracker.lastModel,
      provider: PROVIDER,
      baseURL: null,
      httpStatus: result?.subtype === 'success' ? (result.api_error_status ?? undefined) : undefined,
      error: generation.error,
      input: generation.input ?? [],
      // Complete assistant messages replace the streamed prefix, leaving only unfinished blocks to append.
      output: formatContent(
        formatOutput([
          ...state.pendingOutput,
          ...(generation.streamedOutput?.slice(state.pendingOutput.length).filter(Boolean) ?? []),
        ]),
        this._client
      ),
      latency: generation.endTime != null ? (generation.endTime - generation.startTime) / 1000 : undefined,
      timeToFirstToken: generation.timeToFirstToken,
      usage: generation.usage,
      stopReason: generation.stopReason,
      groups: trace.groups,
      privacyMode: trace.privacyMode ?? false,
      captureImmediate: this._captureImmediate,
      onError: this._onError,
      properties: {
        $ai_framework: FRAMEWORK,
        $ai_span_id: generation.spanId,
        $ai_span_name: `generation_${state.generationIndex}`,
        ...(state.sessionId ? { $ai_session_id: state.sessionId } : {}),
        ...extraProperties,
        ...trace.properties,
      },
    }
    await this._withDistinctId(state, trace, (distinctId) =>
      captureAiGeneration(this._client, { ...options, distinctId })
    )
  }

  /**
   * Without partial messages there is no per-call metric, so the aggregate the
   * result message reports becomes one generation.
   */
  private async _captureGenerationFromResult(
    result: SDKResultMessage,
    state: QueryState,
    trace: ClaudeAgentTraceOptions
  ): Promise<void> {
    state.generationIndex += 1
    const endTime = performance.now()

    const generation: GenerationData = {
      spanId: uuidv4(),
      input: state.tracker.pendingInput ?? [],
      startTime: endTime - (result.duration_api_ms ?? 0),
      endTime,
      usage: readUsage(result.usage as AnthropicUsage | undefined),
      stopReason: result.stop_reason ?? undefined,
      error: resultError(result),
    }

    await this._captureGeneration(
      generation,
      state,
      trace,
      {
        ...(state.turnCost != null ? { $ai_total_cost_usd: state.turnCost } : {}),
      },
      result
    )
  }

  private _startToolSpan(
    block: Record<string, any>,
    state: QueryState,
    trace: ClaudeAgentTraceOptions,
    parentSpanId: string | undefined
  ): void {
    const properties = {
      $ai_span_id: block.id ?? uuidv4(),
      ...(parentSpanId ? { $ai_parent_id: parentSpanId } : {}),
      $ai_span_name: block.name,
      $ai_span_type: 'tool',
      $ai_input_state: withPrivacyMode(
        this._client,
        trace.privacyMode ?? false,
        formatContent(block.input ?? {}, this._client)
      ),
    }
    state.pendingTools.set(properties.$ai_span_id, { startTime: performance.now(), properties })
  }

  private async _finishToolSpan(
    id: string,
    state: QueryState,
    trace: ClaudeAgentTraceOptions,
    result?: { content?: unknown; is_error?: boolean }
  ): Promise<void> {
    const tool = state.pendingTools.get(id)
    if (!tool) {
      return
    }
    state.pendingTools.delete(id)
    const properties = {
      ...tool.properties,
      $ai_latency: (performance.now() - tool.startTime) / 1000,
      ...(result
        ? {
            $ai_output_state: withPrivacyMode(
              this._client,
              trace.privacyMode ?? false,
              formatContent(result.content, this._client)
            ),
            $ai_is_error: result.is_error === true,
          }
        : {}),
    }
    await this._withDistinctId(state, trace, (distinctId) =>
      this._captureLifecycleEvent('$ai_span', distinctId, state, trace, properties)
    )
  }

  private async _withDistinctId(
    state: QueryState,
    trace: ClaudeAgentTraceOptions,
    capture: (distinctId?: string) => Promise<void>
  ): Promise<void> {
    if (typeof trace.distinctId === 'function') {
      // boffin: Resolve the person once per turn so all its events use the same identity.
      state.pendingCaptures.push(capture)
    } else {
      await capture(resolveDistinctId(trace.distinctId))
    }
  }

  private async _captureTrace(
    state: QueryState,
    trace: ClaudeAgentTraceOptions,
    result?: SDKResultMessage,
    failure?: unknown
  ): Promise<void> {
    try {
      const latency =
        result?.duration_ms != null ? result.duration_ms / 1000 : (performance.now() - state.turnStart) / 1000
      const isError = failure !== undefined || result?.is_error === true
      const error = failure ?? (result && resultError(result))

      for (const id of state.pendingTools.keys()) {
        await this._finishToolSpan(id, state, trace)
      }
      let distinctId: string | undefined
      try {
        distinctId = resolveDistinctId(trace.distinctId, result)
      } catch (error) {
        this._handleError(error)
      }
      for (const capture of state.pendingCaptures.splice(0)) {
        try {
          await capture(distinctId)
        } catch (error) {
          this._handleError(error)
        }
      }
      await this._captureLifecycleEvent('$ai_trace', distinctId, state, trace, {
        $ai_trace_name: 'claude_agent_sdk_query',
        $ai_latency: latency,
        ...(state.turnCost != null ? { $ai_total_cost_usd: state.turnCost } : {}),
        ...(isError ? { $ai_is_error: true } : {}),
        ...(error !== undefined ? { $ai_error: stringifyError(error) } : {}),
        ...(result?.subtype === 'success' && result.api_error_status != null
          ? { $ai_http_status: result.api_error_status }
          : {}),
      })
    } finally {
      // A streaming-input session produces one result per turn. Each turn becomes
      // its own trace unless the caller pinned a trace ID for the whole session.
      state.hasCapturedTrace = true
      state.traceId = trace.traceId ?? uuidv4()
      state.turnStart = performance.now()
      state.turnCaptured = false
      state.turnActive = false
      state.userMessageUuid = undefined
      state.failure = undefined
      state.generationIndex = 0
      state.lastGenerationSpanId = undefined
      state.turnCost = undefined
      state.pendingCaptures = []
      state.pendingTools.clear()
      if (result?.queued_turn_count === 0) {
        state.pendingPrompts = state.pendingPrompts.filter((message) => message.shouldQuery === false)
      }
      state.tracker = new GenerationTracker()
      if (state.systemPrompt) {
        state.tracker.setPendingInput([{ role: 'system', content: state.systemPrompt }])
      }
      state.pendingOutput = []
    }
  }

  private async _captureLifecycleEvent(
    event: '$ai_trace' | '$ai_span',
    distinctId: string | undefined,
    state: QueryState,
    trace: ClaudeAgentTraceOptions,
    properties: Record<string, unknown>
  ): Promise<void> {
    const message: EventMessage = {
      distinctId: distinctId ?? state.traceId,
      event,
      properties: {
        $ai_lib: 'posthog-ai',
        $ai_lib_version: version,
        $ai_framework: FRAMEWORK,
        $ai_provider: PROVIDER,
        $ai_trace_id: state.traceId,
        ...(state.sessionId ? { $ai_session_id: state.sessionId } : {}),
        ...properties,
        ...trace.properties,
        ...(distinctId ? {} : { $process_person_profile: false }),
      },
      groups: trace.groups,
    }

    try {
      if (this._captureImmediate) {
        await captureAiEventImmediate(this._client, message)
      } else {
        captureAiEvent(this._client, message)
      }
    } catch (error) {
      this._handleError(error)
    }
  }

  private _handleError(error: unknown): void {
    try {
      this._onError?.(error)
    } catch {
      // Instrumentation must never throw into the query.
    }
  }
}

function formatOutput(content: ClaudeAgentContentItem[]): FormattedMessage[] {
  return content.length > 0 ? [{ role: 'assistant', content }] : []
}

function resultError(result: SDKResultMessage): string | undefined {
  if (!result.is_error) {
    return undefined
  }
  return (result.subtype === 'success' ? result.result : result.errors.join('\n')) || result.subtype
}

function readUsage(usage: AnthropicUsage | undefined): TokenUsage {
  return {
    ...(usage && Object.keys(usage).length > 0 ? { rawUsage: { ...usage } } : {}),
    ...(usage?.input_tokens != null ? { inputTokens: usage.input_tokens } : {}),
    ...(usage?.output_tokens != null ? { outputTokens: usage.output_tokens } : {}),
    ...(usage?.cache_read_input_tokens != null ? { cacheReadInputTokens: usage.cache_read_input_tokens } : {}),
    ...(usage?.cache_creation_input_tokens != null
      ? { cacheCreationInputTokens: usage.cache_creation_input_tokens }
      : {}),
    ...(usage?.server_tool_use?.web_search_requests != null
      ? { webSearchCount: usage.server_tool_use.web_search_requests }
      : {}),
  }
}

function resolveDistinctId(resolver: DistinctIdResolver | undefined, result?: SDKResultMessage): string | undefined {
  if (typeof resolver === 'function') {
    if (!result) {
      return undefined
    }
    const resolved = resolver(result)
    return resolved ? String(resolved) : undefined
  }
  return resolver ? String(resolver) : undefined
}
