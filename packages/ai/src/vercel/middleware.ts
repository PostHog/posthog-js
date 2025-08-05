import { wrapLanguageModel } from 'ai'
import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2Middleware,
  LanguageModelV2Prompt,
  LanguageModelV2StreamPart,
} from '@ai-sdk/provider'
import { v4 as uuidv4 } from 'uuid'
import { PostHog } from 'posthog-node'
import { CostOverride, sendEventToPosthog, truncate, MAX_OUTPUT_SIZE } from '../utils'
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

const mapVercelParams = (params: LanguageModelV2CallOptions, stream: boolean): Record<string, any> => {
  return {
    temperature: params.temperature,
    max_tokens: params.maxOutputTokens,
    top_p: params.topP,
    frequency_penalty: params.frequencyPenalty,
    presence_penalty: params.presencePenalty,
    stop: params.stopSequences,
    stream,
  }
}

const mapVercelPrompt = (prompt: LanguageModelV2Prompt): PostHogInput[] => {
  // normalize single inputs into an array of messages
  let promptsArray: LanguageModelV2Prompt
  if (typeof prompt === 'string') {
    promptsArray = [{ role: 'user', content: prompt }]
  } else if (!Array.isArray(prompt)) {
    promptsArray = [prompt]
  } else {
    promptsArray = prompt
  }

  // Map and truncate individual content
  const inputs: PostHogInput[] = promptsArray.map((p) => {
    let content = {}
    if (Array.isArray(p.content)) {
      content = p.content.map((c) => {
        if (c.type === 'text') {
          return {
            type: 'text',
            content: truncate(c.text),
          }
        } else if (c.type === 'file' && c.mediaType.startsWith('image/')) {
          return {
            type: 'image',
            content: {
              // if image is a url use it, or use "none supported"
              image: c.data instanceof URL ? c.data.toString() : 'raw images not supported',
              mimeType: c.mediaType,
            },
          }
        } else if (c.type === 'file') {
          return {
            type: 'file',
            file: {
              content: {
                file: c.data instanceof URL ? c.data.toString() : 'raw files not supported',
                mimeType: c.mediaType,
              },
            },
          }
        } else if (c.type === 'tool-call') {
          return {
            type: 'tool-call',
            content: {
              toolCallId: c.toolCallId,
              toolName: c.toolName,
              args: c.input,
            },
          }
        } else if (c.type === 'tool-result') {
          return {
            type: 'tool-result',
            content: {
              toolCallId: c.toolCallId,
              toolName: c.toolName,
              result: c.output,
              isError: null,
            },
          }
        }
        return {
          content: '',
        }
      })
    } else {
      content = {
        type: 'text',
        text: truncate(p.content),
      }
    }
    return {
      role: p.role,
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

const mapVercelOutput = (result: Awaited<ReturnType<LanguageModelV2['doGenerate']>>): PostHogInput[] => {
  // normalize string results to object
  const extraOutput = {
    ...(result.response ? { response: result.response } : {}),
    ...(result.finishReason ? { finishReason: result.finishReason } : {}),
    ...(result.usage ? { usage: result.usage } : {}),
    ...(result.warnings ? { warnings: result.warnings } : {}),
    ...(result.providerMetadata ? { providerMetadata: result.providerMetadata } : {}),
  }
  const hasText = result.content.find((c) => c.type === 'text' && c.text)
  const hasNonText = result.content.find((c) => c.type !== 'text')
  if (hasText && !hasNonText) {
    return [
      {
        content: truncate(
          result.content
            .filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('\n')
        ),
        role: 'assistant',
      },
    ]
  }
  // otherwise stringify and truncate
  try {
    const files = result.content
      .filter((c) => c.type === 'file')
      .map((file) => ({
        size: typeof file.data === 'string' ? file.data.length : file.data.byteLength,
        type: file.mediaType,
      }))
    const reasoningOutput = result.content
      .filter((c) => c.type === 'reasoning')
      .map((c) => c.text)
      .join('\n')
    const toolCalls = result.content.filter((c) => c.type === 'tool-call')
    const toolResults = result.content.filter((c) => c.type === 'tool-result')

    const jsonOutput = JSON.stringify({
      ...extraOutput,
      ...(files.length > 0 ? { files } : {}),
      ...(reasoningOutput ? { reasoningText: reasoningOutput } : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      ...(toolResults.length > 0 ? { toolResults } : {}),
    })
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
        ...mapVercelParams(params, /* stream */ false),
      }
      try {
        const result = await doGenerate()
        const latency = (Date.now() - startTime) / 1000
        const modelId =
          options.posthogModelOverride ?? (result.response?.modelId ? result.response.modelId : model.modelId)
        const provider = options.posthogProviderOverride ?? extractProvider(model)
        const baseURL = '' // cannot currently get baseURL from vercel
        const content = mapVercelOutput(result)
        // let tools = result.toolCalls
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
          output: [{ content, role: 'assistant' }],
          latency,
          baseURL,
          params: mergedParams,
          httpStatus: 200,
          usage: {
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            ...additionalTokenValues,
          },
          captureImmediate: options.posthogCaptureImmediate,
        })

        return result
      } catch (error) {
        if (!error || !Object.hasOwn(error, 'status')) {
          throw error
        }
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
          params: mergedParams,
          httpStatus: (error as { status: number })?.status ? (error as { status: number }).status : 500,
          usage: {
            inputTokens: 0,
            outputTokens: 0,
          },
          isError: true,
          error: truncate(JSON.stringify(error)),
          captureImmediate: options.posthogCaptureImmediate,
        })
        throw error
      }
    },

    wrapStream: async ({ doStream, params }) => {
      const startTime = Date.now()
      let generatedText = ''
      let usage: {
        inputTokens?: number
        outputTokens?: number
        reasoningTokens?: number
        cacheReadInputTokens?: number
        cacheCreationInputTokens?: number
      } = {}
      const mergedParams = {
        ...options,
        ...mapVercelParams(params, /* stream */ true),
      }

      const cleanNumberCoerce = (value: any): number | undefined => {
        const num = Number(value)
        return isNaN(num) ? undefined : num
      }

      const modelId = options.posthogModelOverride ?? model.modelId
      const provider = options.posthogProviderOverride ?? extractProvider(model)
      const baseURL = '' // cannot currently get baseURL from vercel
      try {
        const { stream, ...rest } = await doStream()
        const transformStream = new TransformStream<LanguageModelV2StreamPart, LanguageModelV2StreamPart>({
          transform(chunk, controller) {
            if (chunk.type === 'text-delta') {
              generatedText += chunk.delta
            }
            if (chunk.type === 'finish') {
              usage = {
                inputTokens: chunk.usage?.inputTokens,
                outputTokens: chunk.usage?.outputTokens,
              }
              if (chunk.providerMetadata?.openai?.reasoningTokens) {
                usage.reasoningTokens = cleanNumberCoerce(chunk.providerMetadata.openai.reasoningTokens)
              }
              if (chunk.providerMetadata?.openai?.cachedPromptTokens) {
                usage.cacheReadInputTokens = cleanNumberCoerce(chunk.providerMetadata.openai.cachedPromptTokens)
              }
              if (chunk.providerMetadata?.anthropic?.cacheReadInputTokens) {
                usage.cacheReadInputTokens = cleanNumberCoerce(chunk.providerMetadata.anthropic.cacheReadInputTokens)
              }
              if (chunk.providerMetadata?.anthropic?.cacheCreationInputTokens) {
                usage.cacheCreationInputTokens = cleanNumberCoerce(
                  chunk.providerMetadata.anthropic.cacheCreationInputTokens
                )
              }
            }
            controller.enqueue(chunk)
          },

          flush: async () => {
            const latency = (Date.now() - startTime) / 1000
            await sendEventToPosthog({
              client: phClient,
              distinctId: options.posthogDistinctId,
              traceId: options.posthogTraceId ?? uuidv4(),
              model: modelId,
              provider: provider,
              input: options.posthogPrivacyMode ? '' : mapVercelPrompt(params.prompt),
              output: [{ content: generatedText, role: 'assistant' }],
              latency,
              baseURL,
              params: mergedParams,
              httpStatus: 200,
              usage,
              captureImmediate: options.posthogCaptureImmediate,
            })
          },
        })

        return {
          stream: stream.pipeThrough(transformStream),
          ...rest,
        }
      } catch (error) {
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
          params: mergedParams,
          httpStatus: (error as { status: number })?.status ? (error as { status: number }).status : 500,
          usage: {
            inputTokens: 0,
            outputTokens: 0,
          },
          isError: true,
          error: truncate(JSON.stringify(error)),
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
