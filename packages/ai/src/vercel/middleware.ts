import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2Content,
  LanguageModelV2Prompt,
  LanguageModelV2StreamPart,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
} from '@ai-sdk/provider'
import { v4 as uuidv4 } from 'uuid'
import { PostHog } from 'posthog-node'
import {
  CostOverride,
  sendEventToPosthog,
  truncate,
  MAX_OUTPUT_SIZE,
  extractAvailableToolCalls,
  toContentString,
  calculateWebSearchCount,
  sendEventWithErrorToPosthog,
} from '../utils'
import { Buffer } from 'buffer'
import { redactBase64DataUrl } from '../sanitization'
import { isString } from '../typeGuards'

// Union types for dual version support
type LanguageModel = LanguageModelV2 | LanguageModelV3
type LanguageModelCallOptions = LanguageModelV2CallOptions | LanguageModelV3CallOptions
type LanguageModelPrompt = LanguageModelV2Prompt | LanguageModelV3Prompt
type LanguageModelContent = LanguageModelV2Content | LanguageModelV3Content
type LanguageModelStreamPart = LanguageModelV2StreamPart | LanguageModelV3StreamPart

// Type guards
function isV3Model(model: LanguageModel): model is LanguageModelV3 {
  return model.specificationVersion === 'v3'
}

function isV2Model(model: LanguageModel): model is LanguageModelV2 {
  return model.specificationVersion === 'v2'
}

interface ClientOptions {
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

interface PostHogInput {
  role: string
  type?: string
  content?:
    | string
    | {
        [key: string]: any
      }
}

// Content types for the output array
type OutputContentItem =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; id: string; function: { name: string; arguments: string } }
  | { type: 'file'; name: string; mediaType: string; data: string }
  | { type: 'source'; sourceType: string; id: string; url: string; title: string }

const mapVercelParams = (params: any): Record<string, any> => {
  return {
    temperature: params.temperature,
    max_output_tokens: params.maxOutputTokens,
    top_p: params.topP,
    frequency_penalty: params.frequencyPenalty,
    presence_penalty: params.presencePenalty,
    stop: params.stopSequences,
    stream: params.stream,
  }
}

const mapVercelPrompt = (messages: LanguageModelPrompt): PostHogInput[] => {
  // Map and truncate individual content
  const inputs: PostHogInput[] = messages.map((message) => {
    let content: any

    // Handle system role which has string content
    if (message.role === 'system') {
      content = [
        {
          type: 'text',
          text: truncate(toContentString(message.content)),
        },
      ]
    } else {
      // Handle other roles which have array content
      if (Array.isArray(message.content)) {
        content = message.content.map((c: any) => {
          if (c.type === 'text') {
            return {
              type: 'text',
              text: truncate(c.text),
            }
          } else if (c.type === 'file') {
            // For file type, check if it's a data URL and redact if needed
            let fileData: string

            const contentData: unknown = c.data

            if (contentData instanceof URL) {
              fileData = contentData.toString()
            } else if (isString(contentData)) {
              // Redact base64 data URLs and raw base64 to prevent oversized events
              fileData = redactBase64DataUrl(contentData)
            } else {
              fileData = 'raw files not supported'
            }

            return {
              type: 'file',
              file: fileData,
              mediaType: c.mediaType,
            }
          } else if (c.type === 'reasoning') {
            return {
              type: 'reasoning',
              text: truncate(c.reasoning),
            }
          } else if (c.type === 'tool-call') {
            return {
              type: 'tool-call',
              toolCallId: c.toolCallId,
              toolName: c.toolName,
              input: c.input,
            }
          } else if (c.type === 'tool-result') {
            return {
              type: 'tool-result',
              toolCallId: c.toolCallId,
              toolName: c.toolName,
              output: c.output,
              isError: c.isError,
            }
          }
          return {
            type: 'text',
            text: '',
          }
        })
      } else {
        // Fallback for non-array content
        content = [
          {
            type: 'text',
            text: truncate(toContentString(message.content)),
          },
        ]
      }
    }

    return {
      role: message.role,
      content,
    }
  })

  try {
    // Trim the inputs array until its JSON size fits within MAX_OUTPUT_SIZE
    let serialized = JSON.stringify(inputs)
    let removedCount = 0
    // We need to keep track of the initial size of the inputs array because we're going to be mutating it
    const initialSize = inputs.length
    for (let i = 0; i < initialSize && Buffer.byteLength(serialized, 'utf8') > MAX_OUTPUT_SIZE; i++) {
      inputs.shift()
      removedCount++
      serialized = JSON.stringify(inputs)
    }
    if (removedCount > 0) {
      // Add one placeholder to indicate how many were removed
      inputs.unshift({
        role: 'posthog',
        content: `[${removedCount} message${removedCount === 1 ? '' : 's'} removed due to size limit]`,
      })
    }
  } catch (error) {
    console.error('Error stringifying inputs', error)
    return [{ role: 'posthog', content: 'An error occurred while processing your request. Please try again.' }]
  }
  return inputs
}

