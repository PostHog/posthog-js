import AnthropicOriginal from '@anthropic-ai/sdk'
import { PostHog } from 'posthog-node'
import { v4 as uuidv4 } from 'uuid'
import { formatResponseAnthropic, mergeSystemPrompt, MonitoringParams, sendEventToPosthog } from '../utils'

type MessageCreateParamsNonStreaming = AnthropicOriginal.Messages.MessageCreateParamsNonStreaming
type MessageCreateParamsStreaming = AnthropicOriginal.Messages.MessageCreateParamsStreaming
type MessageCreateParams = AnthropicOriginal.Messages.MessageCreateParams
type Message = AnthropicOriginal.Messages.Message
type RawMessageStreamEvent = AnthropicOriginal.Messages.RawMessageStreamEvent
type MessageCreateParamsBase = AnthropicOriginal.Messages.MessageCreateParams

import type { APIPromise, RequestOptions } from '@anthropic-ai/sdk/core'
import type { Stream } from '@anthropic-ai/sdk/streaming'

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

  constructor(parentClient: PostHogAnthropic, phClient: PostHog) {
    super(parentClient)
    this.phClient = phClient
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
    const {
      posthogDistinctId,
      posthogTraceId,
      posthogProperties,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      posthogPrivacyMode = false,
      posthogGroups,
      posthogCaptureImmediate,
      ...anthropicParams
    } = body

    const traceId = posthogTraceId ?? uuidv4()
    const startTime = Date.now()

    const parentPromise = super.create(anthropicParams, options)

    if (anthropicParams.stream) {
      return parentPromise.then((value) => {
        let accumulatedContent = ''
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
                if ('delta' in chunk) {
                  if ('text' in chunk.delta) {
                    const delta = chunk?.delta?.text ?? ''
                    accumulatedContent += delta
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
              await sendEventToPosthog({
                client: this.phClient,
                distinctId: posthogDistinctId ?? traceId,
                traceId,
                model: anthropicParams.model,
                provider: 'anthropic',
                input: mergeSystemPrompt(anthropicParams, 'anthropic'),
                output: [{ content: accumulatedContent, role: 'assistant' }],
                latency,
                baseURL: (this as any).baseURL ?? '',
                params: body,
                httpStatus: 200,
                usage,
                captureImmediate: posthogCaptureImmediate,
              })
            } catch (error: any) {
              // error handling
              await sendEventToPosthog({
                client: this.phClient,
                distinctId: posthogDistinctId ?? traceId,
                traceId,
                model: anthropicParams.model,
                provider: 'anthropic',
                input: mergeSystemPrompt(anthropicParams, 'anthropic'),
                output: [],
                latency: 0,
                baseURL: (this as any).baseURL ?? '',
                params: body,
                httpStatus: error?.status ? error.status : 500,
                usage: {
                  inputTokens: 0,
                  outputTokens: 0,
                },
                isError: true,
                error: JSON.stringify(error),
                captureImmediate: posthogCaptureImmediate,
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
            await sendEventToPosthog({
              client: this.phClient,
              distinctId: posthogDistinctId ?? traceId,
              traceId,
              model: anthropicParams.model,
              provider: 'anthropic',
              input: mergeSystemPrompt(anthropicParams, 'anthropic'),
              output: formatResponseAnthropic(result),
              latency,
              baseURL: (this as any).baseURL ?? '',
              params: body,
              httpStatus: 200,
              usage: {
                inputTokens: result.usage.input_tokens ?? 0,
                outputTokens: result.usage.output_tokens ?? 0,
                cacheCreationInputTokens: result.usage.cache_creation_input_tokens ?? 0,
                cacheReadInputTokens: result.usage.cache_read_input_tokens ?? 0,
              },
              captureImmediate: posthogCaptureImmediate,
            })
          }
          return result
        },
        async (error: any) => {
          await sendEventToPosthog({
            client: this.phClient,
            distinctId: posthogDistinctId ?? traceId,
            traceId,
            model: anthropicParams.model,
            provider: 'anthropic',
            input: mergeSystemPrompt(anthropicParams, 'anthropic'),
            output: [],
            latency: 0,
            baseURL: (this as any).baseURL ?? '',
            params: body,
            httpStatus: error?.status ? error.status : 500,
            usage: {
              inputTokens: 0,
              outputTokens: 0,
            },
            isError: true,
            error: JSON.stringify(error),
            captureImmediate: posthogCaptureImmediate,
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
