import { PostHog } from 'posthog-node'
import { Buffer } from 'buffer'
import OpenAIOrignal from 'openai'
import AnthropicOriginal from '@anthropic-ai/sdk'
import type { ChatCompletionTool } from 'openai/resources/chat/completions'
import type { ResponseCreateParamsWithTools } from 'openai/lib/ResponsesParser'
import type { Tool as GeminiTool } from '@google/genai'
import type { FormattedMessage, FormattedContent, TokenUsage } from './types'
import { version } from '../package.json'
import { v4 as uuidv4 } from 'uuid'
import { isString } from './typeGuards'

type ChatCompletionCreateParamsBase = OpenAIOrignal.Chat.Completions.ChatCompletionCreateParams
type MessageCreateParams = AnthropicOriginal.Messages.MessageCreateParams
type ResponseCreateParams = OpenAIOrignal.Responses.ResponseCreateParams
type EmbeddingCreateParams = OpenAIOrignal.EmbeddingCreateParams
type TranscriptionCreateParams = OpenAIOrignal.Audio.Transcriptions.TranscriptionCreateParams
type AnthropicTool = AnthropicOriginal.Tool

// limit large outputs by truncating to 200kb (approx 200k bytes)
export const MAX_OUTPUT_SIZE = 200000
const STRING_FORMAT = 'utf8'

/**
 * Safely converts content to a string, preserving structure for objects/arrays.
 * - If content is already a string, returns it as-is
 * - If content is an object or array, stringifies it with JSON.stringify to preserve structure
 * - Otherwise, converts to string with String()
 *
 * This prevents the "[object Object]" bug when objects are naively converted to strings.
 *
 * @param content - The content to convert to a string
 * @returns A string representation that preserves structure for complex types
 */
export function toContentString(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (content !== undefined && content !== null && typeof content === 'object') {
    try {
      return JSON.stringify(content)
    } catch {
      // Fallback for circular refs, BigInt, or objects with throwing toJSON
      return String(content)
    }
  }
  return String(content)
}

export interface MonitoringEventPropertiesWithDefaults {
  distinctId?: string
  traceId: string
  properties?: Record<string, any>
  privacyMode: boolean
  groups?: Record<string, any>
  modelOverride?: string
  providerOverride?: string
  costOverride?: CostOverride
  captureImmediate?: boolean
}

export type MonitoringEventProperties = Partial<MonitoringEventPropertiesWithDefaults>

export type MonitoringParams = {
  [K in keyof MonitoringEventProperties as `posthog${Capitalize<string & K>}`]: MonitoringEventProperties[K]
}

export interface CostOverride {
  inputCost: number
  outputCost: number
}

export const getModelParams = (
  params:
    | ((
        | ChatCompletionCreateParamsBase
        | MessageCreateParams
        | ResponseCreateParams
        | ResponseCreateParamsWithTools
        | EmbeddingCreateParams
        | TranscriptionCreateParams
      ) &
        MonitoringParams)
    | null
): Record<string, any> => {
  if (!params) {
    return {}
  }
  const modelParams: Record<string, any> = {}
  const paramKeys = [
    'temperature',
    'max_tokens',
    'max_completion_tokens',
    'top_p',
    'frequency_penalty',
    'presence_penalty',
    'n',
    'stop',
    'stream',
    'streaming',
    'language',
    'response_format',
    'timestamp_granularities',
  ] as const

  for (const key of paramKeys) {
    if (key in params && (params as any)[key] !== undefined) {
      modelParams[key] = (params as any)[key]
    }
  }
  return modelParams
}

/**
 * Helper to format responses (non-streaming) for consumption
 */
export const formatResponse = (response: any, provider: string): FormattedMessage[] => {
  if (!response) {
    return []
  }
  if (provider === 'anthropic') {
    return formatResponseAnthropic(response)
  } else if (provider === 'openai') {
    return formatResponseOpenAI(response)
  } else if (provider === 'gemini') {
    return formatResponseGemini(response)
  }
  return []
}

