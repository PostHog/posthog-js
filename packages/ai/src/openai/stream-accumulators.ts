import type OpenAI from 'openai'
import type { FormattedContent, FormattedMessage, TokenUsage } from '../types'
import { calculateWebSearchCount } from '../utils'
import { extractCacheWriteTokens, isResponseTokenChunk, isTerminalResponse } from './utils'

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

/** Pure state accumulator for OpenAI-compatible Chat Completions chunks. */
export class OpenAIChatStreamAccumulator {
  private accumulatedContent = ''
  private model?: string
  private completionId?: string
  private systemFingerprint?: string
  private serviceTier?: string
  private firstTokenTime?: number
  private stopReason?: string
  // Token counts stay undefined until a chunk reports them. Seeding them at 0
  // would make a stream that never carried usage — cancelled, or streamed
  // without usage reporting enabled — indistinguishable from one that genuinely
  // consumed nothing.
  private usage: TokenUsage = { webSearchCount: 0 }
  private readonly toolCalls = new Map<number, { id: string; name: string; arguments: string }>()

  consume(chunk: OpenAI.ChatCompletionChunk, receivedAt = Date.now()): void {
    this.model ||= chunk.model || undefined
    this.completionId ||= chunk.id || undefined
    this.systemFingerprint ||= chunk.system_fingerprint || undefined
    if (chunk.service_tier != null) {
      this.serviceTier = chunk.service_tier
    }

    const choice = chunk.choices?.[0]
    if (choice?.finish_reason) {
      this.stopReason = choice.finish_reason
    }

    const webSearchCount = calculateWebSearchCount(chunk)
    if (webSearchCount > (this.usage.webSearchCount ?? 0)) {
      this.usage.webSearchCount = webSearchCount
    }

    if (choice?.delta?.content) {
      this.firstTokenTime ??= receivedAt
      this.accumulatedContent += choice.delta.content
    }

    if (Array.isArray(choice?.delta?.tool_calls)) {
      this.firstTokenTime ??= receivedAt
      for (const toolCall of choice.delta.tool_calls) {
        if (toolCall.index === undefined) {
          continue
        }
        const current = this.toolCalls.get(toolCall.index) ?? { id: '', name: '', arguments: '' }
        if (toolCall.id) {
          current.id = toolCall.id
        }
        if (toolCall.function?.name) {
          current.name = toolCall.function.name
        }
        if (toolCall.function?.arguments) {
          current.arguments += toolCall.function.arguments
        }
        this.toolCalls.set(toolCall.index, current)
      }
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

  result(): OpenAIChatStreamResult {
    const content: FormattedContent = []
    if (this.accumulatedContent) {
      content.push({ type: 'text', text: this.accumulatedContent })
    }
    for (const toolCall of this.toolCalls.values()) {
      if (toolCall.name) {
        content.push({
          type: 'function',
          id: toolCall.id,
          function: { name: toolCall.name, arguments: toolCall.arguments },
        })
      }
    }

    return {
      output: [
        {
          role: 'assistant',
          content: content.length > 0 ? content : [{ type: 'text', text: '' }],
        },
      ],
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
  // Undefined until an event reports usage, for the same reason as the chat
  // accumulator above: a stream that never carried usage is not a stream that
  // consumed nothing.
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
      this.stopReason = response.status
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
