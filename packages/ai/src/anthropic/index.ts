import { Anthropic as AnthropicOriginal, APIPromise } from '@anthropic-ai/sdk'
import { PostHog } from 'posthog-node'
import {
  formatResponseAnthropic,
  mergeSystemPrompt,
  MonitoringParams,
  sendEventToPosthog,
  extractAvailableToolCalls,
  extractPosthogParams,
} from '../utils'
import type { FormattedContentItem, FormattedTextContent, FormattedFunctionCall, FormattedMessage } from '../types'

type MessageCreateParamsNonStreaming = AnthropicOriginal.Messages.MessageCreateParamsNonStreaming
type MessageCreateParamsStreaming = AnthropicOriginal.Messages.MessageCreateParamsStreaming
type MessageCreateParams = AnthropicOriginal.Messages.MessageCreateParams
type Message = AnthropicOriginal.Messages.Message
type RawMessageStreamEvent = AnthropicOriginal.Messages.RawMessageStreamEvent
type MessageCreateParamsBase = AnthropicOriginal.Messages.MessageCreateParams
type RequestOptions = AnthropicOriginal.RequestOptions
import type { Stream } from '@anthropic-ai/sdk/streaming'
import { sanitizeAnthropic } from '../sanitization'

interface ToolInProgress {
  block: FormattedFunctionCall
  inputString: string
}

interface MonitoringAnthropicConfig {
  apiKey: string
  posthog: PostHog
  baseURL?: string
}

export class PostHogAnthropic extends AnthropicOriginal {
  private readonly phClient: PostHog
  public messages: WrappedMessages

  constructor(config: MonitoringAnthropicConfig) {
    const { posthog, ...anthropicConfig } = config
    super(anthropicConfig)
    this.phClient = posthog
    this.messages = new WrappedMessages(this, this.phClient)
  }
}

export class WrappedMessages extends AnthropicOriginal.Messages {
  private readonly phClient: PostHog
  private readonly baseURL: string

  constructor(parentClient: PostHogAnthropic, phClient: PostHog) {
    super(parentClient)
    this.phClient = phClient
    this.baseURL = parentClient.baseURL
  }