export const formatResponseAnthropic = (response: any): FormattedMessage[] => {
  const output: FormattedMessage[] = []
  const content: FormattedContent = []

  for (const choice of response.content ?? []) {
    if (choice?.type === 'text' && choice?.text) {
      content.push({ type: 'text', text: choice.text })
    } else if (choice?.type === 'tool_use' && choice?.name && choice?.id) {
      content.push({
        type: 'function',
        id: choice.id,
        function: {
          name: choice.name,
          arguments: choice.input || {},
        },
      })
    }
  }

  if (content.length > 0) {
    output.push({
      role: 'assistant',
      content,
    })
  }

  return output
}

export const formatResponseOpenAI = (response: any): FormattedMessage[] => {
  const output: FormattedMessage[] = []

  if (response.choices) {
    for (const choice of response.choices) {
      const content: FormattedContent = []
      let role = 'assistant'

      if (choice.message) {
        if (choice.message.role) {
          role = choice.message.role
        }

        if (choice.message.content) {
          content.push({ type: 'text', text: choice.message.content })
        }

        if (choice.message.tool_calls) {
          for (const toolCall of choice.message.tool_calls) {
            content.push({
              type: 'function',
              id: toolCall.id,
              function: {
                name: toolCall.function.name,
                arguments: toolCall.function.arguments,
              },
            })
          }
        }

        // Handle audio output (gpt-4o-audio-preview)
        if (choice.message.audio) {
          content.push({
            type: 'audio',
            ...choice.message.audio,
          })
        }
      }

      if (content.length > 0) {
        output.push({
          role,
          content,
        })
      }
    }
  }

  // Handle Responses API format
  if (response.output) {
    const content: FormattedContent = []
    let role = 'assistant'

    for (const item of response.output) {
      if (item.type === 'message') {
        role = item.role

        if (item.content && Array.isArray(item.content)) {
          for (const contentItem of item.content) {
            if (contentItem.type === 'output_text' && contentItem.text) {
              content.push({ type: 'text', text: contentItem.text })
            } else if (contentItem.text) {
              content.push({ type: 'text', text: contentItem.text })
            } else if (contentItem.type === 'input_image' && contentItem.image_url) {
              content.push({
                type: 'image',
                image: contentItem.image_url,
              })
            }
          }
        } else if (item.content) {
          content.push({ type: 'text', text: String(item.content) })
        }
      } else if (item.type === 'function_call') {
        content.push({
          type: 'function',
          id: item.call_id || item.id || '',
          function: {
            name: item.name,
            arguments: item.arguments || {},
          },
        })
      }
    }

    if (content.length > 0) {
      output.push({
        role,
        content,
      })
    }
  }

  return output
}

export const formatResponseGemini = (response: any): FormattedMessage[] => {
  const output: FormattedMessage[] = []

  if (response.candidates && Array.isArray(response.candidates)) {
    for (const candidate of response.candidates) {
      if (candidate.content && candidate.content.parts) {
        const content: FormattedContent = []

        for (const part of candidate.content.parts) {
          if (part.text) {
            content.push({ type: 'text', text: part.text })
          } else if (part.functionCall) {
            content.push({
              type: 'function',
              function: {
                name: part.functionCall.name,
                arguments: part.functionCall.args,
              },
            })
          } else if (part.inlineData) {
            // Handle audio/media inline data
            const mimeType = part.inlineData.mimeType || 'audio/pcm'
            let data = part.inlineData.data

            // Handle binary data (Buffer/Uint8Array -> base64)
            if (data instanceof Uint8Array || Buffer.isBuffer(data)) {
              data = Buffer.from(data).toString('base64')
            }

            content.push({
              type: 'audio',
              mime_type: mimeType,
              data: data,
            })
          }
        }

        if (content.length > 0) {
          output.push({
            role: 'assistant',
            content,
          })
        }
      } else if (candidate.text) {
        output.push({
          role: 'assistant',
          content: [{ type: 'text', text: candidate.text }],
        })
      }
    }
  } else if (response.text) {
    output.push({
      role: 'assistant',
      content: [{ type: 'text', text: response.text }],
    })
  }

  return output
}

