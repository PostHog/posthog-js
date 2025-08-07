import { wrapLanguageModel } from 'ai'
import type {
  LanguageModelV2,
  LanguageModelV2Content,
  LanguageModelV2Middleware,
  LanguageModelV2Prompt,
  LanguageModelV2StreamPart,
} from '@ai-sdk/provider'
import { v4 as uuidv4 } from 'uuid'
import { PostHog } from 'posthog-node'
import { CostOverride, sendEventToPosthog, truncate, MAX_OUTPUT_SIZE, extractAvailableToolCalls } from '../utils'
import { Buffer } from 'buffer'

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

interface CreateInstrumentationMiddlewareOptions {
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

const mapVercelPrompt = (messages: LanguageModelV2Prompt): PostHogInput[] => {
  // Map and truncate individual content
  const inputs: PostHogInput[] = messages.map((message) => {
    let content: any

    // Handle system role which has string content
    if (message.role === 'system') {
      content = [
        {
          type: 'text',
          text: truncate(String(message.content)),
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
            return {
              type: 'file',
              file: c.data instanceof URL ? c.data.toString() : 'raw files not supported',
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
            text: truncate(String(message.content)),
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

const mapVercelOutput = (result: LanguageModelV2Content[]): PostHogInput[] => {
  const content: any[] = result.map((item) => {
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
        // Check if it's base64 data and potentially large
        if (item.data.startsWith('data:') || item.data.length > 1000) {
          fileData = `[${item.mediaType} file - ${item.data.length} bytes]`
        } else {
          fileData = item.data
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
  } catch (error) {
    console.error('Error stringifying output')
    return []
  }
}

const extractProvider = (model: LanguageModelV2): string => {
  const provider = model.provider.toLowerCase()
  const providerName = provider.split('.')[0]
  return providerName
}

export const createInstrumentationMiddleware = (
  phClient: PostHog,
  model: LanguageModelV2,
  options: CreateInstrumentationMiddlewareOptions
): LanguageModelV2Middleware => {
  const middleware: LanguageModelV2Middleware = {
    wrapGenerate: async ({ doGenerate, params }) => {
      const startTime = Date.now()
      const mergedParams = {
        ...options,
        ...mapVercelParams(params),
      }
      const availableTools = extractAvailableToolCalls('vercel', params)

      try {
        const result = await doGenerate()
        const modelId =
          options.posthogModelOverride ?? (result.response?.modelId ? result.response.modelId : model.modelId)
        const provider = options.posthogProviderOverride ?? extractProvider(model)
        const baseURL = '' // cannot currently get baseURL from vercel
        const content = mapVercelOutput(result.content)
        const latency = (Date.now() - startTime) / 1000
        const providerMetadata = result.providerMetadata
        const additionalTokenValues = {
          ...(providerMetadata?.openai?.reasoningTokens
            ? { reasoningTokens: providerMetadata.openai.reasoningTokens }
            : {}),
          ...(providerMetadata?.openai?.cachedPromptTokens
            ? { cacheReadInputTokens: providerMetadata.openai.cachedPromptTokens }
            : {}),
          ...(providerMetadata?.anthropic
            ? {
                cacheReadInputTokens: providerMetadata.anthropic.cacheReadInputTokens,
                cacheCreationInputTokens: providerMetadata.anthropic.cacheCreationInputTokens,
              }
            : {}),
        }
        await sendEventToPosthog({
          client: phClient,
          distinctId: options.posthogDistinctId,
          traceId: options.posthogTraceId ?? uuidv4(),
          model: modelId,
          provider: provider,
          input: options.posthogPrivacyMode ? '' : mapVercelPrompt(params.prompt),
          output: content,
          latency,
          baseURL,
          params: mergedParams as any,
          httpStatus: 200,
          usage: {
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            ...additionalTokenValues,
          },
          tools: availableTools,
          captureImmediate: options.posthogCaptureImmediate,
        })

        return result
      } catch (error: any) {
        const modelId = model.modelId
        await sendEventToPosthog({
          client: phClient,
          distinctId: options.posthogDistinctId,
          traceId: options.posthogTraceId ?? uuidv4(),
          model: modelId,
          provider: model.provider,
          input: options.posthogPrivacyMode ? '' : mapVercelPrompt(params.prompt),
          output: [],
          latency: 0,
          baseURL: '',
          params: mergedParams as any,
          httpStatus: error?.status ? error.status : 500,
          usage: {
            inputTokens: 0,
            outputTokens: 0,
          },
          isError: true,
          error: truncate(JSON.stringify(error)),
          tools: availableTools,
          captureImmediate: options.posthogCaptureImmediate,
        })
        throw error
      }
    },

    wrapStream: async ({ doStream, params }) => {
      const startTime = Date.now()
      let generatedText = ''
      let reasoningText = ''
      let usage: {
        inputTokens?: number
        outputTokens?: number
        reasoningTokens?: any
        cacheReadInputTokens?: any
        cacheCreationInputTokens?: any
      } = {}
      const mergedParams = {
        ...options,
        ...mapVercelParams(params),
      }

      const modelId = options.posthogModelOverride ?? model.modelId
      const provider = options.posthogProviderOverride ?? extractProvider(model)
      const availableTools = extractAvailableToolCalls('vercel', params)
      const baseURL = '' // cannot currently get baseURL from vercel

      try {
        const { stream, ...rest } = await doStream()
        const transformStream = new TransformStream<LanguageModelV2StreamPart, LanguageModelV2StreamPart>({
          transform(chunk, controller) {
            // Handle new v5 streaming patterns
            if (chunk.type === 'text-delta') {
              generatedText += chunk.delta
            }
            if (chunk.type === 'reasoning-delta') {
              reasoningText += chunk.delta // New in v5
            }
            if (chunk.type === 'finish') {
              usage = {
                inputTokens: chunk.usage?.inputTokens,
                outputTokens: chunk.usage?.outputTokens,
              }
              if (chunk.providerMetadata?.openai?.reasoningTokens) {
                usage.reasoningTokens = chunk.providerMetadata.openai.reasoningTokens
              }
              if (chunk.providerMetadata?.openai?.cachedPromptTokens) {
                usage.cacheReadInputTokens = chunk.providerMetadata.openai.cachedPromptTokens
              }
              if (chunk.providerMetadata?.anthropic?.cacheReadInputTokens) {
                usage.cacheReadInputTokens = chunk.providerMetadata.anthropic.cacheReadInputTokens
              }
              if (chunk.providerMetadata?.anthropic?.cacheCreationInputTokens) {
                usage.cacheCreationInputTokens = chunk.providerMetadata.anthropic.cacheCreationInputTokens
              }
            }
            controller.enqueue(chunk)
          },

          flush: async () => {
            const latency = (Date.now() - startTime) / 1000
            const outputContent = reasoningText ? `${reasoningText}\n\n${generatedText}` : generatedText
            await sendEventToPosthog({
              client: phClient,
              distinctId: options.posthogDistinctId,
              traceId: options.posthogTraceId ?? uuidv4(),
              model: modelId,
              provider: provider,
              input: options.posthogPrivacyMode ? '' : mapVercelPrompt(params.prompt),
              output: [{ content: outputContent, role: 'assistant' }],
              latency,
              baseURL,
              params: mergedParams as any,
              httpStatus: 200,
              usage,
              tools: availableTools,
              captureImmediate: options.posthogCaptureImmediate,
            })
          },
        })

        return {
          stream: stream.pipeThrough(transformStream),
          ...rest,
        }
      } catch (error: any) {
        await sendEventToPosthog({
          client: phClient,
          distinctId: options.posthogDistinctId,
          traceId: options.posthogTraceId ?? uuidv4(),
          model: modelId,
          provider: provider,
          input: options.posthogPrivacyMode ? '' : mapVercelPrompt(params.prompt),
          output: [],
          latency: 0,
          baseURL: '',
          params: mergedParams as any,
          httpStatus: error?.status ? error.status : 500,
          usage: {
            inputTokens: 0,
            outputTokens: 0,
          },
          isError: true,
          error: truncate(JSON.stringify(error)),
          tools: availableTools,
          captureImmediate: options.posthogCaptureImmediate,
        })
        throw error
      }
    },
  }

  return middleware
}

export const wrapVercelLanguageModel = (
  model: LanguageModelV2,
  phClient: PostHog,
  options: ClientOptions
): LanguageModelV2 => {
  const traceId = options.posthogTraceId ?? uuidv4()
  const middleware = createInstrumentationMiddleware(phClient, model, {
    ...options,
    posthogTraceId: traceId,
    posthogDistinctId: options.posthogDistinctId,
  })

  const wrappedModel = wrapLanguageModel({
    model,
    middleware,
  })

  return wrappedModel
}
