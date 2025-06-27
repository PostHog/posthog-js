import { PostHog } from 'posthog-node'
import { Buffer } from 'buffer'
import OpenAIOrignal from 'openai'
import AnthropicOriginal from '@anthropic-ai/sdk'

type ChatCompletionCreateParamsBase = OpenAIOrignal.Chat.Completions.ChatCompletionCreateParams
type MessageCreateParams = AnthropicOriginal.Messages.MessageCreateParams
type ResponseCreateParams = OpenAIOrignal.Responses.ResponseCreateParams

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
  params: ((ChatCompletionCreateParamsBase | MessageCreateParams | ResponseCreateParams) & MonitoringParams) | null
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
export const formatResponse = (response: any, provider: string): Array<{ role: string; content: string }> => {
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

export const formatResponseAnthropic = (response: any): Array<{ role: string; content: string }> => {
  // Example approach if "response.content" holds array of text segments, etc.
  const output: Array<{ role: string; content: string }> = []
  for (const choice of response.content ?? []) {
    if (choice?.text) {
      output.push({
        role: 'assistant',
        content: choice.text,
      })
    }
  }
  return output
}

export const formatResponseOpenAI = (response: any): Array<{ role: string; content: string }> => {
  const output: Array<{ role: string; content: string }> = []
  for (const choice of response.choices ?? []) {
    if (choice.message?.content) {
      output.push({
        role: choice.message.role,
        content: choice.message.content,
      })
    }
  }
  return output
}

export const formatResponseGemini = (response: any): Array<{ role: string; content: string }> => {
  const output: Array<{ role: string; content: string }> = []

  if (response.text) {
    output.push({
      role: 'assistant',
      content: response.text,
    })
    return output
  }

  if (response.candidates && Array.isArray(response.candidates)) {
    for (const candidate of response.candidates) {
      if (candidate.content && candidate.content.parts) {
        const text = candidate.content.parts
          .filter((part: any) => part.text)
          .map((part: any) => part.text)
          .join('')
        if (text) {
          output.push({
            role: 'assistant',
            content: text,
          })
        }
      }
    }
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
  } catch (error) {
    console.error('Error truncating, likely not a string')
    return str
  }
}

export type SendEventToPosthogParams = {
  client: PostHog
  distinctId?: string
  traceId: string
  model: string
  provider: string
  input: any
  output: any
  latency: number
  baseURL: string
  httpStatus: number
  usage?: {
    inputTokens?: number
    outputTokens?: number
    reasoningTokens?: any
    cacheReadInputTokens?: any
    cacheCreationInputTokens?: any
  }
  params: (ChatCompletionCreateParamsBase | MessageCreateParams | ResponseCreateParams) & MonitoringParams
  isError?: boolean
  error?: string
  tools?: any
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
    $ai_provider: params.posthogProviderOverride ?? provider,
    $ai_model: params.posthogModelOverride ?? model,
    $ai_model_parameters: getModelParams(params),
    $ai_input: withPrivacyMode(client, params.posthogPrivacyMode ?? false, safeInput),
    $ai_output_choices: withPrivacyMode(client, params.posthogPrivacyMode ?? false, safeOutput),
    $ai_http_status: httpStatus,
    $ai_input_tokens: usage.inputTokens ?? 0,
    $ai_output_tokens: usage.outputTokens ?? 0,
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
    event: '$ai_generation',
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