export const mergeSystemPrompt = (params: MessageCreateParams & MonitoringParams, provider: string): any => {
  if (provider == 'anthropic') {
    const messages = params.messages || []
    if (!(params as any).system) {
      return messages
    }
    const systemMessage = (params as any).system
    return [{ role: 'system', content: systemMessage }, ...messages]
  }
  return params.messages
}

export const withPrivacyMode = (client: PostHog, privacyMode: boolean, input: any): any => {
  return (client as any).privacy_mode || privacyMode ? null : input
}

function toSafeString(input: unknown): string {
  if (input === undefined || input === null) {
    return ''
  }
  if (typeof input === 'string') {
    return input
  }
  try {
    return JSON.stringify(input)
  } catch {
    console.warn('Failed to stringify input', input)
    return ''
  }
}

export const truncate = (input: unknown): string => {
  const str = toSafeString(input)
  if (str === '') {
    return ''
  }

  // Check if we need to truncate and ensure STRING_FORMAT is respected
  const encoder = new TextEncoder()
  const buffer = encoder.encode(str)
  if (buffer.length <= MAX_OUTPUT_SIZE) {
    // Ensure STRING_FORMAT is respected
    return new TextDecoder(STRING_FORMAT).decode(buffer)
  }

  // Truncate the buffer and ensure a valid string is returned
  const truncatedBuffer = buffer.slice(0, MAX_OUTPUT_SIZE)
  // fatal: false means we get U+FFFD at the end if truncation broke the encoding
  const decoder = new TextDecoder(STRING_FORMAT, { fatal: false })
  let truncatedStr = decoder.decode(truncatedBuffer)
  if (truncatedStr.endsWith('\uFFFD')) {
    truncatedStr = truncatedStr.slice(0, -1)
  }
  return `${truncatedStr}... [truncated]`
}

/**
 * Calculate web search count from raw API response.
 *
 * Uses a two-tier detection strategy:
 * Priority 1 (Exact Count): Count actual web search calls when available
 * Priority 2 (Binary Detection): Return 1 if web search indicators are present, 0 otherwise
 *
 * @param result - Raw API response from any provider (OpenAI, Perplexity, OpenRouter, Gemini, etc.)
 * @returns Number of web searches performed (exact count or binary 1/0)
 */
export function calculateWebSearchCount(result: unknown): number {
  if (!result || typeof result !== 'object') {
    return 0
  }

  // Priority 1: Exact Count
  // Check for OpenAI Responses API web_search_call items
  if ('output' in result && Array.isArray(result.output)) {
    let count = 0

    for (const item of result.output) {
      if (typeof item === 'object' && item !== null && 'type' in item && item.type === 'web_search_call') {
        count++
      }
    }

    if (count > 0) {
      return count
    }
  }

  // Priority 2: Binary Detection (1 or 0)

  // Check for citations at root level (Perplexity)
  if ('citations' in result && Array.isArray(result.citations) && result.citations.length > 0) {
    return 1
  }

  // Check for search_results at root level (Perplexity via OpenRouter)
  if ('search_results' in result && Array.isArray(result.search_results) && result.search_results.length > 0) {
    return 1
  }

  // Check for usage.search_context_size (Perplexity via OpenRouter)
  if ('usage' in result && typeof result.usage === 'object' && result.usage !== null) {
    if ('search_context_size' in result.usage && result.usage.search_context_size) {
      return 1
    }
  }

  // Check for annotations with url_citation in choices[].message or choices[].delta (OpenAI/Perplexity)
  if ('choices' in result && Array.isArray(result.choices)) {
    for (const choice of result.choices) {
      if (typeof choice === 'object' && choice !== null) {
        // Check both message (non-streaming) and delta (streaming) for annotations
        const content = ('message' in choice ? choice.message : null) || ('delta' in choice ? choice.delta : null)

        if (typeof content === 'object' && content !== null && 'annotations' in content) {
          const annotations = content.annotations

          if (Array.isArray(annotations)) {
            const hasUrlCitation = annotations.some((ann: unknown) => {
              return typeof ann === 'object' && ann !== null && 'type' in ann && ann.type === 'url_citation'
            })

            if (hasUrlCitation) {
              return 1
            }
          }
        }
      }
    }
  }

  // Check for annotations in output[].content[] (OpenAI Responses API)
  if ('output' in result && Array.isArray(result.output)) {
    for (const item of result.output) {
      if (typeof item === 'object' && item !== null && 'content' in item) {
        const content = item.content

        if (Array.isArray(content)) {
          for (const contentItem of content) {
            if (typeof contentItem === 'object' && contentItem !== null && 'annotations' in contentItem) {
              const annotations = contentItem.annotations

              if (Array.isArray(annotations)) {
                const hasUrlCitation = annotations.some((ann: unknown) => {
                  return typeof ann === 'object' && ann !== null && 'type' in ann && ann.type === 'url_citation'
                })

                if (hasUrlCitation) {
                  return 1
                }
              }
            }
          }
        }
      }
    }
  }

  // Check for grounding_metadata (Gemini)
  if ('candidates' in result && Array.isArray(result.candidates)) {
    for (const candidate of result.candidates) {
      if (
        typeof candidate === 'object' &&
        candidate !== null &&
        'grounding_metadata' in candidate &&
        candidate.grounding_metadata
      ) {
        return 1
      }
    }
  }

  return 0
}

