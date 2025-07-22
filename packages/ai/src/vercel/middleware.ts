import { experimental_wrapLanguageModel as wrapLanguageModel } from 'ai'
import type { LanguageModelV1, LanguageModelV1Middleware, LanguageModelV1Prompt, LanguageModelV1StreamPart } from 'ai'
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

const mapVercelParams = (params: any): Record<string, any> => {
  return {
    temperature: params.temperature,
    max_tokens: params.maxTokens,
    top_p: params.topP,
    frequency_penalty: params.frequencyPenalty,
    presence_penalty: params.presencePenalty,
    stop: params.stopSequences,
    stream: params.stream,
  }
}

const mapVercelPrompt = (prompt: LanguageModelV1Prompt): PostHogInput[] => {
  // normalize single inputs into an array of messages
  let promptsArray: any[]
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
      content = p.content.map((c: any) => {
        if (c.type === 'text') {
          return {
            type: 'text',
            content: truncate(c.text),
          }
        } else if (c.type === 'image') {
          return {
            type: 'image',
            content: {
              // if image is a url use it, or use "none supported"
              image: c.image instanceof URL ? c.image.toString() : 'raw images not supported',
              mimeType: c.mimeType,
            },
          }
        } else if (c.type === 'file') {
          return {
            type: 'file',
            content: {
              file: c.data instanceof URL ? c.data.toString() : 'raw files not supported',
              mimeType: c.mimeType,
            },
          }
        } else if (c.type === 'tool-call') {
          return {
            type: 'tool-call',
            content: {
              toolCallId: c.toolCallId,
              toolName: c.toolName,
              args: c.args,
            },
          }
        } else if (c.type === 'tool-result') {
          return {
            type: 'tool-result',
            content: {
              toolCallId: c.toolCallId,
              toolName: c.toolName,
              result: c.result,
              isError: c.isError,
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

const mapVercelOutput = (result: any): PostHogInput[] => {
  // normalize string results to object
  const normalizedResult = typeof result === 'string' ? { text: result } : result
  const output = {
    ...(normalizedResult.text ? { text: normalizedResult.text } : {}),
    ...(normalizedResult.object ? { object: normalizedResult.object } : {}),
    ...(normalizedResult.reasoning ? { reasoning: normalizedResult.reasoning } : {}),
    ...(normalizedResult.response ? { response: normalizedResult.response } : {}),
    ...(normalizedResult.finishReason ? { finishReason: normalizedResult.finishReason } : {}),
    ...(normalizedResult.usage ? { usage: normalizedResult.usage } : {}),
    ...(normalizedResult.warnings ? { warnings: normalizedResult.warnings } : {}),
    ...(normalizedResult.providerMetadata ? { toolCalls: normalizedResult.providerMetadata } : {}),
    ...(normalizedResult.files
      ? {
          files: normalizedResult.files.map((file: any) => ({
            name: file.name,
            size: file.size,
            type: file.type,
          })),
        }
      : {}),
  }
  if (output.text && !output.object && !output.reasoning) {
    return [{ content: truncate(output.text as string), role: 'assistant' }]
  }
  // otherwise stringify and truncate
  try {
    const jsonOutput = JSON.stringify(output)
    return [{ content: truncate(jsonOutput), role: 'assistant' }]
  } catch (error) {
    console.error('Error stringifying output')
    return []
  }
}

const extractProvider = (model: LanguageModelV1): string => {
  const provider = model.provider.toLowerCase()
  const providerName = provider.split('.')[0]
  return providerName
}

export const createInstrumentationMiddleware = (
  phClient: PostHog,
  model: LanguageModelV1,
  options: CreateInstrumentationMiddlewareOptions
): LanguageModelV1Middleware => {
  const middleware: LanguageModelV1Middleware = {
    wrapGenerate: async ({ doGenerate, params }) => {
      const startTime = Date.now()
      const mergedParams = {
        ...options,
        ...mapVercelParams(params),
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
          params: mergedParams as any,
          httpStatus: 200,
          usage: {
            inputTokens: result.usage.promptTokens,
            outputTokens: result.usage.completionTokens,
            ...additionalTokenValues,
          },
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
      const baseURL = '' // cannot currently get baseURL from vercel
      try {
        const { stream, ...rest } = await doStream()
        const transformStream = new TransformStream<LanguageModelV1StreamPart, LanguageModelV1StreamPart>({
          transform(chunk, controller) {
            if (chunk.type === 'text-delta') {
              generatedText += chunk.textDelta
            }
            if (chunk.type === 'finish') {
              usage = {
                inputTokens: chunk.usage?.promptTokens,
                outputTokens: chunk.usage?.completionTokens,
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
              params: mergedParams as any,
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
          captureImmediate: options.posthogCaptureImmediate,
        })
        throw error
      }
    },
  }

  return middleware
}

export const wrapVercelLanguageModel = (
  model: LanguageModelV1,
  phClient: PostHog,
  options: ClientOptions
): LanguageModelV1 => {
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
