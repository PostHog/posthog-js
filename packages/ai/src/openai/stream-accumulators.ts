import type OpenAI from 'openai'
import type { FormattedContent, FormattedMessage, TokenUsage } from '../types'
import { calculateWebSearchCount } from '../utils'
import { extractCacheWriteTokens, isResponseTokenChunk, isTerminalResponse, responsesStopReason } from './utils'

export interface OpenAIChatStreamResult {
  output: FormattedMessage[]
  model?: string
  completionId?: string
  systemFingerprint?: string
  serviceTier?: string
  firstTokenTime?: number
  stopReason?: string
  usage: TokenUsage
}

interface ChatChoiceState {
  content: string
  refusal: string
  toolCalls: Map<number | string, { id: string; name: string; arguments: string }>
  lastToolCallKey?: number | string
}

function formatChoiceContent(state: ChatChoiceState): FormattedContent {
  const content: FormattedContent = []
  if (state.content) {
    content.push({ type: 'text', text: state.content })
  }
  if (state.refusal) {
    content.push({ type: 'refusal', refusal: state.refusal })
  }
  for (const toolCall of state.toolCalls.values()) {
    if (toolCall.name) {
      content.push({
        type: 'function',
        id: toolCall.id,
        function: { name: toolCall.name, arguments: toolCall.arguments },
      })
    }
  }
  return content
}

/** Pure state accumulator for OpenAI-compatible Chat Completions chunks. */
export class OpenAIChatStreamAccumulator {
  // With `n > 1` each chunk carries the delta of one choice, named by its `index`, so the
  // content and tool calls of each choice are kept apart.
  private readonly choices = new Map<number, ChatChoiceState>()
  private model?: string
  private completionId?: string
  private systemFingerprint?: string
  private serviceTier?: string
  private firstTokenTime?: number
  private stopReason?: string
  private usage: TokenUsage = { webSearchCount: 0 }

  consume(chunk: OpenAI.ChatCompletionChunk, receivedAt = Date.now()): void {
    this.model ||= chunk.model || undefined
    this.completionId ||= chunk.id || undefined
    this.systemFingerprint ||= chunk.system_fingerprint || undefined
    if (chunk.service_tier != null) {
      this.serviceTier = chunk.service_tier
    }

    const webSearchCount = calculateWebSearchCount(chunk)
    if (webSearchCount > (this.usage.webSearchCount ?? 0)) {
      this.usage.webSearchCount = webSearchCount
    }

    for (const choice of chunk.choices ?? []) {
      this.consumeChoice(choice, receivedAt)
    }

    if (chunk.usage) {
      this.usage = {
        ...this.usage,
        inputTokens: chunk.usage.prompt_tokens ?? 0,
        outputTokens: chunk.usage.completion_tokens ?? 0,
        reasoningTokens: chunk.usage.completion_tokens_details?.reasoning_tokens ?? 0,
        cacheReadInputTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
        cacheCreationInputTokens: extractCacheWriteTokens(chunk.usage.prompt_tokens_details),
        rawUsage: chunk.usage,
      }
    }
  }

  private consumeChoice(choice: OpenAI.ChatCompletionChunk.Choice, receivedAt: number): void {
    const index = choice.index ?? 0
    let state = this.choices.get(index)
    if (!state) {
      state = { content: '', refusal: '', toolCalls: new Map() }
      this.choices.set(index, state)
    }

    // Like a non-streamed completion, the stop reason is the first choice's.
    if (choice.finish_reason && index === 0) {
      this.stopReason = choice.finish_reason
    }

    if (choice.delta?.content) {
      this.firstTokenTime ??= receivedAt
      state.content += choice.delta.content
    }

    if (choice.delta?.refusal) {
      this.firstTokenTime ??= receivedAt
      state.refusal += choice.delta.refusal
    }

    if (Array.isArray(choice.delta?.tool_calls)) {
      this.firstTokenTime ??= receivedAt
      for (const toolCall of choice.delta.tool_calls) {
        const key = this.toolCallKey(state, toolCall)
        const current = state.toolCalls.get(key) ?? { id: '', name: '', arguments: '' }
        if (toolCall.id) {
          current.id = toolCall.id
        }
        // Custom tools stream their free-form text in `custom.input`, with no `function` object.
        const name = toolCall.function?.name ?? toolCall.custom?.name
        const argumentsDelta = toolCall.function?.arguments ?? toolCall.custom?.input
        if (name) {
          current.name = name
        }
        if (argumentsDelta) {
          current.arguments += argumentsDelta
        }
        state.toolCalls.set(key, current)
        state.lastToolCallKey = key
      }
    }
  }