/**
 * Extract available tool calls from the request parameters.
 * These are the tools provided to the LLM, not the tool calls in the response.
 */
export const extractAvailableToolCalls = (
  provider: string,
  params: any
): ChatCompletionTool[] | AnthropicTool[] | GeminiTool[] | null => {
  if (provider === 'anthropic') {
    if (params.tools) {
      return params.tools
    }

    return null
  } else if (provider === 'gemini') {
    if (params.config && params.config.tools) {
      return params.config.tools
    }

    return null
  } else if (provider === 'openai') {
    if (params.tools) {
      return params.tools
    }

    return null
  } else if (provider === 'vercel') {
    if (params.tools) {
      return params.tools
    }

    return null
  }

  return null
}

export enum AIEvent {
  Generation = '$ai_generation',
  Embedding = '$ai_embedding',
}

export type SendEventToPosthogParams = {
  client: PostHog
  eventType?: AIEvent
  distinctId?: string
  traceId: string
  model?: string
  provider: string
  input: any
  output: any
  latency: number
  baseURL: string
  httpStatus: number
  usage?: TokenUsage
  params: (
    | ChatCompletionCreateParamsBase
    | MessageCreateParams
    | ResponseCreateParams
    | ResponseCreateParamsWithTools
    | EmbeddingCreateParams
    | TranscriptionCreateParams
  ) &
    MonitoringParams
  isError?: boolean
  error?: string
  tools?: ChatCompletionTool[] | AnthropicTool[] | GeminiTool[] | null
  captureImmediate?: boolean
}

function sanitizeValues(obj: any): any {
  if (obj === undefined || obj === null) {
    return obj
  }
  const jsonSafe = JSON.parse(JSON.stringify(obj))
  if (typeof jsonSafe === 'string') {
    return Buffer.from(jsonSafe, STRING_FORMAT).toString(STRING_FORMAT)
  } else if (Array.isArray(jsonSafe)) {
    return jsonSafe.map(sanitizeValues)
  } else if (jsonSafe && typeof jsonSafe === 'object') {
    return Object.fromEntries(Object.entries(jsonSafe).map(([k, v]) => [k, sanitizeValues(v)]))
  }
  return jsonSafe
}

const POSTHOG_PARAMS_MAP: Record<keyof MonitoringParams, string> = {
  posthogDistinctId: 'distinctId',
  posthogTraceId: 'traceId',
  posthogProperties: 'properties',
  posthogPrivacyMode: 'privacyMode',
  posthogGroups: 'groups',
  posthogModelOverride: 'modelOverride',
  posthogProviderOverride: 'providerOverride',
  posthogCostOverride: 'costOverride',
  posthogCaptureImmediate: 'captureImmediate',
}