const mapVercelOutput = (result: LanguageModelContent[]): PostHogInput[] => {
  const content: OutputContentItem[] = result.map((item) => {
    if (item.type === 'text') {
      return { type: 'text', text: truncate(item.text) }
    }
    if (item.type === 'tool-call') {
      return {
        type: 'tool-call',
        id: item.toolCallId,
        function: {
          name: item.toolName,
          arguments: (item as any).args || JSON.stringify((item as any).arguments || {}),
        },
      }
    }
    if (item.type === 'reasoning') {
      return { type: 'reasoning', text: truncate(item.text) }
    }
    if (item.type === 'file') {
      // Handle files similar to input mapping - avoid large base64 data
      let fileData: string
      if (item.data instanceof URL) {
        fileData = item.data.toString()
      } else if (typeof item.data === 'string') {
        fileData = redactBase64DataUrl(item.data)

        // If not redacted and still large, replace with size indicator
        if (fileData === item.data && item.data.length > 1000) {
          fileData = `[${item.mediaType} file - ${item.data.length} bytes]`
        }
      } else {
        fileData = `[binary ${item.mediaType} file]`
      }

      return {
        type: 'file',
        name: 'generated_file',
        mediaType: item.mediaType,
        data: fileData,
      }
    }
    if (item.type === 'source') {
      return {
        type: 'source',
        sourceType: item.sourceType,
        id: item.id,
        url: (item as any).url || '',
        title: item.title || '',
      }
    }
    // Fallback for unknown types - try to extract text if possible
    return { type: 'text', text: truncate(JSON.stringify(item)) }
  })

  if (content.length > 0) {
    return [
      {
        role: 'assistant',
        content: content.length === 1 && content[0].type === 'text' ? content[0].text : content,
      },
    ]
  }
  // otherwise stringify and truncate
  try {
    const jsonOutput = JSON.stringify(result)
    return [{ content: truncate(jsonOutput), role: 'assistant' }]
  } catch {
    console.error('Error stringifying output')
    return []
  }
}

const extractProvider = (model: LanguageModel): string => {
  const provider = model.provider.toLowerCase()
  const providerName = provider.split('.')[0]
  return providerName
}

// Extract web search count from provider metadata (works for both V2 and V3)
const extractWebSearchCount = (providerMetadata: unknown, usage: any): number => {
  // Try Anthropic-specific extraction
  if (
    providerMetadata &&
    typeof providerMetadata === 'object' &&
    'anthropic' in providerMetadata &&
    providerMetadata.anthropic &&
    typeof providerMetadata.anthropic === 'object' &&
    'server_tool_use' in providerMetadata.anthropic
  ) {
    const serverToolUse = providerMetadata.anthropic.server_tool_use
    if (
      serverToolUse &&
      typeof serverToolUse === 'object' &&
      'web_search_requests' in serverToolUse &&
      typeof serverToolUse.web_search_requests === 'number'
    ) {
      return serverToolUse.web_search_requests
    }
  }

  // Fall back to generic calculation
  return calculateWebSearchCount({
    usage,
    providerMetadata,
  })
}

// Extract additional token values from provider metadata
const extractAdditionalTokenValues = (providerMetadata: unknown): Record<string, any> => {
  if (
    providerMetadata &&
    typeof providerMetadata === 'object' &&
    'anthropic' in providerMetadata &&
    providerMetadata.anthropic &&
    typeof providerMetadata.anthropic === 'object' &&
    'cacheCreationInputTokens' in providerMetadata.anthropic
  ) {
    return {
      cacheCreationInputTokens: providerMetadata.anthropic.cacheCreationInputTokens,
    }
  }
  return {}
}