  public create(body: MessageCreateParamsNonStreaming, options?: RequestOptions): APIPromise<Message>
  public create(
    body: MessageCreateParamsStreaming & MonitoringParams,
    options?: RequestOptions
  ): APIPromise<Stream<RawMessageStreamEvent>>
  public create(
    body: MessageCreateParamsBase & MonitoringParams,
    options?: RequestOptions
  ): APIPromise<Stream<RawMessageStreamEvent> | Message>
  public create(
    body: MessageCreateParams & MonitoringParams,
    options?: RequestOptions
  ): APIPromise<Message> | APIPromise<Stream<RawMessageStreamEvent>> {
    const { providerParams: anthropicParams, posthogParams } = extractPosthogParams(body)
    const startTime = Date.now()

    const parentPromise = super.create(anthropicParams, options)

    if (anthropicParams.stream) {
      return parentPromise.then((value) => {
        let accumulatedContent = ''
        const contentBlocks: FormattedContentItem[] = []
        const toolsInProgress: Map<string, ToolInProgress> = new Map()
        let currentTextBlock: FormattedTextContent | null = null

        const usage: {
          inputTokens: number
          outputTokens: number
          cacheCreationInputTokens?: number
          cacheReadInputTokens?: number
        } = {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
        }
        if ('tee' in value) {
          const [stream1, stream2] = value.tee()
          ;(async () => {
            try {
              for await (const chunk of stream1) {
                // Handle content block start events
                if (chunk.type === 'content_block_start') {
                  if (chunk.content_block?.type === 'text') {
                    currentTextBlock = {
                      type: 'text',
                      text: '',
                    }

                    contentBlocks.push(currentTextBlock)
                  } else if (chunk.content_block?.type === 'tool_use') {
                    const toolBlock: FormattedFunctionCall = {
                      type: 'function',
                      id: chunk.content_block.id,
                      function: {
                        name: chunk.content_block.name,
                        arguments: {},
                      },
                    }

                    contentBlocks.push(toolBlock)

                    toolsInProgress.set(chunk.content_block.id, {
                      block: toolBlock,
                      inputString: '',
                    })

                    currentTextBlock = null
                  }
                }

                // Handle text delta events
                if ('delta' in chunk) {
                  if ('text' in chunk.delta) {
                    const delta = chunk.delta.text

                    accumulatedContent += delta

                    if (currentTextBlock) {
                      currentTextBlock.text += delta
                    }
                  }
                }

                // Handle tool input delta events
                if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'input_json_delta') {
                  const block = chunk.index !== undefined ? contentBlocks[chunk.index] : undefined
                  const toolId = block?.type === 'function' ? block.id : undefined

                  if (toolId && toolsInProgress.has(toolId)) {
                    const tool = toolsInProgress.get(toolId)
                    if (tool) {
                      tool.inputString += chunk.delta.partial_json || ''
                    }
                  }
                }

                // Handle content block stop events
                if (chunk.type === 'content_block_stop') {
                  currentTextBlock = null

                  // Parse accumulated tool input
                  if (chunk.index !== undefined) {
                    const block = contentBlocks[chunk.index]

                    if (block?.type === 'function' && block.id && toolsInProgress.has(block.id)) {
                      const tool = toolsInProgress.get(block.id)
                      if (tool) {
                        try {
                          block.function.arguments = JSON.parse(tool.inputString)
                        } catch (e) {
                          // Keep empty object if parsing fails
                          console.error('Error parsing tool input:', e)
                        }
                      }
                      toolsInProgress.delete(block.id)
                    }
                  }
                }

                if (chunk.type == 'message_start') {
                  usage.inputTokens = chunk.message.usage.input_tokens ?? 0
                  usage.cacheCreationInputTokens = chunk.message.usage.cache_creation_input_tokens ?? 0
                  usage.cacheReadInputTokens = chunk.message.usage.cache_read_input_tokens ?? 0
                }
                if ('usage' in chunk) {
                  usage.outputTokens = chunk.usage.output_tokens ?? 0
                }
              }

              const latency = (Date.now() - startTime) / 1000

              const availableTools = extractAvailableToolCalls('anthropic', anthropicParams)

              // Format output to match non-streaming version
              const formattedOutput: FormattedMessage[] =
                contentBlocks.length > 0
                  ? [
                      {
                        role: 'assistant',
                        content: contentBlocks,
                      },
                    ]
                  : [
                      {
                        role: 'assistant',
                        content: [{ type: 'text', text: accumulatedContent }],
                      },
                    ]

              await sendEventToPosthog({
                client: this.phClient,
                ...posthogParams,
                model: anthropicParams.model,
                provider: 'anthropic',
                input: sanitizeAnthropic(mergeSystemPrompt(anthropicParams, 'anthropic')),
                output: formattedOutput,
                latency,
                baseURL: this.baseURL,
                params: body,
                httpStatus: 200,
                usage,
                tools: availableTools,
              })
            } catch (error: any) {
              // error handling
              await sendEventToPosthog({
                client: this.phClient,
                ...posthogParams,
                model: anthropicParams.model,
                provider: 'anthropic',
                input: sanitizeAnthropic(mergeSystemPrompt(anthropicParams, 'anthropic')),
                output: [],
                latency: 0,
                baseURL: this.baseURL,
                params: body,
                httpStatus: error?.status ? error.status : 500,
                usage: {
                  inputTokens: 0,
                  outputTokens: 0,
                },
                isError: true,
                error: JSON.stringify(error),
              })
            }
          })()

          // Return the other stream to the user
          return stream2
        }
        return value
      }) as APIPromise<Stream<RawMessageStreamEvent>>
    } else {
      const wrappedPromise = parentPromise.then(
        async (result) => {
          if ('content' in result) {
            const latency = (Date.now() - startTime) / 1000

            const availableTools = extractAvailableToolCalls('anthropic', anthropicParams)

            await sendEventToPosthog({
              client: this.phClient,
              ...posthogParams,
              model: anthropicParams.model,
              provider: 'anthropic',
              input: sanitizeAnthropic(mergeSystemPrompt(anthropicParams, 'anthropic')),
              output: formatResponseAnthropic(result),
              latency,
              baseURL: this.baseURL,
              params: body,
              httpStatus: 200,
              usage: {
                inputTokens: result.usage.input_tokens ?? 0,
                outputTokens: result.usage.output_tokens ?? 0,
                cacheCreationInputTokens: result.usage.cache_creation_input_tokens ?? 0,
                cacheReadInputTokens: result.usage.cache_read_input_tokens ?? 0,
              },
              tools: availableTools,
            })
          }
          return result
        },
        async (error: any) => {
          await sendEventToPosthog({
            client: this.phClient,
            ...posthogParams,
            model: anthropicParams.model,
            provider: 'anthropic',
            input: sanitizeAnthropic(mergeSystemPrompt(anthropicParams, 'anthropic')),
            output: [],
            latency: 0,
            baseURL: this.baseURL,
            params: body,
            httpStatus: error?.status ? error.status : 500,
            usage: {
              inputTokens: 0,
              outputTokens: 0,
            },
            isError: true,
            error: JSON.stringify(error),
          })
          throw error
        }
      ) as APIPromise<Message>

      return wrappedPromise
    }
  }
}

export default PostHogAnthropic

export { PostHogAnthropic as Anthropic }