export function extractPosthogParams<T>(body: T & MonitoringParams): {
  providerParams: T
  posthogParams: MonitoringEventPropertiesWithDefaults
} {
  const providerParams: Record<string, unknown> = {}
  const posthogParams: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(body)) {
    if (POSTHOG_PARAMS_MAP[key as keyof MonitoringParams]) {
      posthogParams[POSTHOG_PARAMS_MAP[key as keyof MonitoringParams]] = value
    } else if (key.startsWith('posthog')) {
      console.warn(`Unknown Posthog parameter ${key}`)
    } else {
      providerParams[key] = value
    }
  }

  return {
    providerParams: providerParams as T,
    posthogParams: addDefaults(posthogParams),
  }
}

function addDefaults(params: MonitoringEventProperties): MonitoringEventPropertiesWithDefaults {
  return {
    ...params,
    privacyMode: params.privacyMode ?? false,
    traceId: params.traceId ?? uuidv4(),
  }
}

export const sendEventToPosthog = async ({
  client,
  eventType = AIEvent.Generation,
  distinctId,
  traceId,
  model,
  provider,
  input,
  output,
  latency,
  baseURL,
  params,
  httpStatus = 200,
  usage = {},
  isError = false,
  error,
  tools,
  captureImmediate = false,
}: SendEventToPosthogParams): Promise<void> => {
  if (!client.capture) {
    return Promise.resolve()
  }
  // sanitize input and output for UTF-8 validity
  const safeInput = sanitizeValues(input)
  const safeOutput = sanitizeValues(output)
  const safeError = sanitizeValues(error)

  let errorData = {}
  if (isError) {
    errorData = {
      $ai_is_error: true,
      $ai_error: safeError,
    }
  }
  let costOverrideData = {}
  if (params.posthogCostOverride) {
    const inputCostUSD = (params.posthogCostOverride.inputCost ?? 0) * (usage.inputTokens ?? 0)
    const outputCostUSD = (params.posthogCostOverride.outputCost ?? 0) * (usage.outputTokens ?? 0)
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
  }

  const properties = {
    $ai_lib: 'posthog-ai',
    $ai_lib_version: version,
    $ai_provider: params.posthogProviderOverride ?? provider,
    $ai_model: params.posthogModelOverride ?? model,
    $ai_model_parameters: getModelParams(params),
    $ai_input: withPrivacyMode(client, params.posthogPrivacyMode ?? false, safeInput),
    $ai_output_choices: withPrivacyMode(client, params.posthogPrivacyMode ?? false, safeOutput),
    $ai_http_status: httpStatus,
    $ai_input_tokens: usage.inputTokens ?? 0,
    ...(usage.outputTokens !== undefined ? { $ai_output_tokens: usage.outputTokens } : {}),
    ...additionalTokenValues,
    $ai_latency: latency,
    $ai_trace_id: traceId,
    $ai_base_url: baseURL,
    ...params.posthogProperties,
    ...(distinctId ? {} : { $process_person_profile: false }),
    ...(tools ? { $ai_tools: tools } : {}),
    ...errorData,
    ...costOverrideData,
  }

  const event = {
    distinctId: distinctId ?? traceId,
    event: eventType,
    properties,
    groups: params.posthogGroups,
  }

  if (captureImmediate) {
    // await capture promise to send single event in serverless environments
    await client.captureImmediate(event)
  } else {
    client.capture(event)
  }
}

export function formatOpenAIResponsesInput(input: unknown, instructions?: string | null): FormattedMessage[] {
  const messages: FormattedMessage[] = []

  if (instructions) {
    messages.push({
      role: 'system',
      content: instructions,
    })
  }

  if (Array.isArray(input)) {
    for (const item of input) {
      if (typeof item === 'string') {
        messages.push({ role: 'user', content: item })
      } else if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>
        const role = isString(obj.role) ? obj.role : 'user'

        // Handle content properly - preserve structure for objects/arrays
        const content = obj.content ?? obj.text ?? item
        messages.push({ role, content: toContentString(content) })
      } else {
        messages.push({ role: 'user', content: toContentString(item) })
      }
    }
  } else if (typeof input === 'string') {
    messages.push({ role: 'user', content: input })
  } else if (input) {
    messages.push({ role: 'user', content: toContentString(input) })
  }

  return messages
}