// For Anthropic providers in V3, inputTokens.total is the sum of all tokens (uncached + cache read + cache write).
// Our cost calculation expects inputTokens to be only the uncached portion for Anthropic.
// This helper subtracts cache tokens from inputTokens for Anthropic V3 models.
const adjustAnthropicV3CacheTokens = (
  model: LanguageModel,
  provider: string,
  usage: { inputTokens?: number; cacheReadInputTokens?: unknown; cacheCreationInputTokens?: unknown }
): void => {
  if (isV3Model(model) && provider.toLowerCase().includes('anthropic')) {
    const cacheReadTokens = (usage.cacheReadInputTokens as number) || 0
    const cacheWriteTokens = (usage.cacheCreationInputTokens as number) || 0
    const cacheTokens = cacheReadTokens + cacheWriteTokens
    if (usage.inputTokens && cacheTokens > 0) {
      usage.inputTokens = Math.max(usage.inputTokens - cacheTokens, 0)
    }
  }
}

// Helper to extract numeric token value from V2 (number) or V3 (object with .total) usage formats
const extractTokenCount = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return value
  }
  if (
    value &&
    typeof value === 'object' &&
    'total' in value &&
    typeof (value as { total: unknown }).total === 'number'
  ) {
    return (value as { total: number }).total
  }
  return undefined
}

// Helper to extract reasoning tokens from V2 (usage.reasoningTokens) or V3 (usage.outputTokens.reasoning)
const extractReasoningTokens = (usage: Record<string, unknown>): unknown => {
  // V2 style: top-level reasoningTokens
  if ('reasoningTokens' in usage) {
    return usage.reasoningTokens
  }
  // V3 style: nested in outputTokens.reasoning
  if (
    'outputTokens' in usage &&
    usage.outputTokens &&
    typeof usage.outputTokens === 'object' &&
    'reasoning' in usage.outputTokens
  ) {
    return (usage.outputTokens as { reasoning: unknown }).reasoning
  }
  return undefined
}

// Helper to extract cached input tokens from V2 (usage.cachedInputTokens) or V3 (usage.inputTokens.cacheRead)
const extractCacheReadTokens = (usage: Record<string, unknown>): unknown => {
  // V2 style: top-level cachedInputTokens
  if ('cachedInputTokens' in usage) {
    return usage.cachedInputTokens
  }
  // V3 style: nested in inputTokens.cacheRead
  if (
    'inputTokens' in usage &&
    usage.inputTokens &&
    typeof usage.inputTokens === 'object' &&
    'cacheRead' in usage.inputTokens
  ) {
    return (usage.inputTokens as { cacheRead: unknown }).cacheRead
  }
  return undefined
}

/**
 * Wraps a Vercel AI SDK language model (V2 or V3) with PostHog tracing.
 * Automatically detects the model version and applies appropriate instrumentation.
 */
