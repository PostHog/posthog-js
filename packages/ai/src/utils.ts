import { PostHog } from 'posthog-node'
import { Buffer } from 'buffer'
import OpenAIOrignal from 'openai'
import AnthropicOriginal from '@anthropic-ai/sdk'
import type { ChatCompletionTool } from 'openai/resources/chat/completions'
import type { Tool as GeminiTool } from '@google/genai'
import type { FormattedMessage, FormattedContent, TokenUsage } from './types'
import { version } from '../package.json'

type ChatCompletionCreateParamsBase = OpenAIOrignal.Chat.Completions.ChatCompletionCreateParams
type MessageCreateParams = AnthropicOriginal.Messages.MessageCreateParams
type ResponseCreateParams = OpenAIOrignal.Responses.ResponseCreateParams
type EmbeddingCreateParams = OpenAIOrignal.EmbeddingCreateParams
type AnthropicTool = AnthropicOriginal.Tool

// limit large outputs by truncating to 200kb (approx 200k bytes)
export const MAX_OUTPUT_SIZE = 200000
const STRING_FORMAT = 'utf8'

export interface MonitoringParams {
  posthogDistinctId?: string
  posthogTraceId?: string
  posthogProperties?: Record<string, any>
  posthogPrivacyMode?: boolean
  posthogGroups?: Record<string, any>
  posthogModelOverride?: string
  posthogProviderOverride?: string
  posthogCostOverride?: CostOverride
  posthogCaptureImmediate?: boolean
}

export interface CostOverride {
  inputCost: number
  outputCost: number
}

export const getModelParams = (
  params:
    | ((ChatCompletionCreateParamsBase | MessageCreateParams | ResponseCreateParams | EmbeddingCreateParams) &
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
  ] as const

  for (const key of paramKeys) {
    if (key in params && (params as any)[key] !== undefined) {
      modelParams[key] = (params as any)[key]
    }
  }
  return modelParams
}

/**
 * Helper to format responses (non-streaming) for consumption, mirroring Python's openai vs. anthropic approach.
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

export const truncate = (str: string): string => {
  try {
    const buffer = Buffer.from(str, STRING_FORMAT)
    if (buffer.length <= MAX_OUTPUT_SIZE) {
      return str
    }
    const truncatedBuffer = buffer.slice(0, MAX_OUTPUT_SIZE)
    return `${truncatedBuffer.toString(STRING_FORMAT)}... [truncated]`
  } catch {
    console.error('Error truncating, likely not a string')
    return str
  }
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
  model: string
  provider: string
  input: any
  output: any
  latency: number
  baseURL: string
  httpStatus: number
  usage?: TokenUsage
  params: (ChatCompletionCreateParamsBase | MessageCreateParams | ResponseCreateParams | EmbeddingCreateParams) &
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