  /**
   * Some OpenAI-compatible providers stream tool calls without an `index`. Match those deltas by a known
   * `id`; a new `id`, a function name, or a custom tool name opens a new call, and anything else continues
   * the latest call.
   */
  private toolCallKey(
    state: ChatChoiceState,
    toolCall: {
      index?: number
      id?: string
      function?: { name?: string }
      custom?: { name?: string }
    }
  ): number | string {
    if (toolCall.index !== undefined) {
      return toolCall.index
    }
    if (toolCall.id) {
      for (const [key, existing] of state.toolCalls) {
        if (existing.id === toolCall.id) {
          return key
        }
      }
    }
    if (toolCall.id || toolCall.function?.name || toolCall.custom?.name || state.lastToolCallKey === undefined) {
      return `no-index-${state.toolCalls.size}`
    }
    return state.lastToolCallKey
  }

  result(): OpenAIChatStreamResult {
    // One message per choice in index order, the shape a non-streamed completion is captured with.
    const output: FormattedMessage[] = []
    for (const [, state] of [...this.choices].sort(([a], [b]) => a - b)) {
      const content = formatChoiceContent(state)
      if (content.length > 0) {
        output.push({ role: 'assistant', content })
      }
    }

    return {
      output: output.length > 0 ? output : [{ role: 'assistant', content: [{ type: 'text', text: '' }] }],
      model: this.model,
      completionId: this.completionId,
      systemFingerprint: this.systemFingerprint,
      serviceTier: this.serviceTier,
      firstTokenTime: this.firstTokenTime,
      stopReason: this.stopReason,
      usage: { ...this.usage },
    }
  }
}

export interface OpenAIResponsesStreamResult {
  output: unknown[]
  model?: string
  completionId?: string
  serviceTier?: string
  firstTokenTime?: number
  stopReason?: string
  usage: TokenUsage
  terminalResponse?: OpenAI.Responses.Response
}

/** Pure state accumulator for OpenAI-compatible Responses stream events. */
export class OpenAIResponsesStreamAccumulator {
  private output: unknown[] = []
  private model?: string
  private completionId?: string
  private serviceTier?: string
  private firstTokenTime?: number
  private stopReason?: string
  private usage: TokenUsage = { webSearchCount: 0 }
  private terminalResponse?: OpenAI.Responses.Response

  consume(event: OpenAI.Responses.ResponseStreamEvent, receivedAt = Date.now()): void {
    if (this.firstTokenTime === undefined && isResponseTokenChunk(event)) {
      this.firstTokenTime = receivedAt
    }
    if (!('response' in event) || !event.response) {
      return
    }

    const response = event.response
    this.model ||= response.model || undefined
    this.completionId ||= response.id || undefined
    if (response.service_tier != null) {
      this.serviceTier = response.service_tier
    }

    const webSearchCount = calculateWebSearchCount(response)
    if (webSearchCount > (this.usage.webSearchCount ?? 0)) {
      this.usage.webSearchCount = webSearchCount
    }

    if (response.usage) {
      this.usage = {
        ...this.usage,
        inputTokens: response.usage.input_tokens ?? 0,
        outputTokens: response.usage.output_tokens ?? 0,
        reasoningTokens: response.usage.output_tokens_details?.reasoning_tokens ?? 0,
        cacheReadInputTokens: response.usage.input_tokens_details?.cached_tokens ?? 0,
        cacheCreationInputTokens: extractCacheWriteTokens(response.usage.input_tokens_details),
        rawUsage: response.usage,
      }
    }

    if (isTerminalResponse(response)) {
      this.terminalResponse = response
      this.output = response.output ?? []
      this.stopReason = responsesStopReason(response)
    }
  }

  result(): OpenAIResponsesStreamResult {
    return {
      output: [...this.output],
      model: this.model,
      completionId: this.completionId,
      serviceTier: this.serviceTier,
      firstTokenTime: this.firstTokenTime,
      stopReason: this.stopReason,
      usage: { ...this.usage },
      terminalResponse: this.terminalResponse,
    }
  }
}