export const wrapVercelLanguageModel = <T extends LanguageModel>(
  model: T,
  phClient: PostHog,
  options: ClientOptions
): T => {
  const traceId = options.posthogTraceId ?? uuidv4()
  const mergedOptions = {
    ...options,
    posthogTraceId: traceId,
    posthogDistinctId: options.posthogDistinctId,
    posthogProperties: {
      ...options.posthogProperties,
      $ai_framework: 'vercel',
      $ai_framework_version: model.specificationVersion === 'v3' ? '6' : '5',
    },
  }

  // Create wrapped model using Object.create to preserve the prototype chain
  // This automatically inherits all properties (including getters) from the model
  const wrappedModel = Object.create(model, {
    doGenerate: {
      value: async (params: LanguageModelCallOptions) => {
        const startTime = Date.now()
        const mergedParams = {
          ...mergedOptions,
          ...mapVercelParams(params),
        }
        const availableTools = extractAvailableToolCalls('vercel', params)

        try {
          const result = await model.doGenerate(params as any)
          const modelId =
            mergedOptions.posthogModelOverride ?? (result.response?.modelId ? result.response.modelId : model.modelId)
          const provider = mergedOptions.posthogProviderOverride ?? extractProvider(model)
          const baseURL = '' // cannot currently get baseURL from vercel
          const content = mapVercelOutput(result.content as LanguageModelContent[])
          const latency = (Date.now() - startTime) / 1000
          const providerMetadata = result.providerMetadata
          const additionalTokenValues = extractAdditionalTokenValues(providerMetadata)

          const webSearchCount = extractWebSearchCount(providerMetadata, result.usage)

          // V2 usage has simple numbers, V3 has objects with .total - normalize both
          const usageObj = result.usage as Record<string, unknown>
          const usage = {
            inputTokens: extractTokenCount(result.usage.inputTokens),
            outputTokens: extractTokenCount(result.usage.outputTokens),
            reasoningTokens: extractReasoningTokens(usageObj),
            cacheReadInputTokens: extractCacheReadTokens(usageObj),
            webSearchCount,
            ...additionalTokenValues,
          }

          adjustAnthropicV3CacheTokens(model, provider, usage)

          await sendEventToPosthog({
            client: phClient,
            distinctId: mergedOptions.posthogDistinctId,
            traceId: mergedOptions.posthogTraceId ?? uuidv4(),
            model: modelId,
            provider: provider,
            input: mergedOptions.posthogPrivacyMode ? '' : mapVercelPrompt(params.prompt as LanguageModelPrompt),
            output: content,
            latency,
            baseURL,
            params: mergedParams as any,
            httpStatus: 200,
            usage,
            tools: availableTools,
            captureImmediate: mergedOptions.posthogCaptureImmediate,
          })

          return result
        } catch (error: unknown) {
          const modelId = model.modelId
          const enrichedError = await sendEventWithErrorToPosthog({
            client: phClient,
            distinctId: mergedOptions.posthogDistinctId,
            traceId: mergedOptions.posthogTraceId ?? uuidv4(),
            model: modelId,
            provider: model.provider,
            input: mergedOptions.posthogPrivacyMode ? '' : mapVercelPrompt(params.prompt as LanguageModelPrompt),
            output: [],
            latency: 0,
            baseURL: '',
            params: mergedParams as any,
            usage: {
              inputTokens: 0,
              outputTokens: 0,
            },
            error: error,
            tools: availableTools,
            captureImmediate: mergedOptions.posthogCaptureImmediate,
          })
          throw enrichedError
        }
      },
      writable: true,
      configurable: true,
      enumerable: false,
    },
    doStream: {
      value: async (params: LanguageModelCallOptions) => {
        const startTime = Date.now()
        let firstTokenTime: number | undefined
        let generatedText = ''
        let reasoningText = ''
        let usage: {
          inputTokens?: number
          outputTokens?: number
          reasoningTokens?: any
          cacheReadInputTokens?: any
          cacheCreationInputTokens?: any
        } = {}
        let providerMetadata: unknown = undefined
        const mergedParams = {
          ...mergedOptions,
          ...mapVercelParams(params),
        }

        const modelId = mergedOptions.posthogModelOverride ?? model.modelId
        const provider = mergedOptions.posthogProviderOverride ?? extractProvider(model)
        const availableTools = extractAvailableToolCalls('vercel', params)
        const baseURL = '' // cannot currently get baseURL from vercel

        // Map to track in-progress tool calls
        const toolCallsInProgress = new Map<
          string,
          {
            toolCallId: string
            toolName: string
            input: string
          }
        >()

        try {
          const { stream, ...rest } = await model.doStream(params as any)
          const transformStream = new TransformStream<LanguageModelStreamPart, LanguageModelStreamPart>({
            transform(chunk, controller) {
              // Handle streaming patterns - compatible with both V2 and V3
              if (chunk.type === 'text-delta') {
                if (firstTokenTime === undefined) {
                  firstTokenTime = Date.now()
                }
                generatedText += chunk.delta
              }
              if (chunk.type === 'reasoning-delta') {
                if (firstTokenTime === undefined) {
                  firstTokenTime = Date.now()
                }
                reasoningText += chunk.delta
              }

              // Handle tool call chunks
              if (chunk.type === 'tool-input-start') {
                // Initialize a new tool call
                toolCallsInProgress.set(chunk.id, {
                  toolCallId: chunk.id,
                  toolName: chunk.toolName,
                  input: '',
                })
              }
              if (chunk.type === 'tool-input-delta') {
                // Accumulate tool call arguments
                const toolCall = toolCallsInProgress.get(chunk.id)
                if (toolCall) {
                  toolCall.input += chunk.delta
                }
              }
              if (chunk.type === 'tool-input-end') {
                // Tool call is complete, keep it in the map for final processing
              }
              if (chunk.type === 'tool-call') {
                // Direct tool call chunk (complete tool call)
                toolCallsInProgress.set(chunk.toolCallId, {
                  toolCallId: chunk.toolCallId,
                  toolName: chunk.toolName,
                  input: chunk.input,
                })
              }

              if (chunk.type === 'finish') {
                providerMetadata = chunk.providerMetadata
                const additionalTokenValues = extractAdditionalTokenValues(providerMetadata)
                const chunkUsage = (chunk.usage as Record<string, unknown>) || {}
                usage = {
                  inputTokens: extractTokenCount(chunk.usage?.inputTokens),
                  outputTokens: extractTokenCount(chunk.usage?.outputTokens),
                  reasoningTokens: extractReasoningTokens(chunkUsage),
                  cacheReadInputTokens: extractCacheReadTokens(chunkUsage),
                  ...additionalTokenValues,
                }
              }
              controller.enqueue(chunk)
            },

            flush: async () => {
              const latency = (Date.now() - startTime) / 1000
              const timeToFirstToken =
                firstTokenTime !== undefined ? (firstTokenTime - startTime) / 1000 : undefined
              // Build content array similar to mapVercelOutput structure
              const content: OutputContentItem[] = []
              if (reasoningText) {
                content.push({ type: 'reasoning', text: truncate(reasoningText) })
              }
              if (generatedText) {
                content.push({ type: 'text', text: truncate(generatedText) })
              }

              // Add completed tool calls to content
              for (const toolCall of toolCallsInProgress.values()) {
                if (toolCall.toolName) {
                  content.push({
                    type: 'tool-call',
                    id: toolCall.toolCallId,
                    function: {
                      name: toolCall.toolName,
                      arguments: toolCall.input,
                    },
                  })
                }
              }

              // Structure output like mapVercelOutput does
              const output =
                content.length > 0
                  ? [
                      {
                        role: 'assistant',
                        content: content.length === 1 && content[0].type === 'text' ? content[0].text : content,
                      },
                    ]
                  : []

              const webSearchCount = extractWebSearchCount(providerMetadata, usage)

              // Update usage with web search count
              const finalUsage = {
                ...usage,
                webSearchCount,
              }

              adjustAnthropicV3CacheTokens(model, provider, finalUsage)

              await sendEventToPosthog({
                client: phClient,
                distinctId: mergedOptions.posthogDistinctId,
                traceId: mergedOptions.posthogTraceId ?? uuidv4(),
                model: modelId,
                provider: provider,
                input: mergedOptions.posthogPrivacyMode ? '' : mapVercelPrompt(params.prompt as LanguageModelPrompt),
                output: output,
                latency,
                timeToFirstToken,
                baseURL,
                params: mergedParams as any,
                httpStatus: 200,
                usage: finalUsage,
                tools: availableTools,
                captureImmediate: mergedOptions.posthogCaptureImmediate,
              })
            },
          })

          return {
            stream: stream.pipeThrough(transformStream),
            ...rest,
          }
        } catch (error: unknown) {
          const enrichedError = await sendEventWithErrorToPosthog({
            client: phClient,
            distinctId: mergedOptions.posthogDistinctId,
            traceId: mergedOptions.posthogTraceId ?? uuidv4(),
            model: modelId,
            provider: provider,
            input: mergedOptions.posthogPrivacyMode ? '' : mapVercelPrompt(params.prompt as LanguageModelPrompt),
            output: [],
            latency: 0,
            baseURL: '',
            params: mergedParams as any,
            usage: {
              inputTokens: 0,
              outputTokens: 0,
            },
            error: error,
            tools: availableTools,
            captureImmediate: mergedOptions.posthogCaptureImmediate,
          })
          throw enrichedError
        }
      },
      writable: true,
      configurable: true,
      enumerable: false,
    },
  }) as T

  return wrappedModel
}

// Export type guards for external use
export { isV2Model, isV3Model }
export type { LanguageModel, ClientOptions }
